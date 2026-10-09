use anchor_lang::prelude::*;

pub const MAX_NAME: usize = 32;
pub const MAX_SYMBOL: usize = 10;
pub const MAX_URI: usize = 200;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MOST_DECIMALS: u8 = 6;

pub const CONFIG_SEED: &[u8] = b"config";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const CURVE_SEED: &[u8] = b"curve";
pub const MINT_SEED: &[u8] = b"mint";
pub const SOL_VAULT_SEED: &[u8] = b"sol_vault";
pub const REWARDS_SEED: &[u8] = b"rewards";
pub const ARTIST_SEED: &[u8] = b"artist";
pub const ARTIST_VAULT_SEED: &[u8] = b"artist_vault";
pub const PERK_SEED: &[u8] = b"perk";
pub const COLLECTION_SEED: &[u8] = b"collection";
pub const ASSET_SEED: &[u8] = b"asset";
pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const KYC_SEED: &[u8] = b"kyc";

/// Price source for SOL/USD conversions.
pub const PRICE_MODE_ADMIN: u8 = 0;
pub const PRICE_MODE_PYTH: u8 = 1;

/// Kind of perk an artist opens to fans (mirrors the product copy: pass, music, events, merch).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum PerkKind {
    /// MoOG Pass membership. `tier` selects Standard (0) or VIP (1).
    Pass = 0,
    Music = 1,
    Event = 2,
    Merch = 3,
}

/// Pass level. Only meaningful when `PerkKind::Pass`.
pub const TIER_STANDARD: u8 = 0;
pub const TIER_VIP: u8 = 1;

/// Global protocol configuration. Single PDA `["config"]`.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub bump: u8,
    pub version: u8,
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub admin_transfer_ready_ts: i64,
    pub admin_cooloff_secs: u32,
    pub usdc_mint: Pubkey,
    pub treasury_bump: u8,
    /// Protocol fee on curve trades, in basis points of the quote amount.
    pub fee_bps: u16,
    pub paused: bool,
    /// When true, buying tokens on the curve requires an approved `Kyc` record.
    pub kyc_required: bool,
    /// 0 = admin-set price, 1 = Pyth PriceUpdateV2 account.
    pub price_mode: u8,
    /// SOL/USD with 6 decimals (used in `price_mode == 0`).
    pub sol_usd_price_e6: u64,
    pub price_updated_ts: i64,
    pub pyth_sol_usd_account: Pubkey,
    pub pyth_feed_id: [u8; 32],
    pub max_price_age_secs: u32,
    /// MoOG Pass benefits, enforced on-chain in `redeem_perk`.
    pub standard_discount_bps: u16,
    pub vip_discount_bps: u16,
    pub standard_early_secs: u32,
    pub vip_early_secs: u32,
    pub curve_count: u32,
    pub artist_count: u32,
    /// Floors every perk's split must respect (protects protocol economics from artists).
    pub min_burn_bps: u16,
    pub min_rewards_bps: u16,
    pub _reserved: [u8; 60],
}

/// A bonding curve for one token mint (the first one is $MOST). PDA `["curve", index_le]`.
#[account]
#[derive(InitSpace)]
pub struct Curve {
    pub bump: u8,
    pub version: u8,
    pub index: u32,
    pub mint: Pubkey,
    pub sol_vault_bump: u8,
    #[max_len(MAX_NAME)]
    pub name: String,
    #[max_len(MAX_SYMBOL)]
    pub symbol: String,
    #[max_len(MAX_URI)]
    pub uri: String,
    /// Constant-product virtual reserves (pump.fun style), quote = lamports.
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    /// Real SOL held in `sol_vault` that backs sells (never includes the rent floor).
    pub real_sol_reserves: u64,
    /// USDC received through `buy_tokens_usdc` (not sellable back; informational).
    pub real_usdc_reserves: u64,
    /// Max tokens the curve will ever mint. Reaching it marks the curve `complete`.
    pub supply_cap: u64,
    pub tokens_sold: u64,
    pub total_burned: u64,
    pub rewards_accrued: u64,
    pub sale_start_ts: i64,
    pub created_at: i64,
    pub complete: bool,
    pub _reserved: [u8; 64],
}

/// An artist that opens perks to fans. PDA `["artist", index_le]`.
#[account]
#[derive(InitSpace)]
pub struct Artist {
    pub bump: u8,
    pub version: u8,
    pub index: u32,
    /// Wallet allowed to manage this artist's perks and withdraw its vault.
    pub authority: Pubkey,
    #[max_len(MAX_NAME)]
    pub name: String,
    #[max_len(MAX_URI)]
    pub uri: String,
    pub perk_count: u32,
    /// Cumulative tokens routed to the artist vault.
    pub revenue_tokens: u64,
    pub active: bool,
    pub _reserved: [u8; 48],
}

/// Something a fan can redeem tokens for. PDA `["perk", artist, index_le]`.
#[account]
#[derive(InitSpace)]
pub struct Perk {
    pub bump: u8,
    pub version: u8,
    pub index: u32,
    pub artist: Pubkey,
    /// Token the perk is priced in (a curve mint).
    pub mint: Pubkey,
    /// Metaplex Core collection every redeemed asset is minted into.
    pub collection: Pubkey,
    pub collection_bump: u8,
    pub kind: PerkKind,
    /// Pass tier (0 Standard, 1 VIP). Zero for non-pass perks.
    pub tier: u8,
    /// Price in token base units (6 decimals).
    pub price: u64,
    /// Split of the paid amount: burned / rewards vault / artist vault (remainder).
    pub burn_bps: u16,
    pub rewards_bps: u16,
    /// 0 = unlimited.
    pub max_supply: u32,
    pub sold: u32,
    /// Unix time when everyone can redeem. Pass holders may redeem earlier.
    pub public_start_ts: i64,
    /// Only VIP pass holders may redeem.
    pub vip_only: bool,
    /// Whether pass discounts apply (music & merch per product copy).
    pub discount_eligible: bool,
    pub active: bool,
    #[max_len(MAX_NAME)]
    pub name: String,
    #[max_len(MAX_URI)]
    pub uri: String,
    pub _reserved: [u8; 48],
}

/// Proof of a redemption, keyed by the minted asset. PDA `["receipt", asset]`.
#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub bump: u8,
    pub version: u8,
    pub buyer: Pubkey,
    pub perk: Pubkey,
    pub artist: Pubkey,
    pub asset: Pubkey,
    pub edition: u32,
    pub kind: PerkKind,
    pub tier: u8,
    pub paid: u64,
    pub burned: u64,
    pub to_rewards: u64,
    pub to_artist: u64,
    pub discount_bps: u16,
    /// Pass asset used for discount/early access, or default if none.
    pub pass_used: Pubkey,
    pub ts: i64,
    /// Set by the artist once a physical/off-chain perk was delivered.
    pub fulfilled: bool,
    pub fulfilled_ts: i64,
    pub _reserved: [u8; 32],
}

/// KYC attestation written by the admin after the off-chain ID check. PDA `["kyc", wallet]`.
#[account]
#[derive(InitSpace)]
pub struct Kyc {
    pub bump: u8,
    pub wallet: Pubkey,
    pub approved: bool,
    /// ISO 3166-1 alpha-2, uppercase ASCII.
    pub country: [u8; 2],
    pub updated_ts: i64,
}
