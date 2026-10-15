//! Anchor events. Every state transition emits one so a frontend can follow the protocol from the
//! transaction log without a backend indexer.

use anchor_lang::prelude::*;

use crate::state::PerkKind;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,
    pub launch_cooldown_secs: u32,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub buys_paused: bool,
    pub redeems_paused: bool,
    pub price_mode: u8,
    pub sol_usd_price_e6: u64,
    pub fee_bps: u16,
    pub launch_cooldown_secs: u32,
    pub max_spend_per_period_lamports: u64,
}

/// A member pulled the circuit breaker: buys and redeems are both paused.
#[event]
pub struct EmergencyPaused {
    pub by: Pubkey,
}

#[event]
pub struct AdminProposed {
    pub current: Pubkey,
    pub proposed: Pubkey,
    pub ready_ts: i64,
}

#[event]
pub struct AdminAccepted {
    pub previous: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct AdminTransferCancelled {
    pub admin: Pubkey,
    pub cancelled: Pubkey,
}

#[event]
pub struct BlacklistUpdated {
    pub wallet: Pubkey,
    pub blocked: bool,
}

#[event]
pub struct CurveCreated {
    pub curve: Pubkey,
    pub artist: Pubkey,
    pub mint: Pubkey,
    pub index: u32,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub supply_cap: u64,
    pub sale_start_ts: i64,
}

#[event]
pub struct TokensBought {
    pub curve: Pubkey,
    pub mint: Pubkey,
    pub buyer: Pubkey,
    /// 0 = SOL, 1 = USDC, 2 = curve leg of a hybrid perk
    pub quote_kind: u8,
    pub quote_in: u64,
    pub quote_net: u64,
    pub fee: u64,
    pub tokens_out: u64,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
}

#[event]
pub struct ArtistCreated {
    pub artist: Pubkey,
    pub index: u32,
    pub authority: Pubkey,
    pub name: String,
}

#[event]
pub struct ArtistUpdated {
    pub artist: Pubkey,
    pub authority: Pubkey,
    pub active: bool,
}

#[event]
pub struct PerkCreated {
    pub perk: Pubkey,
    pub artist: Pubkey,
    pub collection: Pubkey,
    pub kind: PerkKind,
    pub tier: u8,
    pub price_tokens: u64,
    pub price_lamports: u64,
    pub max_supply: u32,
}

#[event]
pub struct PerkUpdated {
    pub perk: Pubkey,
    pub artist: Pubkey,
    pub price_tokens: u64,
    pub price_lamports: u64,
    pub active: bool,
    pub max_supply: u32,
    pub public_start_ts: i64,
}

/// Emitted by both `redeem_perk` (tokens) and `buy_perk_sol` (hybrid).
#[event]
pub struct PerkRedeemed {
    pub perk: Pubkey,
    pub artist: Pubkey,
    pub buyer: Pubkey,
    pub asset: Pubkey,
    pub receipt: Pubkey,
    pub edition: u32,
    pub kind: PerkKind,
    pub tier: u8,
    pub paid_tokens: u64,
    pub paid_lamports: u64,
    pub tokens_from_curve: u64,
    pub tokens_from_artist: u64,
    pub burned: u64,
    pub to_rewards: u64,
    pub lamports_to_curve: u64,
    pub lamports_to_artist: u64,
}

#[event]
pub struct ReceiptFulfilled {
    pub receipt: Pubkey,
    pub perk: Pubkey,
    pub by: Pubkey,
}

#[event]
pub struct MemberUpdated {
    pub wallet: Pubkey,
    pub role: u8,
    pub total_weight: u16,
}

#[event]
pub struct ProposalCreated {
    pub proposal: Pubkey,
    pub index: u64,
    pub proposer: Pubkey,
    pub kind: u8,
    pub expires_ts: i64,
}

#[event]
pub struct ProposalApproved {
    pub proposal: Pubkey,
    pub member: Pubkey,
    pub weight: u16,
    pub approved_weight: u16,
    pub total_weight: u16,
}

#[event]
pub struct ProposalExecuted {
    pub proposal: Pubkey,
    pub kind: u8,
    pub by: Pubkey,
}

#[event]
pub struct ProposalCancelled {
    pub proposal: Pubkey,
    pub by: Pubkey,
}

#[event]
pub struct VaultTransferred {
    pub proposal: Pubkey,
    pub curve: Pubkey,
    pub vault: u8,
    pub destination: Pubkey,
    pub amount: u64,
}
