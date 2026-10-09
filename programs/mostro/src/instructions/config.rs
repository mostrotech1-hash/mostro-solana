use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::errors::MostroError;
use crate::events::*;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeConfigArgs {
    pub admin: Pubkey,
    pub fee_bps: u16,
    pub sol_usd_price_e6: u64,
    pub max_price_age_secs: u32,
    pub pyth_sol_usd_account: Pubkey,
    pub pyth_feed_id: [u8; 32],
    pub admin_cooloff_secs: u32,
    pub min_burn_bps: u16,
    pub min_rewards_bps: u16,
    pub admin_price_max_age_secs: u32,
}

#[derive(Accounts)]
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
        args.min_burn_bps as u64 + args.min_rewards_bps as u64 <= BPS_DENOMINATOR,
        MostroError::InvalidBps
    );
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
    let c = &mut ctx.accounts.config;
    c.bump = ctx.bumps.config;
    c.version = 1;
    c.admin = args.admin;
    c.pending_admin = Pubkey::default();
    c.admin_transfer_ready_ts = 0;
    c.admin_cooloff_secs = args.admin_cooloff_secs;
    c.usdc_mint = ctx.accounts.usdc_mint.key();
    c.treasury_bump = ctx.bumps.treasury;
    c.fee_bps = args.fee_bps;
    c.paused = false;
    c.kyc_required = false;
    c.price_mode = PRICE_MODE_ADMIN;
    c.sol_usd_price_e6 = args.sol_usd_price_e6;
    c.price_updated_ts = Clock::get()?.unix_timestamp;
    c.pyth_sol_usd_account = args.pyth_sol_usd_account;
    c.pyth_feed_id = args.pyth_feed_id;
    c.max_price_age_secs = args.max_price_age_secs;
    // Product defaults: Standard 5% / 24 h, VIP 15% / 72 h.
    c.standard_discount_bps = 500;
    c.vip_discount_bps = 1_500;
    c.standard_early_secs = 86_400;
    c.vip_early_secs = 259_200;
    c.curve_count = 0;
    c.artist_count = 0;
    c.min_burn_bps = args.min_burn_bps;
    c.min_rewards_bps = args.min_rewards_bps;
    c.admin_price_max_age_secs = args.admin_price_max_age_secs;
    emit!(ConfigInitialized {
        admin: c.admin,
        usdc_mint: c.usdc_mint,
        fee_bps: c.fee_bps,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct SetConfigArgs {
    pub paused: Option<bool>,
    pub kyc_required: Option<bool>,
    pub price_mode: Option<u8>,
    pub sol_usd_price_e6: Option<u64>,
    pub pyth_sol_usd_account: Option<Pubkey>,
    pub pyth_feed_id: Option<[u8; 32]>,
    pub max_price_age_secs: Option<u32>,
    pub fee_bps: Option<u16>,
    pub standard_discount_bps: Option<u16>,
    pub vip_discount_bps: Option<u16>,
    pub standard_early_secs: Option<u32>,
    pub vip_early_secs: Option<u32>,
    pub min_burn_bps: Option<u16>,
    pub min_rewards_bps: Option<u16>,
    pub admin_price_max_age_secs: Option<u32>,
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
    if let Some(v) = args.paused {
        c.paused = v;
    }
    if let Some(v) = args.kyc_required {
        c.kyc_required = v;
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
    if let Some(v) = args.fee_bps {
        require!(v <= 1_000, MostroError::InvalidBps);
        c.fee_bps = v;
    }
    if let Some(v) = args.standard_discount_bps {
        require!(v as u64 <= BPS_DENOMINATOR, MostroError::InvalidBps);
        c.standard_discount_bps = v;
    }
    if let Some(v) = args.vip_discount_bps {
        require!(v as u64 <= BPS_DENOMINATOR, MostroError::InvalidBps);
        c.vip_discount_bps = v;
    }
    if let Some(v) = args.standard_early_secs {
        c.standard_early_secs = v;
    }
    if let Some(v) = args.vip_early_secs {
        c.vip_early_secs = v;
    }
    let min_burn = args.min_burn_bps.unwrap_or(c.min_burn_bps);
    let min_rewards = args.min_rewards_bps.unwrap_or(c.min_rewards_bps);
    require!(
        min_burn as u64 + min_rewards as u64 <= BPS_DENOMINATOR,
        MostroError::InvalidBps
    );
    c.min_burn_bps = min_burn;
    c.min_rewards_bps = min_rewards;
    if let Some(v) = args.admin_price_max_age_secs {
        c.admin_price_max_age_secs = v;
    }
    emit!(ConfigUpdated {
        admin: c.admin,
        paused: c.paused,
        price_mode: c.price_mode,
        sol_usd_price_e6: c.sol_usd_price_e6,
        fee_bps: c.fee_bps,
        kyc_required: c.kyc_required,
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

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct SetKyc<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MostroError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + Kyc::INIT_SPACE,
        seeds = [KYC_SEED, wallet.as_ref()],
        bump,
    )]
    pub kyc: Account<'info, Kyc>,
    pub system_program: Program<'info, System>,
}

pub fn set_kyc(
    ctx: Context<SetKyc>,
    wallet: Pubkey,
    approved: bool,
    country: [u8; 2],
) -> Result<()> {
    let k = &mut ctx.accounts.kyc;
    k.bump = ctx.bumps.kyc;
    k.wallet = wallet;
    k.approved = approved;
    k.country = country;
    k.updated_ts = Clock::get()?.unix_timestamp;
    emit!(KycUpdated {
        wallet,
        approved,
        country
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawTreasurySol<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MostroError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: SystemAccount<'info>,
    /// CHECK: any destination chosen by the admin.
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn withdraw_treasury_sol(ctx: Context<WithdrawTreasurySol>, amount: u64) -> Result<()> {
    let floor = Rent::get()?.minimum_balance(0);
    require!(
        amount <= ctx.accounts.treasury.lamports().saturating_sub(floor),
        MostroError::InsufficientReserves
    );
    let bump = ctx.accounts.config.treasury_bump;
    let seeds: &[&[u8]] = &[TREASURY_SEED, &[bump]];
    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    emit!(TreasuryWithdrawn {
        destination: ctx.accounts.destination.key(),
        amount,
        usdc: false,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawTreasuryUsdc<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MostroError::Unauthorized, has_one = usdc_mint)]
    pub config: Box<Account<'info, Config>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = config,
        associated_token::token_program = usdc_token_program,
    )]
    pub treasury_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::token_program = usdc_token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn withdraw_treasury_usdc(ctx: Context<WithdrawTreasuryUsdc>, amount: u64) -> Result<()> {
    let bump = ctx.accounts.config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, &[bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.usdc_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.treasury_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;
    emit!(TreasuryWithdrawn {
        destination: ctx.accounts.destination.key(),
        amount,
        usdc: true,
    });
    Ok(())
}
