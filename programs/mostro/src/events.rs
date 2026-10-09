use anchor_lang::prelude::*;

use crate::state::PerkKind;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub paused: bool,
    pub price_mode: u8,
    pub sol_usd_price_e6: u64,
    pub fee_bps: u16,
    pub kyc_required: bool,
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
pub struct KycUpdated {
    pub wallet: Pubkey,
    pub approved: bool,
    pub country: [u8; 2],
}

#[event]
pub struct CurveCreated {
    pub curve: Pubkey,
    pub mint: Pubkey,
    pub index: u32,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub supply_cap: u64,
}

#[event]
pub struct TokensBought {
    pub curve: Pubkey,
    pub mint: Pubkey,
    pub buyer: Pubkey,
    /// 0 = SOL, 1 = USDC
    pub quote_kind: u8,
    pub quote_in: u64,
    pub quote_net: u64,
    pub fee: u64,
    pub tokens_out: u64,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
}

#[event]
pub struct TokensSold {
    pub curve: Pubkey,
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub tokens_in: u64,
    pub lamports_out: u64,
    pub fee: u64,
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
pub struct PerkCreated {
    pub perk: Pubkey,
    pub artist: Pubkey,
    pub collection: Pubkey,
    pub kind: PerkKind,
    pub tier: u8,
    pub price: u64,
    pub max_supply: u32,
}

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
    pub paid: u64,
    pub burned: u64,
    pub to_rewards: u64,
    pub to_artist: u64,
    pub discount_bps: u16,
    pub pass_used: Pubkey,
}

#[event]
pub struct ReceiptFulfilled {
    pub receipt: Pubkey,
    pub perk: Pubkey,
    pub by: Pubkey,
}

#[event]
pub struct AdminTransferCancelled {
    pub admin: Pubkey,
    pub cancelled: Pubkey,
}

#[event]
pub struct TreasuryWithdrawn {
    pub destination: Pubkey,
    pub amount: u64,
    pub usdc: bool,
}

#[event]
pub struct ArtistUpdated {
    pub artist: Pubkey,
    pub authority: Pubkey,
    pub active: bool,
}

#[event]
pub struct ArtistVaultWithdrawn {
    pub artist: Pubkey,
    pub mint: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PerkUpdated {
    pub perk: Pubkey,
    pub artist: Pubkey,
    pub price: u64,
    pub active: bool,
    pub max_supply: u32,
    pub public_start_ts: i64,
    pub vip_only: bool,
    pub discount_eligible: bool,
    pub burn_bps: u16,
    pub rewards_bps: u16,
}
