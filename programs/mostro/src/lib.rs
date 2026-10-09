//! Mostro on Solana.
//!
//! One program, four concerns:
//! - `config`: admin with cool-off transfer, pause, fees, SOL/USD price source, KYC attestations.
//! - `trading`: a pump.fun-style bonding curve that mints $MOST on demand for SOL or USDC.
//! - `artist`: artists that open perks to fans and collect their share in a vault.
//! - `perks`: perks priced in $MOST (MoOG Pass, music, events, merch). Redeeming burns part of the
//!   payment, routes the rest, and mints a Metaplex Core asset into the perk's collection. Pass
//!   holders get on-chain discounts, early access and VIP-only gating.
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod curve;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod pricing;
pub mod state;

use instructions::*;

declare_id!("6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK");

#[program]
pub mod mostro {
    use super::*;

    // ---- config / admin ----
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        instructions::config::initialize_config(ctx, args)
    }
    pub fn set_config(ctx: Context<AdminOnly>, args: SetConfigArgs) -> Result<()> {
        instructions::config::set_config(ctx, args)
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
    pub fn set_kyc(
        ctx: Context<SetKyc>,
        wallet: Pubkey,
        approved: bool,
        country: [u8; 2],
    ) -> Result<()> {
        instructions::config::set_kyc(ctx, wallet, approved, country)
    }
    pub fn withdraw_treasury_sol(ctx: Context<WithdrawTreasurySol>, amount: u64) -> Result<()> {
        instructions::config::withdraw_treasury_sol(ctx, amount)
    }
    pub fn withdraw_treasury_usdc(ctx: Context<WithdrawTreasuryUsdc>, amount: u64) -> Result<()> {
        instructions::config::withdraw_treasury_usdc(ctx, amount)
    }

    // ---- curve / trading ----
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
    pub fn sell_tokens(
        ctx: Context<SellTokens>,
        tokens_in: u64,
        min_lamports_out: u64,
    ) -> Result<()> {
        instructions::trading::sell_tokens(ctx, tokens_in, min_lamports_out)
    }
    pub fn set_curve_metadata(ctx: Context<SetCurveMetadata>) -> Result<()> {
        instructions::trading::set_curve_metadata(ctx)
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
    pub fn withdraw_artist_vault(ctx: Context<WithdrawArtistVault>, amount: u64) -> Result<()> {
        instructions::artist::withdraw_artist_vault(ctx, amount)
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
    pub fn fulfill_receipt(ctx: Context<FulfillReceipt>) -> Result<()> {
        instructions::perks::fulfill_receipt(ctx)
    }
}
