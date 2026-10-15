//! Weighted multisig governance.
//!
//! Members hold a role: admin (weight 1) or super-admin (weight 2). A proposal executes once the
//! approvals it collected weigh strictly more than 51 % of the live total weight
//! (`state::meets_threshold`); the threshold moves with membership. The founding super-admin is
//! created by `initialize_config`, so the protocol is never without a voter.
//!
//! What needs a proposal: moving tokens out of the cold reserves (artist, Mostro, DEX), out of the
//! rewards vault or the USDC vaults, moving SOL out of a curve's SOL vault or the treasury, and
//! adding / changing / removing members. Nothing else in the program can touch those balances.
//!
//! Lifecycle: `create_proposal` (counts as the proposer's approval) -> `approve_proposal` by other
//! members -> one of the `execute_*` instructions by any member once the threshold is met and
//! before `expires_ts`. `cancel_proposal` by the proposer or any super-admin closes it early.
//! Approvals are weighed when cast: removing a member afterwards does not retract its vote on open
//! proposals (cancel them if that matters).

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::errors::MostroError;
use crate::events::*;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateProposalArgs {
    /// `PROPOSAL_VAULT_TRANSFER` or `PROPOSAL_SET_MEMBER`.
    pub kind: u8,
    /// Vault transfer: the curve whose vault moves (zero for the treasury vaults).
    pub curve: Pubkey,
    /// Vault transfer: one of the `VAULT_*` constants.
    pub vault: u8,
    /// Vault transfer: token account (token vaults) or system account (SOL vaults) that receives.
    pub destination: Pubkey,
    /// Vault transfer: base units or lamports.
    pub amount: u64,
    /// Set member: the wallet.
    pub wallet: Pubkey,
    /// Set member: `ROLE_ADMIN`, `ROLE_SUPER_ADMIN`, or `ROLE_NONE` to remove.
    pub role: u8,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [MEMBER_SEED, proposer.key().as_ref()],
        bump = member.bump,
        constraint = member.role != ROLE_NONE @ MostroError::NotAMember,
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(
        init,
        payer = proposer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [PROPOSAL_SEED, &config.proposal_count.to_le_bytes()],
        bump,
    )]
    pub proposal: Box<Account<'info, Proposal>>,
    /// The proposer's own approval, recorded at creation.
    #[account(
        init,
        payer = proposer,
        space = 8 + Approval::INIT_SPACE,
        seeds = [APPROVAL_SEED, proposal.key().as_ref(), proposer.key().as_ref()],
        bump,
    )]
    pub approval: Box<Account<'info, Approval>>,
    pub system_program: Program<'info, System>,
}

pub fn create_proposal(ctx: Context<CreateProposal>, args: CreateProposalArgs) -> Result<()> {
    match args.kind {
        PROPOSAL_VAULT_TRANSFER => {
            require!(args.amount > 0, MostroError::InvalidAmount);
            require!(args.vault <= VAULT_TREASURY_SOL, MostroError::InvalidVault);
            let treasury = matches!(args.vault, VAULT_TREASURY_USDC | VAULT_TREASURY_SOL);
            require!(
                treasury == (args.curve == Pubkey::default()),
                MostroError::InvalidVault
            );
            require!(
                args.destination != Pubkey::default(),
                MostroError::InvalidAmount
            );
        }
        PROPOSAL_SET_MEMBER => {
            require!(args.role <= ROLE_SUPER_ADMIN, MostroError::InvalidRole);
            require!(args.wallet != Pubkey::default(), MostroError::InvalidRole);
        }
        _ => return err!(MostroError::InvalidProposalKind),
    }
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    let weight = role_weight(ctx.accounts.member.role);
    let p = &mut ctx.accounts.proposal;
    p.bump = ctx.bumps.proposal;
    p.index = config.proposal_count;
    p.proposer = ctx.accounts.proposer.key();
    p.kind = args.kind;
    p.created_ts = now;
    p.expires_ts = now + config.proposal_ttl_secs as i64;
    p.approved_weight = weight;
    p.executed = false;
    p.cancelled = false;
    p.curve = args.curve;
    p.vault = args.vault;
    p.destination = args.destination;
    p.amount = args.amount;
    p.wallet = args.wallet;
    p.role = args.role;
    config.proposal_count += 1;

    let a = &mut ctx.accounts.approval;
    a.bump = ctx.bumps.approval;
    a.proposal = p.key();
    a.member = ctx.accounts.proposer.key();
    a.weight = weight;
    a.ts = now;

    emit!(ProposalCreated {
        proposal: p.key(),
        index: p.index,
        proposer: p.proposer,
        kind: p.kind,
        expires_ts: p.expires_ts,
    });
    emit!(ProposalApproved {
        proposal: p.key(),
        member: ctx.accounts.proposer.key(),
        weight,
        approved_weight: p.approved_weight,
        total_weight: config.total_weight,
    });
    Ok(())
}

fn require_open(p: &Proposal, now: i64) -> Result<()> {
    require!(!p.executed && !p.cancelled, MostroError::ProposalClosed);
    require!(now <= p.expires_ts, MostroError::ProposalExpired);
    Ok(())
}

#[derive(Accounts)]
pub struct ApproveProposal<'info> {
    #[account(mut)]
    pub member_wallet: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [MEMBER_SEED, member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.role != ROLE_NONE @ MostroError::NotAMember,
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(mut, seeds = [PROPOSAL_SEED, &proposal.index.to_le_bytes()], bump = proposal.bump)]
    pub proposal: Box<Account<'info, Proposal>>,
    /// One approval per member per proposal: a second call fails because the PDA exists.
    #[account(
        init,
        payer = member_wallet,
        space = 8 + Approval::INIT_SPACE,
        seeds = [APPROVAL_SEED, proposal.key().as_ref(), member_wallet.key().as_ref()],
        bump,
    )]
    pub approval: Box<Account<'info, Approval>>,
    pub system_program: Program<'info, System>,
}

pub fn approve_proposal(ctx: Context<ApproveProposal>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_open(&ctx.accounts.proposal, now)?;
    let weight = role_weight(ctx.accounts.member.role);
    let p = &mut ctx.accounts.proposal;
    p.approved_weight = p
        .approved_weight
        .checked_add(weight)
        .ok_or(MostroError::MathOverflow)?;
    let a = &mut ctx.accounts.approval;
    a.bump = ctx.bumps.approval;
    a.proposal = p.key();
    a.member = ctx.accounts.member_wallet.key();
    a.weight = weight;
    a.ts = now;
    emit!(ProposalApproved {
        proposal: p.key(),
        member: a.member,
        weight,
        approved_weight: p.approved_weight,
        total_weight: ctx.accounts.config.total_weight,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    pub member_wallet: Signer<'info>,
    #[account(
        seeds = [MEMBER_SEED, member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.role != ROLE_NONE @ MostroError::NotAMember,
    )]
    pub member: Account<'info, Member>,
    #[account(
        mut,
        seeds = [PROPOSAL_SEED, &proposal.index.to_le_bytes()],
        bump = proposal.bump,
        constraint = proposal.proposer == member_wallet.key() || member.role == ROLE_SUPER_ADMIN @ MostroError::Unauthorized,
    )]
    pub proposal: Account<'info, Proposal>,
}

pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
    let p = &mut ctx.accounts.proposal;
    require!(!p.executed && !p.cancelled, MostroError::ProposalClosed);
    p.cancelled = true;
    emit!(ProposalCancelled {
        proposal: p.key(),
        by: ctx.accounts.member_wallet.key(),
    });
    Ok(())
}

/// Checks that a proposal of `kind` can execute now and marks it executed.
fn take_for_execution(p: &mut Proposal, kind: u8, total_weight: u16, now: i64) -> Result<()> {
    require!(p.kind == kind, MostroError::InvalidProposalKind);
    require_open(p, now)?;
    require!(
        meets_threshold(p.approved_weight, total_weight),
        MostroError::ThresholdNotMet
    );
    p.executed = true;
    Ok(())
}

// ---- token vaults ---------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ExecuteTokenTransfer<'info> {
    pub member_wallet: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [MEMBER_SEED, member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.role != ROLE_NONE @ MostroError::NotAMember,
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(mut, seeds = [PROPOSAL_SEED, &proposal.index.to_le_bytes()], bump = proposal.bump)]
    pub proposal: Box<Account<'info, Proposal>>,
    /// Required for curve vaults (`proposal.curve`), omitted for the treasury USDC vault.
    pub curve: Option<Box<Account<'info, Curve>>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// The vault named by `proposal.vault`; its address is recomputed and compared in the handler.
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = proposal.destination @ MostroError::ProposalMismatch, token::mint = mint, token::token_program = token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn execute_token_transfer(ctx: Context<ExecuteTokenTransfer>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let total_weight = ctx.accounts.config.total_weight;
    take_for_execution(
        &mut ctx.accounts.proposal,
        PROPOSAL_VAULT_TRANSFER,
        total_weight,
        now,
    )?;
    let p = &ctx.accounts.proposal;
    let program_id = ctx.program_id;
    let usdc_mint = ctx.accounts.config.usdc_mint;
    let token_program = ctx.accounts.token_program.key();

    // Resolve which PDA must be the source and who signs for it.
    let (expected, seeds, authority): (Pubkey, Vec<Vec<u8>>, AccountInfo) = match p.vault {
        VAULT_ARTIST_RESERVE | VAULT_MOSTRO_RESERVE | VAULT_DEX_RESERVE | VAULT_REWARDS
        | VAULT_USDC => {
            let curve = ctx
                .accounts
                .curve
                .as_ref()
                .ok_or(MostroError::ProposalMismatch)?;
            require_keys_eq!(curve.key(), p.curve, MostroError::ProposalMismatch);
            let curve_key = curve.key();
            let expected = if p.vault == VAULT_USDC {
                require_keys_eq!(ctx.accounts.mint.key(), usdc_mint, MostroError::InvalidMint);
                get_associated_token_address_with_program_id(&curve_key, &usdc_mint, &token_program)
            } else {
                require_keys_eq!(
                    ctx.accounts.mint.key(),
                    curve.mint,
                    MostroError::InvalidMint
                );
                let seed: &[u8] = match p.vault {
                    VAULT_ARTIST_RESERVE => ARTIST_RESERVE_SEED,
                    VAULT_MOSTRO_RESERVE => MOSTRO_RESERVE_SEED,
                    VAULT_DEX_RESERVE => DEX_RESERVE_SEED,
                    _ => REWARDS_SEED,
                };
                Pubkey::find_program_address(&[seed, curve_key.as_ref()], program_id).0
            };
            (
                expected,
                vec![
                    CURVE_SEED.to_vec(),
                    curve.index.to_le_bytes().to_vec(),
                    vec![curve.bump],
                ],
                curve.to_account_info(),
            )
        }
        VAULT_TREASURY_USDC => {
            require_keys_eq!(ctx.accounts.mint.key(), usdc_mint, MostroError::InvalidMint);
            let config_key = ctx.accounts.config.key();
            (
                get_associated_token_address_with_program_id(
                    &config_key,
                    &usdc_mint,
                    &token_program,
                ),
                vec![CONFIG_SEED.to_vec(), vec![ctx.accounts.config.bump]],
                ctx.accounts.config.to_account_info(),
            )
        }
        _ => return err!(MostroError::InvalidVault),
    };
    require_keys_eq!(
        ctx.accounts.source.key(),
        expected,
        MostroError::ProposalMismatch
    );
    require!(
        ctx.accounts.source.amount >= p.amount,
        MostroError::InsufficientReserves
    );
    let seeds: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.source.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority,
            },
            &[&seeds],
        ),
        p.amount,
        ctx.accounts.mint.decimals,
    )?;
    emit!(VaultTransferred {
        proposal: p.key(),
        curve: p.curve,
        vault: p.vault,
        destination: p.destination,
        amount: p.amount,
    });
    emit!(ProposalExecuted {
        proposal: p.key(),
        kind: p.kind,
        by: ctx.accounts.member_wallet.key(),
    });
    Ok(())
}

// ---- SOL vaults ---------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ExecuteSolTransfer<'info> {
    pub member_wallet: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [MEMBER_SEED, member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.role != ROLE_NONE @ MostroError::NotAMember,
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(mut, seeds = [PROPOSAL_SEED, &proposal.index.to_le_bytes()], bump = proposal.bump)]
    pub proposal: Box<Account<'info, Proposal>>,
    /// Required for `VAULT_SOL` (`proposal.curve`), omitted for `VAULT_TREASURY_SOL`.
    #[account(mut)]
    pub curve: Option<Box<Account<'info, Curve>>>,
    /// CHECK: `["sol_vault", curve]` or `["treasury"]`; recomputed and compared in the handler.
    #[account(mut)]
    pub source: UncheckedAccount<'info>,
    /// CHECK: any system account named by the proposal.
    #[account(mut, address = proposal.destination @ MostroError::ProposalMismatch)]
    pub destination: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn execute_sol_transfer(ctx: Context<ExecuteSolTransfer>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let total_weight = ctx.accounts.config.total_weight;
    take_for_execution(
        &mut ctx.accounts.proposal,
        PROPOSAL_VAULT_TRANSFER,
        total_weight,
        now,
    )?;
    let p = &ctx.accounts.proposal;
    let (expected, seeds): (Pubkey, Vec<Vec<u8>>) = match p.vault {
        VAULT_SOL => {
            let curve = ctx
                .accounts
                .curve
                .as_ref()
                .ok_or(MostroError::ProposalMismatch)?;
            require_keys_eq!(curve.key(), p.curve, MostroError::ProposalMismatch);
            require!(
                p.amount <= curve.real_sol_reserves,
                MostroError::InsufficientReserves
            );
            let curve_key = curve.key();
            (
                Pubkey::create_program_address(
                    &[SOL_VAULT_SEED, curve_key.as_ref(), &[curve.sol_vault_bump]],
                    ctx.program_id,
                )
                .map_err(|_| error!(MostroError::ProposalMismatch))?,
                vec![
                    SOL_VAULT_SEED.to_vec(),
                    curve_key.to_bytes().to_vec(),
                    vec![curve.sol_vault_bump],
                ],
            )
        }
        VAULT_TREASURY_SOL => (
            Pubkey::create_program_address(
                &[TREASURY_SEED, &[ctx.accounts.config.treasury_bump]],
                ctx.program_id,
            )
            .map_err(|_| error!(MostroError::ProposalMismatch))?,
            vec![
                TREASURY_SEED.to_vec(),
                vec![ctx.accounts.config.treasury_bump],
            ],
        ),
        _ => return err!(MostroError::InvalidVault),
    };
    require_keys_eq!(
        ctx.accounts.source.key(),
        expected,
        MostroError::ProposalMismatch
    );
    // Both SOL vaults keep their rent floor so the PDA can never be garbage-collected.
    let floor = Rent::get()?.minimum_balance(0);
    require!(
        p.amount <= ctx.accounts.source.lamports().saturating_sub(floor),
        MostroError::InsufficientReserves
    );
    let seeds: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.source.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
            },
            &[&seeds],
        ),
        p.amount,
    )?;
    if p.vault == VAULT_SOL {
        let curve = ctx.accounts.curve.as_mut().unwrap();
        curve.real_sol_reserves -= p.amount;
    }
    emit!(VaultTransferred {
        proposal: p.key(),
        curve: p.curve,
        vault: p.vault,
        destination: p.destination,
        amount: p.amount,
    });
    emit!(ProposalExecuted {
        proposal: p.key(),
        kind: p.kind,
        by: ctx.accounts.member_wallet.key(),
    });
    Ok(())
}

// ---- membership -----------------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ExecuteSetMember<'info> {
    #[account(mut)]
    pub member_wallet: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        seeds = [MEMBER_SEED, member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.role != ROLE_NONE @ MostroError::NotAMember,
    )]
    pub member: Box<Account<'info, Member>>,
    #[account(mut, seeds = [PROPOSAL_SEED, &proposal.index.to_le_bytes()], bump = proposal.bump)]
    pub proposal: Box<Account<'info, Proposal>>,
    /// The member record of `proposal.wallet`, created on first appointment.
    #[account(
        init_if_needed,
        payer = member_wallet,
        space = 8 + Member::INIT_SPACE,
        seeds = [MEMBER_SEED, proposal.wallet.as_ref()],
        bump,
    )]
    pub target: Box<Account<'info, Member>>,
    pub system_program: Program<'info, System>,
}

pub fn execute_set_member(ctx: Context<ExecuteSetMember>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let total_weight = ctx.accounts.config.total_weight;
    take_for_execution(
        &mut ctx.accounts.proposal,
        PROPOSAL_SET_MEMBER,
        total_weight,
        now,
    )?;
    let p = &ctx.accounts.proposal;
    let t = &mut ctx.accounts.target;
    let old_weight = role_weight(t.role);
    let new_weight = role_weight(p.role);
    let config = &mut ctx.accounts.config;
    let new_total = config
        .total_weight
        .checked_sub(old_weight)
        .and_then(|w| w.checked_add(new_weight))
        .ok_or(MostroError::MathOverflow)?;
    require!(new_total > 0, MostroError::LastMember);
    config.total_weight = new_total;
    if old_weight == 0 && new_weight > 0 {
        config.member_count += 1;
    } else if old_weight > 0 && new_weight == 0 {
        config.member_count -= 1;
    }
    t.bump = ctx.bumps.target;
    t.wallet = p.wallet;
    t.role = p.role;
    t.updated_ts = now;
    emit!(MemberUpdated {
        wallet: p.wallet,
        role: p.role,
        total_weight: config.total_weight,
    });
    emit!(ProposalExecuted {
        proposal: p.key(),
        kind: p.kind,
        by: ctx.accounts.member_wallet.key(),
    });
    Ok(())
}
