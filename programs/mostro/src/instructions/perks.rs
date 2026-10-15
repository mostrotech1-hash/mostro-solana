//! Perks: what fans get for their tokens or their SOL.
//!
//! A perk is an on-chain product record plus a Metaplex Core collection. Every redemption mints a
//! Core asset (the "NFT") into that collection with the attributes the web app needs (`kind`,
//! `tier`, `artist`, `edition`) and writes a `Receipt`. The program never interprets what the perk
//! is; pass benefits (discounts, early access, VIP rooms) are applied by the web app from the
//! asset the fan holds.
//!
//! Two payment modes, one economic rule (80 % of the tokens involved burned, 20 % to rewards):
//! - `redeem_perk`: the fan pays `perk.price_tokens` from its wallet.
//! - `buy_perk_sol`: hybrid perk, the fan pays `perk.price_lamports`. Half of the SOL buys tokens
//!   on the curve, the other half goes to the artist wallet; the same number of tokens is taken
//!   from the artist reserve, and all of those tokens are burned / sent to rewards.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token_interface::{
    burn, transfer_checked, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use mpl_core::{
    accounts::BaseCollectionV1,
    instructions::{CreateCollectionV2CpiBuilder, CreateV2CpiBuilder},
    types::{
        Attribute, Attributes, Edition, MasterEdition, Plugin, PluginAuthority, PluginAuthorityPair,
    },
    ID as MPL_CORE_ID,
};

use crate::curve;
use crate::errors::MostroError;
use crate::events::*;
use crate::instructions::config::require_not_blacklisted;
use crate::instructions::trading::{apply_buy, check_can_buy, record_spend};
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatePerkArgs {
    pub kind: PerkKind,
    pub tier: u8,
    /// Token price (base units). Set exactly one of `price_tokens` / `price_lamports`.
    pub price_tokens: u64,
    /// SOL price (lamports) for a hybrid perk.
    pub price_lamports: u64,
    pub max_supply: u32,
    pub public_start_ts: i64,
    pub name: String,
    pub uri: String,
    /// Client-chosen salt for the collection address, so a squatted (pre-funded) PDA can be skipped.
    pub collection_salt: u64,
}

/// Creates a perk and its Metaplex Core collection (collection PDA signs its own creation,
/// update authority = the artist PDA so only this program can mint into it).
#[derive(Accounts)]
#[instruction(args: CreatePerkArgs)]
pub struct CreatePerk<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ARTIST_SEED, &artist.index.to_le_bytes()],
        bump = artist.bump,
        constraint = signer.key() == artist.authority || signer.key() == config.admin @ MostroError::Unauthorized,
        constraint = artist.active @ MostroError::ArtistInactive,
    )]
    pub artist: Box<Account<'info, Artist>>,
    /// The artist's curve; the perk is tied to its mint.
    #[account(
        constraint = curve.key() == artist.curve @ MostroError::InvalidMint,
        constraint = curve.mint == mint.key() @ MostroError::InvalidMint,
    )]
    pub curve: Box<Account<'info, Curve>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = signer,
        space = 8 + Perk::INIT_SPACE,
        seeds = [PERK_SEED, artist.key().as_ref(), &artist.perk_count.to_le_bytes()],
        bump,
    )]
    pub perk: Box<Account<'info, Perk>>,
    /// CHECK: Core collection account, created by CPI. PDA so no extra signer is needed.
    #[account(mut, seeds = [COLLECTION_SEED, perk.key().as_ref(), &args.collection_salt.to_le_bytes()], bump)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: address constrained to the Metaplex Core program.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_perk(ctx: Context<CreatePerk>, args: CreatePerkArgs) -> Result<()> {
    require!(args.name.len() <= MAX_NAME, MostroError::StringTooLong);
    require!(args.uri.len() <= MAX_URI, MostroError::StringTooLong);
    require!(
        (args.price_tokens > 0) != (args.price_lamports > 0),
        MostroError::InvalidPerkPrice
    );
    match args.kind {
        PerkKind::Pass => {
            // The Mostro Pass is a platform product: only the protocol admin issues it.
            require_keys_eq!(
                ctx.accounts.signer.key(),
                ctx.accounts.config.admin,
                MostroError::Unauthorized
            );
            require!(args.tier <= TIER_VIP, MostroError::InvalidTier);
        }
        _ => require!(args.tier == 0, MostroError::InvalidTier),
    }

    create_collection(&ctx, &args)?;

    let artist = &mut ctx.accounts.artist;
    let p = &mut ctx.accounts.perk;
    p.bump = ctx.bumps.perk;
    p.version = 2;
    p.index = artist.perk_count;
    p.artist = artist.key();
    p.mint = ctx.accounts.mint.key();
    p.collection = ctx.accounts.collection.key();
    p.collection_bump = ctx.bumps.collection;
    p.kind = args.kind;
    p.tier = args.tier;
    p.price_tokens = args.price_tokens;
    p.price_lamports = args.price_lamports;
    p.max_supply = args.max_supply;
    p.sold = 0;
    p.public_start_ts = args.public_start_ts;
    p.active = true;
    p.name = args.name;
    p.uri = args.uri;
    artist.perk_count += 1;
    emit!(PerkCreated {
        perk: p.key(),
        artist: p.artist,
        collection: p.collection,
        kind: p.kind,
        tier: p.tier,
        price_tokens: p.price_tokens,
        price_lamports: p.price_lamports,
        max_supply: p.max_supply,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct SetPerkArgs {
    pub price_tokens: Option<u64>,
    pub price_lamports: Option<u64>,
    pub active: Option<bool>,
    pub max_supply: Option<u32>,
    pub public_start_ts: Option<i64>,
    pub uri: Option<String>,
}

#[derive(Accounts)]
pub struct ManagePerk<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [ARTIST_SEED, &artist.index.to_le_bytes()],
        bump = artist.bump,
        constraint = signer.key() == artist.authority || signer.key() == config.admin @ MostroError::Unauthorized,
    )]
    pub artist: Account<'info, Artist>,
    #[account(mut, seeds = [PERK_SEED, artist.key().as_ref(), &perk.index.to_le_bytes()], bump = perk.bump, has_one = artist)]
    pub perk: Account<'info, Perk>,
}

pub fn set_perk(ctx: Context<ManagePerk>, args: SetPerkArgs) -> Result<()> {
    if ctx.accounts.perk.kind == PerkKind::Pass {
        require_keys_eq!(
            ctx.accounts.signer.key(),
            ctx.accounts.config.admin,
            MostroError::Unauthorized
        );
    }
    let p = &mut ctx.accounts.perk;
    let price_tokens = args.price_tokens.unwrap_or(p.price_tokens);
    let price_lamports = args.price_lamports.unwrap_or(p.price_lamports);
    require!(
        (price_tokens > 0) != (price_lamports > 0),
        MostroError::InvalidPerkPrice
    );
    p.price_tokens = price_tokens;
    p.price_lamports = price_lamports;
    if let Some(v) = args.active {
        p.active = v;
    }
    if let Some(v) = args.max_supply {
        require!(v == 0 || v >= p.sold, MostroError::InvalidAmount);
        p.max_supply = v;
    }
    if let Some(v) = args.public_start_ts {
        p.public_start_ts = v;
    }
    if let Some(v) = args.uri {
        require!(v.len() <= MAX_URI, MostroError::StringTooLong);
        p.uri = v;
    }
    emit!(PerkUpdated {
        perk: p.key(),
        artist: p.artist,
        price_tokens: p.price_tokens,
        price_lamports: p.price_lamports,
        active: p.active,
        max_supply: p.max_supply,
        public_start_ts: p.public_start_ts,
    });
    Ok(())
}

/// Checks shared by both payment modes.
fn check_can_redeem(config: &Config, perk: &Perk, artist: &Artist, now: i64) -> Result<()> {
    require!(!config.redeems_paused, MostroError::RedeemsPaused);
    require!(perk.active, MostroError::PerkInactive);
    require!(artist.active, MostroError::ArtistInactive);
    require!(
        perk.max_supply == 0 || perk.sold < perk.max_supply,
        MostroError::PerkSoldOut
    );
    require!(now >= perk.public_start_ts, MostroError::SaleNotStarted);
    Ok(())
}

// ---- redeem with tokens ---------------------------------------------------------------------------

/// Pay `perk.price_tokens` from the buyer's wallet: 80 % burned, 20 % to the rewards vault. Mints a
/// Core asset into the perk's collection for the buyer and writes a receipt.
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct RedeemPerk<'info> {
    /// Pays rent and the Core protocol fee. Usually the buyer; can be a sponsor (Openfort/Kora).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Owns the tokens being spent and receives the asset.
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [ARTIST_SEED, &artist.index.to_le_bytes()], bump = artist.bump)]
    pub artist: Box<Account<'info, Artist>>,
    #[account(
        mut,
        seeds = [PERK_SEED, artist.key().as_ref(), &perk.index.to_le_bytes()],
        bump = perk.bump,
        has_one = artist,
        has_one = mint @ MostroError::InvalidMint,
        has_one = collection @ MostroError::InvalidCollection,
    )]
    pub perk: Box<Account<'info, Perk>>,
    #[account(mut, seeds = [CURVE_SEED, &curve.index.to_le_bytes()], bump = curve.bump, has_one = mint @ MostroError::InvalidMint)]
    pub curve: Box<Account<'info, Curve>>,
    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = buyer, token::token_program = token_program)]
    pub buyer_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [REWARDS_SEED, curve.key().as_ref()], bump, token::mint = mint, token::authority = curve)]
    pub rewards_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub collection: Box<Account<'info, BaseCollectionV1>>,
    /// CHECK: Core asset, created by CPI. Seeded by a client nonce so concurrent buyers never collide.
    #[account(mut, seeds = [ASSET_SEED, perk.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub asset: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, asset.key().as_ref()],
        bump,
    )]
    pub receipt: Box<Account<'info, Receipt>>,
    /// CHECK: `["blacklist", buyer]`; may be empty (never blacklisted). Checked by seeds.
    #[account(seeds = [BLACKLIST_SEED, buyer.key().as_ref()], bump)]
    pub blacklist_entry: UncheckedAccount<'info>,
    /// CHECK: address constrained to the Metaplex Core program.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn redeem_perk(ctx: Context<RedeemPerk>, nonce: u64, max_paid: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let perk = &ctx.accounts.perk;
    check_can_redeem(&ctx.accounts.config, perk, &ctx.accounts.artist, now)?;
    require_not_blacklisted(&ctx.accounts.blacklist_entry, ctx.program_id)?;
    require!(perk.price_tokens > 0, MostroError::WrongPerkPayment);
    let paid = perk.price_tokens;
    // Guards against an artist/admin front-running the buyer with set_perk(price).
    require!(paid <= max_paid, MostroError::SlippageExceeded);
    let (burned, to_rewards) = curve::split_redeem(paid)?;

    // 1. Pay: burn + route from the buyer's wallet.
    if burned > 0 {
        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.buyer_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            burned,
        )?;
    }
    if to_rewards > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.rewards_vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            to_rewards,
            ctx.accounts.mint.decimals,
        )?;
    }

    // 2. Mint the Core asset.
    let edition = perk.sold + 1;
    mint_core_asset(
        &MintAsset {
            mpl_core_program: ctx.accounts.mpl_core_program.to_account_info(),
            asset: ctx.accounts.asset.to_account_info(),
            collection: ctx.accounts.collection.to_account_info(),
            artist: &ctx.accounts.artist,
            payer: ctx.accounts.payer.to_account_info(),
            owner: ctx.accounts.buyer.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            perk,
            perk_key: ctx.accounts.perk.key(),
            nonce,
            asset_bump: ctx.bumps.asset,
        },
        edition,
    )?;

    // 3. Receipt + counters.
    let receipt_bump = ctx.bumps.receipt;
    let r = &mut ctx.accounts.receipt;
    write_receipt(
        r,
        receipt_bump,
        ReceiptData {
            buyer: ctx.accounts.buyer.key(),
            perk: ctx.accounts.perk.key(),
            artist: ctx.accounts.artist.key(),
            asset: ctx.accounts.asset.key(),
            edition,
            kind: ctx.accounts.perk.kind,
            tier: ctx.accounts.perk.tier,
            paid_tokens: paid,
            paid_lamports: 0,
            tokens_from_curve: 0,
            tokens_from_artist: 0,
            burned,
            to_rewards,
            lamports_to_curve: 0,
            lamports_to_artist: 0,
            ts: now,
        },
    );
    ctx.accounts.perk.sold = edition;
    let curve = &mut ctx.accounts.curve;
    curve.total_burned = curve
        .total_burned
        .checked_add(burned)
        .ok_or(MostroError::MathOverflow)?;
    curve.rewards_accrued = curve
        .rewards_accrued
        .checked_add(to_rewards)
        .ok_or(MostroError::MathOverflow)?;

    emit!(PerkRedeemed {
        perk: ctx.accounts.perk.key(),
        artist: ctx.accounts.artist.key(),
        buyer: ctx.accounts.buyer.key(),
        asset: ctx.accounts.asset.key(),
        receipt: ctx.accounts.receipt.key(),
        edition,
        kind: ctx.accounts.perk.kind,
        tier: ctx.accounts.perk.tier,
        paid_tokens: paid,
        paid_lamports: 0,
        tokens_from_curve: 0,
        tokens_from_artist: 0,
        burned,
        to_rewards,
        lamports_to_curve: 0,
        lamports_to_artist: 0,
    });
    Ok(())
}

// ---- hybrid perk: pay in SOL --------------------------------------------------------------------

/// Pay `perk.price_lamports`. Half of it is a curve buy (fee to treasury, net to `sol_vault`,
/// tokens out of `curve_vault`); the other half goes to the artist wallet and the same number of
/// tokens leaves `artist_reserve`. All tokens involved are burned 80 % / sent to rewards 20 %.
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct BuyPerkSol<'info> {
    /// Pays rent and the Core protocol fee. Usually the buyer; can be a sponsor.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Pays the SOL and receives the asset.
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ARTIST_SEED, &artist.index.to_le_bytes()], bump = artist.bump)]
    pub artist: Box<Account<'info, Artist>>,
    /// CHECK: the artist's payout wallet, `artist.authority`.
    #[account(mut, address = artist.authority @ MostroError::Unauthorized)]
    pub artist_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [PERK_SEED, artist.key().as_ref(), &perk.index.to_le_bytes()],
        bump = perk.bump,
        has_one = artist,
        has_one = mint @ MostroError::InvalidMint,
        has_one = collection @ MostroError::InvalidCollection,
    )]
    pub perk: Box<Account<'info, Perk>>,
    #[account(
        mut,
        seeds = [CURVE_SEED, &curve.index.to_le_bytes()],
        bump = curve.bump,
        has_one = mint @ MostroError::InvalidMint,
        constraint = curve.key() == artist.curve @ MostroError::InvalidMint,
    )]
    pub curve: Box<Account<'info, Curve>>,
    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [CURVE_VAULT_SEED, curve.key().as_ref()], bump, token::mint = mint, token::authority = curve)]
    pub curve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [ARTIST_RESERVE_SEED, curve.key().as_ref()], bump, token::mint = mint, token::authority = curve)]
    pub artist_reserve: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [REWARDS_SEED, curve.key().as_ref()], bump, token::mint = mint, token::authority = curve)]
    pub rewards_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [SOL_VAULT_SEED, curve.key().as_ref()], bump = curve.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + SpendTracker::INIT_SPACE,
        seeds = [SPEND_SEED, curve.key().as_ref(), buyer.key().as_ref()],
        bump,
    )]
    pub spend: Box<Account<'info, SpendTracker>>,
    /// CHECK: `["blacklist", buyer]`; may be empty (never blacklisted). Checked by seeds.
    #[account(seeds = [BLACKLIST_SEED, buyer.key().as_ref()], bump)]
    pub blacklist_entry: UncheckedAccount<'info>,
    #[account(mut)]
    pub collection: Box<Account<'info, BaseCollectionV1>>,
    /// CHECK: Core asset, created by CPI. Seeded by a client nonce so concurrent buyers never collide.
    #[account(mut, seeds = [ASSET_SEED, perk.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub asset: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, asset.key().as_ref()],
        bump,
    )]
    pub receipt: Box<Account<'info, Receipt>>,
    /// CHECK: address constrained to the Metaplex Core program.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn buy_perk_sol(ctx: Context<BuyPerkSol>, nonce: u64, max_lamports: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    check_can_redeem(
        &ctx.accounts.config,
        &ctx.accounts.perk,
        &ctx.accounts.artist,
        now,
    )?;
    // The curve leg is a buy: same gates as any other buy (pause, cool-down, completion, blacklist).
    check_can_buy(
        &ctx.accounts.config,
        &ctx.accounts.curve,
        &ctx.accounts.blacklist_entry,
        ctx.program_id,
        now,
    )?;
    let price = ctx.accounts.perk.price_lamports;
    require!(price > 0, MostroError::WrongPerkPayment);
    require!(price <= max_lamports, MostroError::SlippageExceeded);

    let (curve_half, artist_half) = curve::hybrid_halves(price);
    let q = curve::buy_exact_in(
        ctx.accounts.curve.virtual_sol_reserves,
        ctx.accounts.curve.virtual_token_reserves,
        curve_half,
        ctx.accounts.config.fee_bps,
    )?;
    let tokens_from_curve = q.tokens_out;
    require!(tokens_from_curve > 0, MostroError::InvalidAmount);
    require!(
        ctx.accounts.artist_reserve.amount >= tokens_from_curve,
        MostroError::InsufficientReserves
    );
    record_spend(
        &ctx.accounts.config,
        &mut ctx.accounts.spend,
        ctx.bumps.spend,
        ctx.accounts.curve.key(),
        ctx.accounts.buyer.key(),
        curve_half,
        now,
    )?;

    // 1. SOL: curve net, protocol fee, artist half.
    pay_sol(&ctx, q.net_in, q.fee, artist_half)?;

    // 2. Tokens: the curve leg moves the price like a buy; both legs are burned / rewarded.
    let (burn_c, rewards_c) = curve::split_redeem(tokens_from_curve)?;
    settle_vault_tokens(
        &ctx.accounts.token_program,
        &ctx.accounts.mint,
        &ctx.accounts.rewards_vault,
        &ctx.accounts.curve,
        &ctx.accounts.curve_vault,
        burn_c,
        rewards_c,
    )?;
    settle_vault_tokens(
        &ctx.accounts.token_program,
        &ctx.accounts.mint,
        &ctx.accounts.rewards_vault,
        &ctx.accounts.curve,
        &ctx.accounts.artist_reserve,
        burn_c,
        rewards_c,
    )?;
    let burned = burn_c * 2;
    let to_rewards = rewards_c * 2;

    // 3. Mint the Core asset.
    let edition = ctx.accounts.perk.sold + 1;
    mint_core_asset(
        &MintAsset {
            mpl_core_program: ctx.accounts.mpl_core_program.to_account_info(),
            asset: ctx.accounts.asset.to_account_info(),
            collection: ctx.accounts.collection.to_account_info(),
            artist: &ctx.accounts.artist,
            payer: ctx.accounts.payer.to_account_info(),
            owner: ctx.accounts.buyer.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            perk: &ctx.accounts.perk,
            perk_key: ctx.accounts.perk.key(),
            nonce,
            asset_bump: ctx.bumps.asset,
        },
        edition,
    )?;

    // 4. Receipt + counters.
    let lamports_to_curve = q
        .net_in
        .checked_add(q.fee)
        .ok_or(MostroError::MathOverflow)?;
    let receipt_bump = ctx.bumps.receipt;
    let r = &mut ctx.accounts.receipt;
    write_receipt(
        r,
        receipt_bump,
        ReceiptData {
            buyer: ctx.accounts.buyer.key(),
            perk: ctx.accounts.perk.key(),
            artist: ctx.accounts.artist.key(),
            asset: ctx.accounts.asset.key(),
            edition,
            kind: ctx.accounts.perk.kind,
            tier: ctx.accounts.perk.tier,
            paid_tokens: 0,
            paid_lamports: price,
            tokens_from_curve,
            tokens_from_artist: tokens_from_curve,
            burned,
            to_rewards,
            lamports_to_curve,
            lamports_to_artist: artist_half,
            ts: now,
        },
    );
    ctx.accounts.perk.sold = edition;
    let curve = &mut ctx.accounts.curve;
    apply_buy(curve, q.net_in, tokens_from_curve)?;
    curve.real_sol_reserves = curve
        .real_sol_reserves
        .checked_add(q.net_in)
        .ok_or(MostroError::MathOverflow)?;
    curve.artist_reserve_used = curve
        .artist_reserve_used
        .checked_add(tokens_from_curve)
        .ok_or(MostroError::MathOverflow)?;
    curve.total_burned = curve
        .total_burned
        .checked_add(burned)
        .ok_or(MostroError::MathOverflow)?;
    curve.rewards_accrued = curve
        .rewards_accrued
        .checked_add(to_rewards)
        .ok_or(MostroError::MathOverflow)?;
    let artist = &mut ctx.accounts.artist;
    artist.revenue_lamports = artist
        .revenue_lamports
        .checked_add(artist_half)
        .ok_or(MostroError::MathOverflow)?;

    emit!(TokensBought {
        curve: curve.key(),
        mint: ctx.accounts.mint.key(),
        buyer: ctx.accounts.buyer.key(),
        quote_kind: 2,
        quote_in: lamports_to_curve,
        quote_net: q.net_in,
        fee: q.fee,
        tokens_out: tokens_from_curve,
        virtual_sol_reserves: curve.virtual_sol_reserves,
        virtual_token_reserves: curve.virtual_token_reserves,
    });
    emit!(PerkRedeemed {
        perk: ctx.accounts.perk.key(),
        artist: artist.key(),
        buyer: ctx.accounts.buyer.key(),
        asset: ctx.accounts.asset.key(),
        receipt: ctx.accounts.receipt.key(),
        edition,
        kind: ctx.accounts.perk.kind,
        tier: ctx.accounts.perk.tier,
        paid_tokens: 0,
        paid_lamports: price,
        tokens_from_curve,
        tokens_from_artist: tokens_from_curve,
        burned,
        to_rewards,
        lamports_to_curve,
        lamports_to_artist: artist_half,
    });
    Ok(())
}

#[inline(never)]
fn pay_sol(ctx: &Context<BuyPerkSol>, net: u64, fee: u64, artist_half: u64) -> Result<()> {
    let sys = ctx.accounts.system_program.to_account_info();
    let from = ctx.accounts.buyer.to_account_info();
    for (amount, to) in [
        (net, ctx.accounts.sol_vault.to_account_info()),
        (fee, ctx.accounts.treasury.to_account_info()),
        (artist_half, ctx.accounts.artist_authority.to_account_info()),
    ] {
        if amount > 0 {
            transfer(
                CpiContext::new(
                    sys.clone(),
                    Transfer {
                        from: from.clone(),
                        to,
                    },
                ),
                amount,
            )?;
        }
    }
    Ok(())
}

/// Burns `burned` from a curve-owned vault and moves `to_rewards` from it to the rewards vault.
#[inline(never)]
fn settle_vault_tokens<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    rewards_vault: &InterfaceAccount<'info, TokenAccount>,
    curve: &Account<'info, Curve>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    burned: u64,
    to_rewards: u64,
) -> Result<()> {
    let index = curve.index.to_le_bytes();
    let seeds: &[&[u8]] = &[CURVE_SEED, &index, &[curve.bump]];
    if burned > 0 {
        burn(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                Burn {
                    mint: mint.to_account_info(),
                    from: vault.to_account_info(),
                    authority: curve.to_account_info(),
                },
                &[seeds],
            ),
            burned,
        )?;
    }
    if to_rewards > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                TransferChecked {
                    from: vault.to_account_info(),
                    mint: mint.to_account_info(),
                    to: rewards_vault.to_account_info(),
                    authority: curve.to_account_info(),
                },
                &[seeds],
            ),
            to_rewards,
            mint.decimals,
        )?;
    }
    Ok(())
}

// ---- fulfilment ---------------------------------------------------------------------------------

/// Artist (or admin) marks an off-chain perk as delivered.
#[derive(Accounts)]
pub struct FulfillReceipt<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [ARTIST_SEED, &artist.index.to_le_bytes()],
        bump = artist.bump,
        constraint = signer.key() == artist.authority || signer.key() == config.admin @ MostroError::Unauthorized,
    )]
    pub artist: Account<'info, Artist>,
    #[account(mut, seeds = [RECEIPT_SEED, receipt.asset.as_ref()], bump = receipt.bump, has_one = artist)]
    pub receipt: Account<'info, Receipt>,
}

pub fn fulfill_receipt(ctx: Context<FulfillReceipt>) -> Result<()> {
    let r = &mut ctx.accounts.receipt;
    require!(!r.fulfilled, MostroError::AlreadyFulfilled);
    r.fulfilled = true;
    r.fulfilled_ts = Clock::get()?.unix_timestamp;
    emit!(ReceiptFulfilled {
        receipt: r.key(),
        perk: r.perk,
        by: ctx.accounts.signer.key(),
    });
    Ok(())
}

// ---- shared helpers -----------------------------------------------------------------------------

struct ReceiptData {
    buyer: Pubkey,
    perk: Pubkey,
    artist: Pubkey,
    asset: Pubkey,
    edition: u32,
    kind: PerkKind,
    tier: u8,
    paid_tokens: u64,
    paid_lamports: u64,
    tokens_from_curve: u64,
    tokens_from_artist: u64,
    burned: u64,
    to_rewards: u64,
    lamports_to_curve: u64,
    lamports_to_artist: u64,
    ts: i64,
}

fn write_receipt(r: &mut Receipt, bump: u8, d: ReceiptData) {
    r.bump = bump;
    r.version = 2;
    r.buyer = d.buyer;
    r.perk = d.perk;
    r.artist = d.artist;
    r.asset = d.asset;
    r.edition = d.edition;
    r.kind = d.kind;
    r.tier = d.tier;
    r.paid_tokens = d.paid_tokens;
    r.paid_lamports = d.paid_lamports;
    r.tokens_from_curve = d.tokens_from_curve;
    r.tokens_from_artist = d.tokens_from_artist;
    r.burned = d.burned;
    r.to_rewards = d.to_rewards;
    r.lamports_to_curve = d.lamports_to_curve;
    r.lamports_to_artist = d.lamports_to_artist;
    r.ts = d.ts;
    r.fulfilled = false;
    r.fulfilled_ts = 0;
}

struct MintAsset<'a, 'info> {
    mpl_core_program: AccountInfo<'info>,
    asset: AccountInfo<'info>,
    collection: AccountInfo<'info>,
    artist: &'a Account<'info, Artist>,
    payer: AccountInfo<'info>,
    owner: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    perk: &'a Perk,
    perk_key: Pubkey,
    nonce: u64,
    asset_bump: u8,
}

/// Mints the perk's Core asset. Signers: asset PDA + artist PDA (the collection's update
/// authority). Attributes carry what the web app needs to render the benefit.
#[inline(never)]
fn mint_core_asset(a: &MintAsset, edition: u32) -> Result<()> {
    let perk = a.perk;
    let perk_key = a.perk_key;
    let nonce_le = a.nonce.to_le_bytes();
    let asset_seeds: &[&[u8]] = &[ASSET_SEED, perk_key.as_ref(), &nonce_le, &[a.asset_bump]];
    let artist_index = a.artist.index.to_le_bytes();
    let artist_seeds: &[&[u8]] = &[ARTIST_SEED, &artist_index, &[a.artist.bump]];
    let kind_str = match perk.kind {
        PerkKind::Pass => "pass",
        PerkKind::Music => "music",
        PerkKind::Event => "event",
        PerkKind::Merch => "merch",
    };
    let tier_str = match (perk.kind, perk.tier) {
        (PerkKind::Pass, TIER_VIP) => "VIP",
        (PerkKind::Pass, _) => "Classic",
        _ => "-",
    };
    let plugins = vec![
        PluginAuthorityPair {
            plugin: Plugin::Attributes(Attributes {
                attribute_list: vec![
                    Attribute {
                        key: "kind".into(),
                        value: kind_str.into(),
                    },
                    Attribute {
                        key: "tier".into(),
                        value: tier_str.into(),
                    },
                    Attribute {
                        key: "artist".into(),
                        value: a.artist.name.clone(),
                    },
                    Attribute {
                        key: "edition".into(),
                        value: edition.to_string(),
                    },
                ],
            }),
            authority: Some(PluginAuthority::UpdateAuthority),
        },
        PluginAuthorityPair {
            plugin: Plugin::Edition(Edition { number: edition }),
            authority: Some(PluginAuthority::UpdateAuthority),
        },
    ];
    let mut name = perk.name.clone();
    name.push_str(" #");
    name.push_str(&edition.to_string());
    CreateV2CpiBuilder::new(&a.mpl_core_program)
        .asset(&a.asset)
        .collection(Some(&a.collection))
        .authority(Some(&a.artist.to_account_info()))
        .payer(&a.payer)
        .owner(Some(&a.owner))
        .system_program(&a.system_program)
        .name(name)
        .uri(perk.uri.clone())
        .plugins(plugins)
        .invoke_signed(&[asset_seeds, artist_seeds])?;
    Ok(())
}

#[inline(never)]
fn create_collection(ctx: &Context<CreatePerk>, args: &CreatePerkArgs) -> Result<()> {
    let perk_key = ctx.accounts.perk.key();
    let salt = args.collection_salt.to_le_bytes();
    let collection_seeds: &[&[u8]] = &[
        COLLECTION_SEED,
        perk_key.as_ref(),
        &salt,
        &[ctx.bumps.collection],
    ];
    let master = Plugin::MasterEdition(MasterEdition {
        max_supply: if args.max_supply == 0 {
            None
        } else {
            Some(args.max_supply)
        },
        name: Some(args.name.clone()),
        uri: Some(args.uri.clone()),
    });
    CreateCollectionV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .collection(&ctx.accounts.collection.to_account_info())
        .payer(&ctx.accounts.signer.to_account_info())
        .update_authority(Some(&ctx.accounts.artist.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name(args.name.clone())
        .uri(args.uri.clone())
        .plugins(vec![PluginAuthorityPair {
            plugin: master,
            authority: Some(PluginAuthority::UpdateAuthority),
        }])
        .invoke_signed(&[collection_seeds])?;
    Ok(())
}
