//! Protocol configuration and the operator ("admin") key.
//!
//! The admin is the hot operational key: it sets fees and prices, flips the circuit breakers,
//! manages the blacklist and onboards artists. It cannot move tokens out of cold vaults or SOL
//! out of the treasury; those go through `governance.rs`.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::MostroError;
use crate::events::*;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeConfigArgs {
    /// Operator key and founding super-admin of the multisig.
    pub admin: Pubkey,
    pub fee_bps: u16,
    pub sol_usd_price_e6: u64,
    pub max_price_age_secs: u32,
    pub pyth_sol_usd_account: Pubkey,
    pub pyth_feed_id: [u8; 32],
    pub admin_cooloff_secs: u32,
    pub admin_price_max_age_secs: u32,
    /// Seconds between a token's first mint and the opening of its curve (product: 24 h).
    pub launch_cooldown_secs: u32,
    /// Anti-whale cap in lamports per wallet, per curve, per 30-day period. 0 = off.
    pub max_spend_per_period_lamports: u64,
    pub proposal_ttl_secs: u32,
}

#[derive(Accounts)]
#[instruction(args: InitializeConfigArgs)]
pub struct InitializeConfig<'info> {
    /// Must be the program's upgrade authority so nobody can front-run the init.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: system-owned PDA that only receives lamports; funded with the rent floor here.
    #[account(mut, seeds = [TREASURY_SEED], bump)]
    pub treasury: SystemAccount<'info>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = config,
        associated_token::token_program = usdc_token_program,
    )]
    pub treasury_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    /// The admin becomes the first governance member (super-admin, weight 2).
    #[account(
        init,
        payer = payer,
        space = 8 + Member::INIT_SPACE,
        seeds = [MEMBER_SEED, args.admin.as_ref()],
        bump,
    )]
    pub admin_member: Box<Account<'info, Member>>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::Mostro>,
    #[account(constraint = program_data.upgrade_authority_address == Some(payer.key()) @ MostroError::Unauthorized)]
    pub program_data: Box<Account<'info, ProgramData>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
    require!(args.fee_bps <= 1_000, MostroError::InvalidBps);
    require!(
        args.admin_price_max_age_secs > 0,
        MostroError::InvalidAmount
    );
    require!(args.proposal_ttl_secs > 0, MostroError::InvalidAmount);
    // Rent-floor the treasury so fee transfers smaller than the floor never fail.
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        ),
        Rent::get()?.minimum_balance(0),
    )?;
    let now = Clock::get()?.unix_timestamp;
    let c = &mut ctx.accounts.config;
    c.bump = ctx.bumps.config;
    c.version = 2;
    c.admin = args.admin;
    c.pending_admin = Pubkey::default();
    c.admin_transfer_ready_ts = 0;
    c.admin_cooloff_secs = args.admin_cooloff_secs;
    c.usdc_mint = ctx.accounts.usdc_mint.key();
    c.treasury_bump = ctx.bumps.treasury;
    c.fee_bps = args.fee_bps;
    c.buys_paused = false;
    c.redeems_paused = false;
    c.price_mode = PRICE_MODE_ADMIN;
    c.sol_usd_price_e6 = args.sol_usd_price_e6;
    c.price_updated_ts = now;
    c.pyth_sol_usd_account = args.pyth_sol_usd_account;
    c.pyth_feed_id = args.pyth_feed_id;
    c.max_price_age_secs = args.max_price_age_secs;
    c.admin_price_max_age_secs = args.admin_price_max_age_secs;
    c.launch_cooldown_secs = args.launch_cooldown_secs;
    c.max_spend_per_period_lamports = args.max_spend_per_period_lamports;
    c.proposal_ttl_secs = args.proposal_ttl_secs;
    c.total_weight = WEIGHT_SUPER_ADMIN;
    c.member_count = 1;
    c.proposal_count = 0;
    c.curve_count = 0;
    c.artist_count = 0;

    let m = &mut ctx.accounts.admin_member;
    m.bump = ctx.bumps.admin_member;
    m.wallet = args.admin;
    m.role = ROLE_SUPER_ADMIN;
    m.updated_ts = now;

    emit!(ConfigInitialized {
        admin: c.admin,
        usdc_mint: c.usdc_mint,
        fee_bps: c.fee_bps,
        launch_cooldown_secs: c.launch_cooldown_secs,
    });
    emit!(MemberUpdated {
        wallet: args.admin,
        role: ROLE_SUPER_ADMIN,
        total_weight: c.total_weight,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct SetConfigArgs {
    pub buys_paused: Option<bool>,
    pub redeems_paused: Option<bool>,
    pub price_mode: Option<u8>,
    pub sol_usd_price_e6: Option<u64>,
    pub pyth_sol_usd_account: Option<Pubkey>,
    pub pyth_feed_id: Option<[u8; 32]>,
    pub max_price_age_secs: Option<u32>,
    pub admin_price_max_age_secs: Option<u32>,
    pub fee_bps: Option<u16>,
    pub launch_cooldown_secs: Option<u32>,
    pub max_spend_per_period_lamports: Option<u64>,
    pub proposal_ttl_secs: Option<u32>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MostroError::Unauthorized)]
    pub config: Account<'info, Config>,
}

pub fn set_config(ctx: Context<AdminOnly>, args: SetConfigArgs) -> Result<()> {
    let c = &mut ctx.accounts.config;
    let now = Clock::get()?.unix_timestamp;
    if let Some(v) = args.buys_paused {
        c.buys_paused = v;
    }
    if let Some(v) = args.redeems_paused {
        c.redeems_paused = v;
    }
    if let Some(v) = args.price_mode {
        require!(v <= PRICE_MODE_PYTH, MostroError::InvalidPriceAccount);
        c.price_mode = v;
    }
    if let Some(v) = args.sol_usd_price_e6 {
        require!(v > 0, MostroError::PriceNonPositive);
        c.sol_usd_price_e6 = v;
        c.price_updated_ts = now;
    }
    if let Some(v) = args.pyth_sol_usd_account {
        c.pyth_sol_usd_account = v;
    }
    if let Some(v) = args.pyth_feed_id {
        c.pyth_feed_id = v;
    }
    if let Some(v) = args.max_price_age_secs {
        c.max_price_age_secs = v;
    }
    if let Some(v) = args.admin_price_max_age_secs {
        require!(v > 0, MostroError::InvalidAmount);
        c.admin_price_max_age_secs = v;
    }
    if let Some(v) = args.fee_bps {
        require!(v <= 1_000, MostroError::InvalidBps);
        c.fee_bps = v;
    }
    if let Some(v) = args.launch_cooldown_secs {
        c.launch_cooldown_secs = v;
    }
    if let Some(v) = args.max_spend_per_period_lamports {
        c.max_spend_per_period_lamports = v;
    }
    if let Some(v) = args.proposal_ttl_secs {
        require!(v > 0, MostroError::InvalidAmount);
        c.proposal_ttl_secs = v;
    }
    emit!(ConfigUpdated {
        admin: c.admin,
        buys_paused: c.buys_paused,
        redeems_paused: c.redeems_paused,
        price_mode: c.price_mode,
        sol_usd_price_e6: c.sol_usd_price_e6,
        fee_bps: c.fee_bps,
        launch_cooldown_secs: c.launch_cooldown_secs,
        max_spend_per_period_lamports: c.max_spend_per_period_lamports,
    });
    Ok(())
}

/// Circuit breaker. Any governance member can stop buys and redeems at once; only the admin can
/// resume them (`set_config`). Pausing is idempotent.
#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    pub member_wallet: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [MEMBER_SEED, member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.role != ROLE_NONE @ MostroError::NotAMember,
    )]
    pub member: Account<'info, Member>,
}

pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    c.buys_paused = true;
    c.redeems_paused = true;
    emit!(EmergencyPaused {
        by: ctx.accounts.member_wallet.key(),
    });
    Ok(())
}

pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    let c = &mut ctx.accounts.config;
    let now = Clock::get()?.unix_timestamp;
    c.pending_admin = new_admin;
    c.admin_transfer_ready_ts = now + c.admin_cooloff_secs as i64;
    emit!(AdminProposed {
        current: c.admin,
        proposed: new_admin,
        ready_ts: c.admin_transfer_ready_ts,
    });
    Ok(())
}

pub fn cancel_admin_transfer(ctx: Context<AdminOnly>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    let cancelled = c.pending_admin;
    c.pending_admin = Pubkey::default();
    c.admin_transfer_ready_ts = 0;
    emit!(AdminTransferCancelled {
        admin: c.admin,
        cancelled
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = pending_admin @ MostroError::Unauthorized)]
    pub config: Account<'info, Config>,
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    require!(
        c.pending_admin != Pubkey::default(),
        MostroError::NoPendingAdmin
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= c.admin_transfer_ready_ts,
        MostroError::AdminTransferNotReady
    );
    let previous = c.admin;
    c.admin = c.pending_admin;
    c.pending_admin = Pubkey::default();
    c.admin_transfer_ready_ts = 0;
    emit!(AdminAccepted {
        previous,
        admin: c.admin
    });
    Ok(())
}

/// Every wallet is allowed by default (no on-chain KYC: identity runs at the Openfort / Sumsub
/// layer). The admin can block a wallet; blocked wallets cannot buy on any curve or redeem perks.
#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct SetBlacklist<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MostroError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + Blacklist::INIT_SPACE,
        seeds = [BLACKLIST_SEED, wallet.as_ref()],
        bump,
    )]
    pub entry: Account<'info, Blacklist>,
    pub system_program: Program<'info, System>,
}

pub fn set_blacklist(ctx: Context<SetBlacklist>, wallet: Pubkey, blocked: bool) -> Result<()> {
    let e = &mut ctx.accounts.entry;
    e.bump = ctx.bumps.entry;
    e.wallet = wallet;
    e.blocked = blocked;
    e.updated_ts = Clock::get()?.unix_timestamp;
    emit!(BlacklistUpdated { wallet, blocked });
    Ok(())
}

/// Reads the blacklist entry that user instructions pass as a seeds-checked, possibly empty
/// account. The seeds constraint guarantees the client cannot substitute another wallet's entry;
/// an empty account means "never blacklisted".
pub fn require_not_blacklisted(entry: &AccountInfo, program_id: &Pubkey) -> Result<()> {
    if entry.owner != program_id || entry.data_is_empty() {
        return Ok(());
    }
    let data = entry.try_borrow_data()?;
    let b = Blacklist::try_deserialize(&mut &data[..])?;
    require!(!b.blocked, MostroError::Blacklisted);
    Ok(())
}
