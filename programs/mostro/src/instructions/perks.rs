use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, transfer_checked, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use mpl_core::{
    accounts::{BaseAssetV1, BaseCollectionV1},
    instructions::{CreateCollectionV2CpiBuilder, CreateV2CpiBuilder},
    types::{
        Attribute, Attributes, Edition, MasterEdition, Plugin, PluginAuthority,
        PluginAuthorityPair, UpdateAuthority,
    },
    ID as MPL_CORE_ID,
};

use crate::curve;
use crate::errors::MostroError;
use crate::events::*;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreatePerkArgs {
    pub kind: PerkKind,
    pub tier: u8,
    pub price: u64,
    pub burn_bps: u16,
    pub rewards_bps: u16,
    pub max_supply: u32,
    pub public_start_ts: i64,
    pub vip_only: bool,
    pub discount_eligible: bool,
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
    /// The curve mint the perk is priced in.
    #[account(constraint = curve.mint == mint.key() @ MostroError::InvalidMint)]
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
    /// Artist vault for this mint, created lazily here so `redeem_perk` never has to.
    #[account(
        init_if_needed,
        payer = signer,
        seeds = [ARTIST_VAULT_SEED, artist.key().as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = artist,
        token::token_program = token_program,
    )]
    pub artist_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: address constrained to the Metaplex Core program.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn create_perk(ctx: Context<CreatePerk>, args: CreatePerkArgs) -> Result<()> {
    require!(args.name.len() <= MAX_NAME, MostroError::StringTooLong);
    require!(args.uri.len() <= MAX_URI, MostroError::StringTooLong);
    require!(args.price > 0, MostroError::InvalidAmount);
    require!(
        args.burn_bps as u64 + args.rewards_bps as u64 <= BPS_DENOMINATOR,
        MostroError::InvalidBps
    );
    match args.kind {
        PerkKind::Pass => {
            // Pass perks grant protocol-wide benefits: only the protocol admin can create them.
            require_keys_eq!(
                ctx.accounts.signer.key(),
                ctx.accounts.config.admin,
                MostroError::Unauthorized
            );
            require!(args.tier <= TIER_VIP, MostroError::InvalidTier);
        }
        _ => require!(args.tier == 0, MostroError::InvalidTier),
    }
    require!(
        args.burn_bps >= ctx.accounts.config.min_burn_bps
            && args.rewards_bps >= ctx.accounts.config.min_rewards_bps,
        MostroError::InvalidBps
    );

    create_collection(&ctx, &args)?;

    let artist = &mut ctx.accounts.artist;
    let p = &mut ctx.accounts.perk;
    p.bump = ctx.bumps.perk;
    p.version = 1;
    p.index = artist.perk_count;
    p.artist = artist.key();
    p.mint = ctx.accounts.mint.key();
    p.collection = ctx.accounts.collection.key();
    p.collection_bump = ctx.bumps.collection;
    p.kind = args.kind;
    p.tier = args.tier;
    p.price = args.price;
    p.burn_bps = args.burn_bps;
    p.rewards_bps = args.rewards_bps;
    p.max_supply = args.max_supply;
    p.sold = 0;
    p.public_start_ts = args.public_start_ts;
    p.vip_only = args.vip_only;
    p.discount_eligible = args.discount_eligible;
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
        price: p.price,
        max_supply: p.max_supply,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct SetPerkArgs {
    pub price: Option<u64>,
    pub active: Option<bool>,
    pub max_supply: Option<u32>,
    pub public_start_ts: Option<i64>,
    pub vip_only: Option<bool>,
    pub discount_eligible: Option<bool>,
    pub burn_bps: Option<u16>,
    pub rewards_bps: Option<u16>,
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
        // Pass perks carry protocol-wide benefits: only the admin may edit them.
        require_keys_eq!(
            ctx.accounts.signer.key(),
            ctx.accounts.config.admin,
            MostroError::Unauthorized
        );
    }
    let p = &mut ctx.accounts.perk;
    if let Some(v) = args.price {
        require!(v > 0, MostroError::InvalidAmount);
        p.price = v;
    }
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
    if let Some(v) = args.vip_only {
        p.vip_only = v;
    }
    if let Some(v) = args.discount_eligible {
        p.discount_eligible = v;
    }
    let burn_bps = args.burn_bps.unwrap_or(p.burn_bps);
    let rewards_bps = args.rewards_bps.unwrap_or(p.rewards_bps);
    require!(
        burn_bps as u64 + rewards_bps as u64 <= BPS_DENOMINATOR
            && burn_bps >= ctx.accounts.config.min_burn_bps
            && rewards_bps >= ctx.accounts.config.min_rewards_bps,
        MostroError::InvalidBps
    );
    p.burn_bps = burn_bps;
    p.rewards_bps = rewards_bps;
    if let Some(v) = args.uri {
        require!(v.len() <= MAX_URI, MostroError::StringTooLong);
        p.uri = v;
    }
    emit!(PerkUpdated {
        perk: p.key(),
        artist: p.artist,
        price: p.price,
        active: p.active,
        max_supply: p.max_supply,
        public_start_ts: p.public_start_ts,
        vip_only: p.vip_only,
        discount_eligible: p.discount_eligible,
        burn_bps: p.burn_bps,
        rewards_bps: p.rewards_bps,
    });
    Ok(())
}

/// Pay `perk.price` in tokens (minus any pass discount), burn/route the split, mint a Core asset
/// into the perk's collection for the buyer and write a receipt. One signer: the buyer.
#[derive(Accounts)]
#[instruction(nonce: u64, max_paid: u64)]
pub struct RedeemPerk<'info> {
    /// Pays rent and the Core protocol fee. Usually the buyer; can be a sponsor (Openfort/Kora).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Owns the tokens being spent and receives the asset.
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ARTIST_SEED, &artist.index.to_le_bytes()], bump = artist.bump)]
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
    #[account(
        mut,
        seeds = [ARTIST_VAULT_SEED, artist.key().as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = artist,
    )]
    pub artist_vault: Box<InterfaceAccount<'info, TokenAccount>>,
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
    /// Optional MoOG Pass held by the buyer, for discount / early access / VIP gating.
    pub pass_asset: Option<Box<Account<'info, BaseAssetV1>>>,
    /// The pass perk the `pass_asset` belongs to.
    pub pass_perk: Option<Box<Account<'info, Perk>>>,
    /// CHECK: address constrained to the Metaplex Core program.
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Returns `(tier, pass_asset_key)` if the buyer presented a valid pass.
fn resolve_pass(
    buyer: &Pubkey,
    pass_asset: &Option<Box<Account<BaseAssetV1>>>,
    pass_perk: &Option<Box<Account<Perk>>>,
) -> Result<Option<(u8, Pubkey)>> {
    match (pass_asset, pass_perk) {
        (Some(asset), Some(perk)) => {
            require!(perk.kind == PerkKind::Pass, MostroError::PassMismatch);
            require!(perk.active, MostroError::PerkInactive);
            require_keys_eq!(asset.owner, *buyer, MostroError::InvalidPass);
            match asset.update_authority {
                UpdateAuthority::Collection(c) => {
                    require_keys_eq!(c, perk.collection, MostroError::PassMismatch)
                }
                _ => return err!(MostroError::InvalidPass),
            }
            Ok(Some((perk.tier, asset.key())))
        }
        (None, None) => Ok(None),
        _ => err!(MostroError::PassMismatch),
    }
}

pub fn redeem_perk(ctx: Context<RedeemPerk>, nonce: u64, max_paid: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    let perk = &ctx.accounts.perk;
    require!(!config.paused, MostroError::Paused);
    require!(perk.active, MostroError::PerkInactive);
    require!(ctx.accounts.artist.active, MostroError::ArtistInactive);
    require!(
        perk.max_supply == 0 || perk.sold < perk.max_supply,
        MostroError::PerkSoldOut
    );
    let now = Clock::get()?.unix_timestamp;

    let pass = resolve_pass(
        &ctx.accounts.buyer.key(),
        &ctx.accounts.pass_asset,
        &ctx.accounts.pass_perk,
    )?;
    let (discount_bps, early_secs, is_vip, pass_used) = match pass {
        Some((TIER_VIP, key)) => (
            config.vip_discount_bps,
            config.vip_early_secs as i64,
            true,
            key,
        ),
        Some((_, key)) => (
            config.standard_discount_bps,
            config.standard_early_secs as i64,
            false,
            key,
        ),
        None => (0u16, 0i64, false, Pubkey::default()),
    };
    if perk.vip_only {
        require!(is_vip, MostroError::VipOnly);
    }
    require!(
        now >= perk.public_start_ts.saturating_sub(early_secs),
        MostroError::SaleNotStarted
    );
    let effective_discount = if perk.discount_eligible {
        discount_bps
    } else {
        0
    };
    let paid = curve::apply_discount(perk.price, effective_discount)?;
    // Guards against an artist/admin front-running the buyer with set_perk(price).
    require!(paid <= max_paid, MostroError::SlippageExceeded);
    let (burned, to_rewards, to_artist) =
        curve::split_redeem(paid, perk.burn_bps, perk.rewards_bps)?;

    // 1. Pay: burn + route (separate frame).
    pay_split(&ctx, burned, to_rewards, to_artist)?;

    // 2. Mint the Core asset into the perk's collection (separate frame: the CPI builder is large).
    let edition = perk.sold + 1;
    let perk_key = perk.key();
    mint_core_asset(&ctx, nonce, edition)?;

    // 3. Receipt + counters.
    let r = &mut ctx.accounts.receipt;
    r.bump = ctx.bumps.receipt;
    r.version = 1;
    r.buyer = ctx.accounts.buyer.key();
    r.perk = perk_key;
    r.artist = ctx.accounts.artist.key();
    r.asset = ctx.accounts.asset.key();
    r.edition = edition;
    r.kind = perk.kind;
    r.tier = perk.tier;
    r.paid = paid;
    r.burned = burned;
    r.to_rewards = to_rewards;
    r.to_artist = to_artist;
    r.discount_bps = effective_discount;
    r.pass_used = pass_used;
    r.ts = now;
    r.fulfilled = false;
    r.fulfilled_ts = 0;

    let perk = &mut ctx.accounts.perk;
    perk.sold = edition;
    let curve = &mut ctx.accounts.curve;
    curve.total_burned = curve
        .total_burned
        .checked_add(burned)
        .ok_or(MostroError::MathOverflow)?;
    curve.rewards_accrued = curve
        .rewards_accrued
        .checked_add(to_rewards)
        .ok_or(MostroError::MathOverflow)?;
    let artist = &mut ctx.accounts.artist;
    artist.revenue_tokens = artist
        .revenue_tokens
        .checked_add(to_artist)
        .ok_or(MostroError::MathOverflow)?;

    emit!(PerkRedeemed {
        perk: perk_key,
        artist: artist.key(),
        buyer: ctx.accounts.buyer.key(),
        asset: ctx.accounts.asset.key(),
        receipt: ctx.accounts.receipt.key(),
        edition,
        kind: perk.kind,
        tier: perk.tier,
        paid,
        burned,
        to_rewards,
        to_artist,
        discount_bps: effective_discount,
        pass_used,
    });
    Ok(())
}

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

/// Signers: asset PDA + artist PDA (the collection's update authority).
#[inline(never)]
fn mint_core_asset(ctx: &Context<RedeemPerk>, nonce: u64, edition: u32) -> Result<()> {
    let perk = &ctx.accounts.perk;
    let perk_key = perk.key();
    let nonce_le = nonce.to_le_bytes();
    let asset_seeds: &[&[u8]] = &[ASSET_SEED, perk_key.as_ref(), &nonce_le, &[ctx.bumps.asset]];
    let artist_index = ctx.accounts.artist.index.to_le_bytes();
    let artist_seeds: &[&[u8]] = &[ARTIST_SEED, &artist_index, &[ctx.accounts.artist.bump]];
    let kind_str = match perk.kind {
        PerkKind::Pass => "pass",
        PerkKind::Music => "music",
        PerkKind::Event => "event",
        PerkKind::Merch => "merch",
    };
    let tier_str = match (perk.kind, perk.tier) {
        (PerkKind::Pass, TIER_VIP) => "VIP",
        (PerkKind::Pass, _) => "Standard",
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
                        value: ctx.accounts.artist.name.clone(),
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
    CreateV2CpiBuilder::new(&ctx.accounts.mpl_core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .authority(Some(&ctx.accounts.artist.to_account_info()))
        .payer(&ctx.accounts.payer.to_account_info())
        .owner(Some(&ctx.accounts.buyer.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name(name)
        .uri(perk.uri.clone())
        .plugins(plugins)
        .invoke_signed(&[asset_seeds, artist_seeds])?;
    Ok(())
}

#[inline(never)]
fn pay_split(
    ctx: &Context<RedeemPerk>,
    burned: u64,
    to_rewards: u64,
    to_artist: u64,
) -> Result<()> {
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
    let decimals = ctx.accounts.mint.decimals;
    for (amount, to) in [
        (to_rewards, ctx.accounts.rewards_vault.to_account_info()),
        (to_artist, ctx.accounts.artist_vault.to_account_info()),
    ] {
        if amount > 0 {
            transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.buyer_ata.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to,
                        authority: ctx.accounts.buyer.to_account_info(),
                    },
                ),
                amount,
                decimals,
            )?;
        }
    }
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
