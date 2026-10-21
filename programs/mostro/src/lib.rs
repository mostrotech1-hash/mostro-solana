//! Mostro on Solana.
//!
//! One program, five concerns:
//! - `config`: the operator key (fees, price source, circuit breakers, blacklist, onboarding).
//! - `governance`: a weighted multisig (admins weigh 1, super-admins 2, threshold > 51 %) that is
//!   the only way to move the cold token reserves, the SOL / USDC vaults, the treasury, and the
//!   member list itself.
//! - `trading`: one token per artist with a fixed 1,000,000,000 supply split 28 % curve / 7 % DEX
//!   reserve / 15 % Mostro reserve / 50 % artist reserve, sold on a buy-only pump.fun-style curve
//!   that opens after a 24 h cool-down and enforces a per-wallet monthly SOL cap.
//! - `artist`: artists onboarded by the admin; they open perks and get paid in SOL.
//! - `perks`: perks paid in tokens (`redeem_perk`) or in SOL (`buy_perk_sol`, half curve / half
//!   artist reserve). Every redeem burns 80 % of the tokens involved, sends 20 % to the rewards
//!   vault and mints a Metaplex Core asset whose attributes the web app reads to apply benefits.
//!
//! Module map: `state.rs` (accounts, seeds, constants), `errors.rs`, `events.rs`, `curve.rs` (pure
//! math), `pricing.rs` (SOL/USD), `instructions/*` (one file per concern).
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod curve;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod pricing;
pub mod state;

use instructions::*;

declare_id!("4GZtfZvBFXy2YP69kE5cGL1UXjyqhSoZvQPtLtoAVDvG");

#[program]
pub mod mostro {
    use super::*;

    // ---- config / operator key ----
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        instructions::config::initialize_config(ctx, args)
    }
    pub fn set_config(ctx: Context<AdminOnly>, args: SetConfigArgs) -> Result<()> {
        instructions::config::set_config(ctx, args)
    }
    pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
        instructions::config::emergency_pause(ctx)
    }
    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        instructions::config::propose_admin(ctx, new_admin)
    }
    pub fn cancel_admin_transfer(ctx: Context<AdminOnly>) -> Result<()> {
        instructions::config::cancel_admin_transfer(ctx)
    }
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::config::accept_admin(ctx)
    }
    pub fn set_blacklist(ctx: Context<SetBlacklist>, wallet: Pubkey, blocked: bool) -> Result<()> {
        instructions::config::set_blacklist(ctx, wallet, blocked)
    }

    // ---- governance (weighted multisig) ----
    pub fn create_proposal(ctx: Context<CreateProposal>, args: CreateProposalArgs) -> Result<()> {
        instructions::governance::create_proposal(ctx, args)
    }
    pub fn approve_proposal(ctx: Context<ApproveProposal>) -> Result<()> {
        instructions::governance::approve_proposal(ctx)
    }
    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        instructions::governance::cancel_proposal(ctx)
    }
    pub fn execute_token_transfer(ctx: Context<ExecuteTokenTransfer>) -> Result<()> {
        instructions::governance::execute_token_transfer(ctx)
    }
    pub fn execute_sol_transfer(ctx: Context<ExecuteSolTransfer>) -> Result<()> {
        instructions::governance::execute_sol_transfer(ctx)
    }
    pub fn execute_set_member(ctx: Context<ExecuteSetMember>) -> Result<()> {
        instructions::governance::execute_set_member(ctx)
    }

    // ---- artist tokens / primary market ----
    pub fn create_curve(ctx: Context<CreateCurve>, args: CreateCurveArgs) -> Result<()> {
        instructions::trading::create_curve(ctx, args)
    }
    pub fn buy_tokens_sol(
        ctx: Context<BuyTokens>,
        lamports_in: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        instructions::trading::buy_tokens_sol(ctx, lamports_in, min_tokens_out)
    }
    pub fn buy_tokens_exact_out_sol(
        ctx: Context<BuyTokens>,
        tokens_out: u64,
        max_lamports_in: u64,
    ) -> Result<()> {
        instructions::trading::buy_tokens_exact_out_sol(ctx, tokens_out, max_lamports_in)
    }
    pub fn buy_tokens_usdc(
        ctx: Context<BuyTokensUsdc>,
        usdc_in: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        instructions::trading::buy_tokens_usdc(ctx, usdc_in, min_tokens_out)
    }

    // ---- artists ----
    pub fn create_artist(
        ctx: Context<CreateArtist>,
        authority: Pubkey,
        name: String,
        uri: String,
    ) -> Result<()> {
        instructions::artist::create_artist(ctx, authority, name, uri)
    }
    pub fn set_artist(ctx: Context<ManageArtist>, args: SetArtistArgs) -> Result<()> {
        instructions::artist::set_artist(ctx, args)
    }

    // ---- perks ----
    pub fn create_perk(ctx: Context<CreatePerk>, args: CreatePerkArgs) -> Result<()> {
        instructions::perks::create_perk(ctx, args)
    }
    pub fn set_perk(ctx: Context<ManagePerk>, args: SetPerkArgs) -> Result<()> {
        instructions::perks::set_perk(ctx, args)
    }
    pub fn redeem_perk(ctx: Context<RedeemPerk>, nonce: u64, max_paid: u64) -> Result<()> {
        instructions::perks::redeem_perk(ctx, nonce, max_paid)
    }
    pub fn buy_perk_sol(ctx: Context<BuyPerkSol>, nonce: u64, max_lamports: u64) -> Result<()> {
        instructions::perks::buy_perk_sol(ctx, nonce, max_lamports)
    }
    pub fn fulfill_receipt(ctx: Context<FulfillReceipt>) -> Result<()> {
        instructions::perks::fulfill_receipt(ctx)
    }
}
