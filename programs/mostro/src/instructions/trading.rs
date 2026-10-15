//! Artist tokens and their primary market.
//!
//! `create_curve` mints the whole 1,000,000,000 supply once, splits it 28 / 7 / 15 / 50 into the
//! hot curve vault and the three cold reserves, attaches Metaplex Token Metadata and revokes the
//! mint authority. From then on the token can only leave `curve_vault` through a buy (this file)
//! or through the curve leg of a hybrid perk (`perks.rs`); nothing is ever minted again.
//!
//! Buys are the only trade: there is no sell instruction. A buyer can only exit on the DEX after
//! graduation, which keeps the primary market a one-way price support.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    mint_to, set_authority, spl_token_2022::instruction::AuthorityType, transfer_checked, Mint,
    MintTo, SetAuthority, TokenAccount, TokenInterface, TransferChecked,
};

use crate::curve;
use crate::errors::MostroError;
use crate::events::*;
use crate::instructions::config::require_not_blacklisted;
use crate::pricing;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateCurveArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    /// Virtual quote reserve at genesis (lamports).
    pub virtual_sol_reserves: u64,
    /// Virtual token reserve at genesis (base units). Must exceed `CURVE_ALLOCATION`.
    pub virtual_token_reserves: u64,
    /// Requested opening time. The curve opens at the later of this and
    /// `now + config.launch_cooldown_secs`.
    pub sale_start_ts: i64,
}

/// Creates an artist's token: mint, curve, the four token vaults, the SOL vault, the USDC vault
/// and the token metadata. Admin-only. One token per artist.
#[derive(Accounts)]
pub struct CreateCurve<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MostroError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ARTIST_SEED, &artist.index.to_le_bytes()],
        bump = artist.bump,
        constraint = artist.curve == Pubkey::default() @ MostroError::ArtistHasCurve,
        constraint = artist.active @ MostroError::ArtistInactive,
    )]
    pub artist: Box<Account<'info, Artist>>,
    #[account(
        init,
        payer = admin,
        space = 8 + Curve::INIT_SPACE,
        seeds = [CURVE_SEED, &config.curve_count.to_le_bytes()],
        bump,
    )]
    pub curve: Box<Account<'info, Curve>>,
    #[account(
        init,
        payer = admin,
        seeds = [MINT_SEED, &config.curve_count.to_le_bytes()],
        bump,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = curve,
        mint::token_program = token_program,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// Hot vault: the 28 % sold on the curve.
    #[account(
        init,
        payer = admin,
        seeds = [CURVE_VAULT_SEED, curve.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = curve,
        token::token_program = token_program,
    )]
    pub curve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Cold vault: the artist's 50 %.
    #[account(
        init,
        payer = admin,
        seeds = [ARTIST_RESERVE_SEED, curve.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = curve,
        token::token_program = token_program,
    )]
    pub artist_reserve: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Cold vault: Mostro's 15 %.
    #[account(
        init,
        payer = admin,
        seeds = [MOSTRO_RESERVE_SEED, curve.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = curve,
        token::token_program = token_program,
    )]
    pub mostro_reserve: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Cold vault: the 7 % DEX liquidity reserve.
    #[account(
        init,
        payer = admin,
        seeds = [DEX_RESERVE_SEED, curve.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = curve,
        token::token_program = token_program,
    )]
    pub dex_reserve: Box<InterfaceAccount<'info, TokenAccount>>,
    /// 20 % of every redeem lands here.
    #[account(
        init,
        payer = admin,
        seeds = [REWARDS_SEED, curve.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = curve,
        token::token_program = token_program,
    )]
    pub rewards_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: system-owned PDA holding the SOL paid on the curve.
    #[account(mut, seeds = [SOL_VAULT_SEED, curve.key().as_ref()], bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(address = config.usdc_mint @ MostroError::InvalidMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = admin,
        associated_token::mint = usdc_mint,
        associated_token::authority = curve,
        associated_token::token_program = usdc_token_program,
    )]
    pub usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: Token Metadata PDA, validated by the metadata program CPI.
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
    )]
    pub metadata: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_metadata_program: Program<'info, anchor_spl::metadata::Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_curve(ctx: Context<CreateCurve>, args: CreateCurveArgs) -> Result<()> {
    require!(args.name.len() <= MAX_NAME, MostroError::StringTooLong);
    require!(args.symbol.len() <= MAX_SYMBOL, MostroError::StringTooLong);
    require!(args.uri.len() <= MAX_URI, MostroError::StringTooLong);
    require!(
        args.virtual_sol_reserves > 0 && args.virtual_token_reserves > CURVE_ALLOCATION,
        MostroError::InvalidCurveParams
    );
    let now = Clock::get()?.unix_timestamp;
    let cooldown_end = now
        .checked_add(ctx.accounts.config.launch_cooldown_secs as i64)
        .ok_or(MostroError::MathOverflow)?;
    let sale_start_ts = args.sale_start_ts.max(cooldown_end);

    // Fund the SOL vault with the rent floor so transfers never close it.
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.admin.to_account_info(),
                to: ctx.accounts.sol_vault.to_account_info(),
            },
        ),
        Rent::get()?.minimum_balance(0),
    )?;

    mint_allocations(&ctx)?;
    create_token_metadata(&ctx, &args)?;
    revoke_mint_authority(&ctx)?;

    let config = &mut ctx.accounts.config;
    let artist = &mut ctx.accounts.artist;
    let c = &mut ctx.accounts.curve;
    c.bump = ctx.bumps.curve;
    c.version = 2;
    c.index = config.curve_count;
    c.artist = artist.key();
    c.mint = ctx.accounts.mint.key();
    c.sol_vault_bump = ctx.bumps.sol_vault;
    c.name = args.name;
    c.symbol = args.symbol;
    c.uri = args.uri;
    c.virtual_sol_reserves = args.virtual_sol_reserves;
    c.virtual_token_reserves = args.virtual_token_reserves;
    c.real_sol_reserves = 0;
    c.real_usdc_reserves = 0;
    c.supply_cap = CURVE_ALLOCATION;
    c.tokens_sold = 0;
    c.artist_reserve_used = 0;
    c.total_burned = 0;
    c.rewards_accrued = 0;
    c.sale_start_ts = sale_start_ts;
    c.created_at = now;
    c.complete = false;
    artist.curve = c.key();
    config.curve_count += 1;
    emit!(CurveCreated {
        curve: c.key(),
        artist: c.artist,
        mint: c.mint,
        index: c.index,
        virtual_sol_reserves: c.virtual_sol_reserves,
        virtual_token_reserves: c.virtual_token_reserves,
        supply_cap: c.supply_cap,
        sale_start_ts: c.sale_start_ts,
    });
    Ok(())
}

fn curve_signer_seeds(curve: &Curve) -> [Vec<u8>; 3] {
    [
        CURVE_SEED.to_vec(),
        curve.index.to_le_bytes().to_vec(),
        vec![curve.bump],
    ]
}

/// Mints the fixed supply into the four vaults. The curve PDA is still the mint authority here.
#[inline(never)]
fn mint_allocations(ctx: &Context<CreateCurve>) -> Result<()> {
    let index = ctx.accounts.config.curve_count.to_le_bytes();
    let bump = ctx.bumps.curve;
    let seeds: &[&[u8]] = &[CURVE_SEED, &index, &[bump]];
    let targets = [
        (ctx.accounts.curve_vault.to_account_info(), CURVE_ALLOCATION),
        (
            ctx.accounts.artist_reserve.to_account_info(),
            ARTIST_ALLOCATION,
        ),
        (
            ctx.accounts.mostro_reserve.to_account_info(),
            MOSTRO_ALLOCATION,
        ),
        (ctx.accounts.dex_reserve.to_account_info(), DEX_ALLOCATION),
    ];
    for (to, amount) in targets {
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to,
                    authority: ctx.accounts.curve.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
    }
    Ok(())
}

/// Token Metadata needs the mint authority as a signer, so this runs before the revoke.
#[inline(never)]
fn create_token_metadata(ctx: &Context<CreateCurve>, args: &CreateCurveArgs) -> Result<()> {
    use anchor_spl::metadata::{
        create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3,
    };
    let index = ctx.accounts.config.curve_count.to_le_bytes();
    let bump = ctx.bumps.curve;
    let seeds: &[&[u8]] = &[CURVE_SEED, &index, &[bump]];
    create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                mint_authority: ctx.accounts.curve.to_account_info(),
                payer: ctx.accounts.admin.to_account_info(),
                update_authority: ctx.accounts.curve.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &[seeds],
        ),
        DataV2 {
            name: args.name.clone(),
            symbol: args.symbol.clone(),
            uri: args.uri.clone(),
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        },
        true,
        true,
        None,
    )
}

/// Fixes the supply forever: nobody, not even this program, can mint more.
#[inline(never)]
fn revoke_mint_authority(ctx: &Context<CreateCurve>) -> Result<()> {
    let index = ctx.accounts.config.curve_count.to_le_bytes();
    let bump = ctx.bumps.curve;
    let seeds: &[&[u8]] = &[CURVE_SEED, &index, &[bump]];
    set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                current_authority: ctx.accounts.curve.to_account_info(),
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
            &[seeds],
        ),
        AuthorityType::MintTokens,
        None,
    )
}

// ---- buys ---------------------------------------------------------------------------------------

/// Shared accounts for buying on the curve with SOL.
#[derive(Accounts)]
pub struct BuyTokens<'info> {
    /// Pays rent for the buyer's token account and spend tracker. Usually the buyer; can be a sponsor.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Pays the SOL and receives the tokens.
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [CURVE_SEED, &curve.index.to_le_bytes()], bump = curve.bump, has_one = mint @ MostroError::InvalidMint)]
    pub curve: Box<Account<'info, Curve>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [CURVE_VAULT_SEED, curve.key().as_ref()], bump, token::mint = mint, token::authority = curve)]
    pub curve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [SOL_VAULT_SEED, curve.key().as_ref()], bump = curve.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Anti-whale counter for this buyer on this curve.
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
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Gate shared by every curve purchase (SOL, USDC and the curve leg of a hybrid perk).
pub fn check_can_buy(
    config: &Config,
    curve: &Curve,
    blacklist_entry: &AccountInfo,
    program_id: &Pubkey,
    now: i64,
) -> Result<()> {
    require!(!config.buys_paused, MostroError::BuysPaused);
    require!(!curve.complete, MostroError::CurveComplete);
    require!(now >= curve.sale_start_ts, MostroError::SaleNotStarted);
    require_not_blacklisted(blacklist_entry, program_id)
}

/// Adds `lamports` to the buyer's 30-day counter and enforces `config.max_spend_per_period_lamports`.
pub fn record_spend(
    config: &Config,
    spend: &mut SpendTracker,
    bump: u8,
    curve: Pubkey,
    wallet: Pubkey,
    lamports: u64,
    now: i64,
) -> Result<()> {
    let period = now / SPEND_PERIOD_SECS;
    if spend.wallet == Pubkey::default() {
        spend.bump = bump;
        spend.curve = curve;
        spend.wallet = wallet;
    }
    if spend.period != period {
        spend.period = period;
        spend.spent_lamports = 0;
    }
    spend.spent_lamports = spend
        .spent_lamports
        .checked_add(lamports)
        .ok_or(MostroError::MathOverflow)?;
    if config.max_spend_per_period_lamports > 0 {
        require!(
            spend.spent_lamports <= config.max_spend_per_period_lamports,
            MostroError::SpendCapExceeded
        );
    }
    Ok(())
}

/// Moves `amount` out of `curve_vault` to `to`, signed by the curve PDA.
pub fn transfer_from_curve_vault<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    curve_vault: &InterfaceAccount<'info, TokenAccount>,
    to: AccountInfo<'info>,
    curve: &Account<'info, Curve>,
    amount: u64,
) -> Result<()> {
    let seeds = curve_signer_seeds(curve);
    let seeds: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: curve_vault.to_account_info(),
                mint: mint.to_account_info(),
                to,
                authority: curve.to_account_info(),
            },
            &[&seeds],
        ),
        amount,
        mint.decimals,
    )
}

/// Applies a buy to the curve state. `net` is the quote that entered the reserves.
pub fn apply_buy(curve: &mut Curve, net: u64, tokens_out: u64) -> Result<()> {
    require!(tokens_out > 0, MostroError::InvalidAmount);
    let sold = curve
        .tokens_sold
        .checked_add(tokens_out)
        .ok_or(MostroError::MathOverflow)?;
    require!(sold <= curve.supply_cap, MostroError::CurveSoldOut);
    curve.virtual_sol_reserves = curve
        .virtual_sol_reserves
        .checked_add(net)
        .ok_or(MostroError::MathOverflow)?;
    curve.virtual_token_reserves = curve
        .virtual_token_reserves
        .checked_sub(tokens_out)
        .ok_or(MostroError::MathOverflow)?;
    curve.tokens_sold = sold;
    curve.complete = sold == curve.supply_cap;
    Ok(())
}

/// Buy with an exact amount of SOL.
pub fn buy_tokens_sol(
    ctx: Context<BuyTokens>,
    lamports_in: u64,
    min_tokens_out: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    check_can_buy(
        &ctx.accounts.config,
        &ctx.accounts.curve,
        &ctx.accounts.blacklist_entry,
        ctx.program_id,
        now,
    )?;
    let fee_bps = ctx.accounts.config.fee_bps;
    let q = curve::buy_exact_in(
        ctx.accounts.curve.virtual_sol_reserves,
        ctx.accounts.curve.virtual_token_reserves,
        lamports_in,
        fee_bps,
    )?;
    require!(
        q.tokens_out >= min_tokens_out,
        MostroError::SlippageExceeded
    );
    settle_sol_buy(ctx, q.net_in, q.fee, q.tokens_out, now)
}

/// Buy an exact number of tokens, paying at most `max_lamports_in` (cost + fee).
pub fn buy_tokens_exact_out_sol(
    ctx: Context<BuyTokens>,
    tokens_out: u64,
    max_lamports_in: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    check_can_buy(
        &ctx.accounts.config,
        &ctx.accounts.curve,
        &ctx.accounts.blacklist_entry,
        ctx.program_id,
        now,
    )?;
    let fee_bps = ctx.accounts.config.fee_bps;
    let q = curve::buy_exact_out(
        ctx.accounts.curve.virtual_sol_reserves,
        ctx.accounts.curve.virtual_token_reserves,
        tokens_out,
        fee_bps,
    )?;
    let total = q
        .net_in
        .checked_add(q.fee)
        .ok_or(MostroError::MathOverflow)?;
    require!(total <= max_lamports_in, MostroError::SlippageExceeded);
    settle_sol_buy(ctx, q.net_in, q.fee, q.tokens_out, now)
}

fn settle_sol_buy(
    ctx: Context<BuyTokens>,
    net: u64,
    fee: u64,
    tokens_out: u64,
    now: i64,
) -> Result<()> {
    let total = net.checked_add(fee).ok_or(MostroError::MathOverflow)?;
    record_spend(
        &ctx.accounts.config,
        &mut ctx.accounts.spend,
        ctx.bumps.spend,
        ctx.accounts.curve.key(),
        ctx.accounts.buyer.key(),
        total,
        now,
    )?;
    let sys = ctx.accounts.system_program.to_account_info();
    transfer(
        CpiContext::new(
            sys.clone(),
            Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.sol_vault.to_account_info(),
            },
        ),
        net,
    )?;
    if fee > 0 {
        transfer(
            CpiContext::new(
                sys,
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            fee,
        )?;
    }
    transfer_from_curve_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.mint,
        &ctx.accounts.curve_vault,
        ctx.accounts.buyer_ata.to_account_info(),
        &ctx.accounts.curve,
        tokens_out,
    )?;
    let curve = &mut ctx.accounts.curve;
    apply_buy(curve, net, tokens_out)?;
    curve.real_sol_reserves = curve
        .real_sol_reserves
        .checked_add(net)
        .ok_or(MostroError::MathOverflow)?;
    emit!(TokensBought {
        curve: curve.key(),
        mint: ctx.accounts.mint.key(),
        buyer: ctx.accounts.buyer.key(),
        quote_kind: 0,
        quote_in: total,
        quote_net: net,
        fee,
        tokens_out,
        virtual_sol_reserves: curve.virtual_sol_reserves,
        virtual_token_reserves: curve.virtual_token_reserves,
    });
    Ok(())
}

/// Buy with USDC. The USDC amount is converted to its SOL equivalent at the configured
/// SOL/USD price (admin or Pyth) and applied to the SOL-quoted curve. USDC is kept in the
/// curve's USDC vault and counts against the anti-whale cap at its SOL equivalent.
#[derive(Accounts)]
pub struct BuyTokensUsdc<'info> {
    /// Pays rent for the buyer's token account and spend tracker. Usually the buyer; can be a sponsor.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Owns the USDC and receives the tokens.
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint @ MostroError::InvalidMint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [CURVE_SEED, &curve.index.to_le_bytes()], bump = curve.bump, has_one = mint @ MostroError::InvalidMint)]
    pub curve: Box<Account<'info, Curve>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [CURVE_VAULT_SEED, curve.key().as_ref()], bump, token::mint = mint, token::authority = curve)]
    pub curve_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = usdc_mint, token::authority = buyer, token::token_program = usdc_token_program)]
    pub buyer_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = curve,
        associated_token::token_program = usdc_token_program,
    )]
    pub usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = config,
        associated_token::token_program = usdc_token_program,
    )]
    pub treasury_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_ata: Box<InterfaceAccount<'info, TokenAccount>>,
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
    /// CHECK: Pyth PriceUpdateV2 account; validated in `pricing::sol_usd` when `price_mode == 1`.
    pub price_update: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn buy_tokens_usdc(
    ctx: Context<BuyTokensUsdc>,
    usdc_in: u64,
    min_tokens_out: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    check_can_buy(
        &ctx.accounts.config,
        &ctx.accounts.curve,
        &ctx.accounts.blacklist_entry,
        ctx.program_id,
        now,
    )?;
    let price = pricing::sol_usd(&ctx.accounts.config, &ctx.accounts.price_update, now)?;
    let lamports_equiv = pricing::usd_e6_to_lamports(usdc_in, price.price_e6)?;
    let fee_bps = ctx.accounts.config.fee_bps;
    let q = curve::buy_exact_in(
        ctx.accounts.curve.virtual_sol_reserves,
        ctx.accounts.curve.virtual_token_reserves,
        lamports_equiv,
        fee_bps,
    )?;
    require!(
        q.tokens_out >= min_tokens_out,
        MostroError::SlippageExceeded
    );
    record_spend(
        &ctx.accounts.config,
        &mut ctx.accounts.spend,
        ctx.bumps.spend,
        ctx.accounts.curve.key(),
        ctx.accounts.buyer.key(),
        lamports_equiv,
        now,
    )?;
    // Split the USDC the same way: fee share to treasury, rest to the curve vault.
    let usdc_fee = ((usdc_in as u128) * (q.fee as u128) / (lamports_equiv as u128)) as u64;
    let usdc_net = usdc_in
        .checked_sub(usdc_fee)
        .ok_or(MostroError::MathOverflow)?;
    let decimals = ctx.accounts.usdc_mint.decimals;
    transfer_checked(
        CpiContext::new(
            ctx.accounts.usdc_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.buyer_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.usdc_vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        usdc_net,
        decimals,
    )?;
    if usdc_fee > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.usdc_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.treasury_usdc.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            usdc_fee,
            decimals,
        )?;
    }
    transfer_from_curve_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.mint,
        &ctx.accounts.curve_vault,
        ctx.accounts.buyer_ata.to_account_info(),
        &ctx.accounts.curve,
        q.tokens_out,
    )?;
    let curve = &mut ctx.accounts.curve;
    apply_buy(curve, q.net_in, q.tokens_out)?;
    curve.real_usdc_reserves = curve
        .real_usdc_reserves
        .checked_add(usdc_net)
        .ok_or(MostroError::MathOverflow)?;
    emit!(TokensBought {
        curve: curve.key(),
        mint: ctx.accounts.mint.key(),
        buyer: ctx.accounts.buyer.key(),
        quote_kind: 1,
        quote_in: usdc_in,
        quote_net: usdc_net,
        fee: usdc_fee,
        tokens_out: q.tokens_out,
        virtual_sol_reserves: curve.virtual_sol_reserves,
        virtual_token_reserves: curve.virtual_token_reserves,
    });
    Ok(())
}
