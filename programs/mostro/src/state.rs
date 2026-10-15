//! On-chain account layouts, PDA seeds and protocol constants.
//!
//! Every number that the product fixed in the 2026-10-13 contract review is a constant here, not a
//! configurable field: the 1,000,000,000 token supply and its 28 / 7 / 15 / 50 split, the 80 / 20
//! burn / rewards split of every redeem, and the 51 % multisig threshold. Operational knobs (fees,
//! price source, launch cool-down length, anti-whale cap, proposal lifetime) live in `Config`.

use anchor_lang::prelude::*;

// ---- limits ----------------------------------------------------------------------------------------

pub const MAX_NAME: usize = 32;
pub const MAX_SYMBOL: usize = 10;
pub const MAX_URI: usize = 200;
pub const BPS_DENOMINATOR: u64 = 10_000;

// ---- token supply ------------------------------------------------------------------------------

/// Every artist token has 6 decimals.
pub const TOKEN_DECIMALS: u8 = 6;
/// Base units in one whole token.
pub const TOKEN_UNIT: u64 = 1_000_000;
/// Fixed total supply of each artist token: 1,000,000,000 whole tokens. Minted once in
/// `create_curve`; the mint authority is revoked in the same instruction.
pub const TOTAL_SUPPLY: u64 = 1_000_000_000 * TOKEN_UNIT;
/// 28 %: primary market, sold on the bonding curve (hot vault).
pub const CURVE_ALLOCATION: u64 = 280_000_000 * TOKEN_UNIT;
/// 7 %: liquidity reserve for the DEX pool at graduation (cold vault).
pub const DEX_ALLOCATION: u64 = 70_000_000 * TOKEN_UNIT;
/// 15 %: Mostro reserve (cold vault).
pub const MOSTRO_ALLOCATION: u64 = 150_000_000 * TOKEN_UNIT;
/// 50 %: artist reserve (cold vault). Also the source of the artist half of hybrid perks.
pub const ARTIST_ALLOCATION: u64 = 500_000_000 * TOKEN_UNIT;
const _: () = assert!(
    CURVE_ALLOCATION + DEX_ALLOCATION + MOSTRO_ALLOCATION + ARTIST_ALLOCATION == TOTAL_SUPPLY,
    "allocations must add up to the total supply"
);

// ---- redeem economics ----------------------------------------------------------------------------

/// Share of every redeem that is burned.
pub const BURN_BPS: u64 = 8_000;
/// Share of every redeem that goes to the curve's rewards vault. The remainder is zero: the artist
/// is paid in SOL on hybrid perks, never in tokens.
pub const REWARDS_BPS: u64 = 2_000;
const _: () = assert!(BURN_BPS + REWARDS_BPS == BPS_DENOMINATOR);

/// Anti-whale window: SOL spent per wallet per curve is counted in 30-day periods
/// (`period = unix_time / SPEND_PERIOD_SECS`).
pub const SPEND_PERIOD_SECS: i64 = 30 * 86_400;

// ---- governance ---------------------------------------------------------------------------------

/// `Member.role` values and their voting weight.
pub const ROLE_NONE: u8 = 0;
pub const ROLE_ADMIN: u8 = 1;
pub const ROLE_SUPER_ADMIN: u8 = 2;
pub const WEIGHT_ADMIN: u16 = 1;
pub const WEIGHT_SUPER_ADMIN: u16 = 2;

/// A proposal executes when `approved_weight * 100 > total_weight * THRESHOLD_PERCENT`
/// (strictly more than 51 % of the live voting weight).
pub const THRESHOLD_PERCENT: u64 = 51;

/// `Proposal.kind`.
pub const PROPOSAL_VAULT_TRANSFER: u8 = 0;
pub const PROPOSAL_SET_MEMBER: u8 = 1;

/// `Proposal.vault` for `PROPOSAL_VAULT_TRANSFER`. Token vaults first, SOL vaults after.
pub const VAULT_ARTIST_RESERVE: u8 = 0;
pub const VAULT_MOSTRO_RESERVE: u8 = 1;
pub const VAULT_DEX_RESERVE: u8 = 2;
pub const VAULT_REWARDS: u8 = 3;
pub const VAULT_USDC: u8 = 4;
pub const VAULT_TREASURY_USDC: u8 = 5;
pub const VAULT_SOL: u8 = 6;
pub const VAULT_TREASURY_SOL: u8 = 7;

/// Voting weight of a role. `ROLE_NONE` (removed member) weighs nothing.
pub fn role_weight(role: u8) -> u16 {
    match role {
        ROLE_ADMIN => WEIGHT_ADMIN,
        ROLE_SUPER_ADMIN => WEIGHT_SUPER_ADMIN,
        _ => 0,
    }
}

/// The dynamic threshold: strictly more than 51 % of the current total weight.
pub fn meets_threshold(approved_weight: u16, total_weight: u16) -> bool {
    total_weight > 0 && (approved_weight as u64) * 100 > (total_weight as u64) * THRESHOLD_PERCENT
}

// ---- seeds --------------------------------------------------------------------------------------

pub const CONFIG_SEED: &[u8] = b"config";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const CURVE_SEED: &[u8] = b"curve";
pub const MINT_SEED: &[u8] = b"mint";
pub const CURVE_VAULT_SEED: &[u8] = b"curve_vault";
pub const ARTIST_RESERVE_SEED: &[u8] = b"artist_reserve";
pub const MOSTRO_RESERVE_SEED: &[u8] = b"mostro_reserve";
pub const DEX_RESERVE_SEED: &[u8] = b"dex_reserve";
pub const SOL_VAULT_SEED: &[u8] = b"sol_vault";
pub const REWARDS_SEED: &[u8] = b"rewards";
pub const ARTIST_SEED: &[u8] = b"artist";
pub const PERK_SEED: &[u8] = b"perk";
pub const COLLECTION_SEED: &[u8] = b"collection";
pub const ASSET_SEED: &[u8] = b"asset";
pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const BLACKLIST_SEED: &[u8] = b"blacklist";
pub const MEMBER_SEED: &[u8] = b"member";
pub const PROPOSAL_SEED: &[u8] = b"proposal";
pub const APPROVAL_SEED: &[u8] = b"approval";
pub const SPEND_SEED: &[u8] = b"spend";

/// Price source for SOL/USD conversions.
pub const PRICE_MODE_ADMIN: u8 = 0;
pub const PRICE_MODE_PYTH: u8 = 1;

/// Kind of perk an artist opens to fans. The program does not interpret it: it is written into the
/// minted asset's attributes so the web app can render the right benefit. Pass benefits (discounts,
/// early access, VIP areas) are applied by the web app, not on-chain.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum PerkKind {
    /// Mostro Pass membership. `tier` selects Classic (0) or VIP (1).
    Pass = 0,
    Music = 1,
    Event = 2,
    Merch = 3,
}

/// Pass level. Only meaningful when `PerkKind::Pass`.
pub const TIER_CLASSIC: u8 = 0;
pub const TIER_VIP: u8 = 1;

// ---- accounts -----------------------------------------------------------------------------------

/// Global protocol configuration. Single PDA `["config"]`.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub bump: u8,
    pub version: u8,
    /// Operator key: pauses, prices, blacklist, onboarding. Cannot move cold vaults or treasury.
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub admin_transfer_ready_ts: i64,
    pub admin_cooloff_secs: u32,
    pub usdc_mint: Pubkey,
    pub treasury_bump: u8,
    /// Protocol fee on curve buys, in basis points of the quote amount.
    pub fee_bps: u16,
    /// Circuit breakers. Buys cover every curve purchase (SOL, USDC, the curve leg of a hybrid
    /// perk); redeems cover `redeem_perk` and `buy_perk_sol`.
    pub buys_paused: bool,
    pub redeems_paused: bool,
    /// 0 = admin-set price, 1 = Pyth PriceUpdateV2 account.
    pub price_mode: u8,
    /// SOL/USD with 6 decimals (used in `price_mode == 0`).
    pub sol_usd_price_e6: u64,
    pub price_updated_ts: i64,
    pub pyth_sol_usd_account: Pubkey,
    pub pyth_feed_id: [u8; 32],
    /// Max age of a Pyth price (mode 1).
    pub max_price_age_secs: u32,
    /// Max age of the admin-set SOL/USD price (mode 0).
    pub admin_price_max_age_secs: u32,
    /// Seconds between a token's creation (first mint) and the opening of its curve.
    pub launch_cooldown_secs: u32,
    /// Anti-whale cap: lamports a wallet may put into one curve per 30-day period. 0 = no cap.
    pub max_spend_per_period_lamports: u64,
    /// Lifetime of a governance proposal.
    pub proposal_ttl_secs: u32,
    /// Sum of the voting weights of all current members.
    pub total_weight: u16,
    pub member_count: u16,
    pub proposal_count: u64,
    pub curve_count: u32,
    pub artist_count: u32,
    pub _reserved: [u8; 64],
}

/// One artist token and its bonding curve. PDA `["curve", index_le]`.
///
/// Vaults (all owned by this PDA): `curve_vault` (hot, 28 %), `artist_reserve` (cold, 50 %),
/// `mostro_reserve` (cold, 15 %), `dex_reserve` (cold, 7 %), `rewards_vault` (20 % of redeems),
/// `sol_vault` (SOL paid on the curve) and the USDC ATA. Cold vaults, `sol_vault` and the USDC
/// vault move only through an executed governance proposal.
#[account]
#[derive(InitSpace)]
pub struct Curve {
    pub bump: u8,
    pub version: u8,
    pub index: u32,
    /// Artist PDA this token belongs to. One token per artist.
    pub artist: Pubkey,
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
    /// Real SOL held in `sol_vault` (never includes the rent floor).
    pub real_sol_reserves: u64,
    /// USDC received through `buy_tokens_usdc` (informational).
    pub real_usdc_reserves: u64,
    /// Tokens the curve may sell: `CURVE_ALLOCATION`. Reaching it marks the curve `complete`.
    pub supply_cap: u64,
    /// Tokens that left `curve_vault` through buys and hybrid perks.
    pub tokens_sold: u64,
    /// Tokens that left `artist_reserve` through hybrid perks.
    pub artist_reserve_used: u64,
    pub total_burned: u64,
    pub rewards_accrued: u64,
    /// Opening time of the curve: `created_at + config.launch_cooldown_secs` at the earliest.
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
    /// Wallet that manages this artist's perks and receives the artist half of hybrid perk sales.
    pub authority: Pubkey,
    /// The artist's curve, or `Pubkey::default()` until `create_curve` runs for it.
    pub curve: Pubkey,
    #[max_len(MAX_NAME)]
    pub name: String,
    #[max_len(MAX_URI)]
    pub uri: String,
    pub perk_count: u32,
    /// Cumulative lamports paid to `authority` by hybrid perks.
    pub revenue_lamports: u64,
    pub active: bool,
    pub _reserved: [u8; 48],
}

/// Something a fan can get. PDA `["perk", artist, index_le]`.
///
/// Exactly one of `price_tokens` / `price_lamports` is non-zero:
/// - `price_tokens > 0`: the fan pays tokens from its wallet (`redeem_perk`).
/// - `price_lamports > 0`: hybrid perk, the fan pays SOL (`buy_perk_sol`); the tokens come half from
///   the curve and half from the artist reserve.
///
/// Either way 80 % of the tokens involved are burned and 20 % go to the rewards vault.
#[account]
#[derive(InitSpace)]
pub struct Perk {
    pub bump: u8,
    pub version: u8,
    pub index: u32,
    pub artist: Pubkey,
    /// Token the perk is tied to (the artist's curve mint).
    pub mint: Pubkey,
    /// Metaplex Core collection every minted asset belongs to.
    pub collection: Pubkey,
    pub collection_bump: u8,
    pub kind: PerkKind,
    /// Pass tier (0 Classic, 1 VIP). Zero for non-pass perks. Informational.
    pub tier: u8,
    /// Price in token base units (6 decimals). 0 for hybrid perks.
    pub price_tokens: u64,
    /// Price in lamports. 0 for token-priced perks.
    pub price_lamports: u64,
    /// 0 = unlimited.
    pub max_supply: u32,
    pub sold: u32,
    /// Unix time from which the perk can be redeemed.
    pub public_start_ts: i64,
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
    /// Tokens the buyer spent from its wallet (token-priced perks).
    pub paid_tokens: u64,
    /// Lamports the buyer spent (hybrid perks).
    pub paid_lamports: u64,
    /// Tokens taken from `curve_vault` (hybrid perks).
    pub tokens_from_curve: u64,
    /// Tokens taken from `artist_reserve` (hybrid perks).
    pub tokens_from_artist: u64,
    pub burned: u64,
    pub to_rewards: u64,
    /// Lamports that went into the curve (`sol_vault` + fee) and to the artist wallet.
    pub lamports_to_curve: u64,
    pub lamports_to_artist: u64,
    pub ts: i64,
    /// Set by the artist once a physical/off-chain perk was delivered.
    pub fulfilled: bool,
    pub fulfilled_ts: i64,
    pub _reserved: [u8; 32],
}

/// Blacklist entry. Every wallet is allowed unless `["blacklist", wallet]` exists with
/// `blocked == true`. Written by the admin. PDA `["blacklist", wallet]`.
#[account]
#[derive(InitSpace)]
pub struct Blacklist {
    pub bump: u8,
    pub wallet: Pubkey,
    pub blocked: bool,
    pub updated_ts: i64,
}

/// Governance member. PDA `["member", wallet]`. `role == ROLE_NONE` means removed.
#[account]
#[derive(InitSpace)]
pub struct Member {
    pub bump: u8,
    pub wallet: Pubkey,
    pub role: u8,
    pub updated_ts: i64,
}

/// A governance proposal. PDA `["proposal", index_le]`. Payload fields are flat so the IDL stays
/// simple; the ones a `kind` does not use are zero.
#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub bump: u8,
    pub index: u64,
    pub proposer: Pubkey,
    /// `PROPOSAL_VAULT_TRANSFER` or `PROPOSAL_SET_MEMBER`.
    pub kind: u8,
    pub created_ts: i64,
    pub expires_ts: i64,
    pub approved_weight: u16,
    pub executed: bool,
    pub cancelled: bool,
    /// Vault transfer: the curve (zero for treasury vaults), which vault, where to, how much.
    pub curve: Pubkey,
    pub vault: u8,
    pub destination: Pubkey,
    pub amount: u64,
    /// Set member: the wallet and its new role (`ROLE_NONE` removes it).
    pub wallet: Pubkey,
    pub role: u8,
    pub _reserved: [u8; 32],
}

/// One member's approval of one proposal. PDA `["approval", proposal, wallet]`.
#[account]
#[derive(InitSpace)]
pub struct Approval {
    pub bump: u8,
    pub proposal: Pubkey,
    pub member: Pubkey,
    pub weight: u16,
    pub ts: i64,
}

/// Anti-whale tracker: lamports one wallet put into one curve in the current 30-day period.
/// PDA `["spend", curve, wallet]`.
#[account]
#[derive(InitSpace)]
pub struct SpendTracker {
    pub bump: u8,
    pub curve: Pubkey,
    pub wallet: Pubkey,
    /// `unix_time / SPEND_PERIOD_SECS` of the period `spent_lamports` refers to.
    pub period: i64,
    pub spent_lamports: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_is_strictly_above_51_percent() {
        // 5 super-admins + 5 admins = 15: 8 needed (7 * 100 = 700 <= 765).
        assert!(!meets_threshold(7, 15));
        assert!(meets_threshold(8, 15));
        // The founding super-admin alone (2 of 2).
        assert!(meets_threshold(2, 2));
        // One super-admin out of a super-admin + an admin (2 of 3 = 66 %).
        assert!(meets_threshold(2, 3));
        // One admin out of the same set (1 of 3 = 33 %).
        assert!(!meets_threshold(1, 3));
        // Exactly 51 % is not enough: 51 of 100.
        assert!(!meets_threshold(51, 100));
        assert!(meets_threshold(52, 100));
        assert!(!meets_threshold(0, 0));
    }

    #[test]
    fn role_weights() {
        assert_eq!(role_weight(ROLE_NONE), 0);
        assert_eq!(role_weight(ROLE_ADMIN), 1);
        assert_eq!(role_weight(ROLE_SUPER_ADMIN), 2);
        assert_eq!(role_weight(9), 0);
    }

    #[test]
    fn allocations_add_up() {
        assert_eq!(
            CURVE_ALLOCATION + DEX_ALLOCATION + MOSTRO_ALLOCATION + ARTIST_ALLOCATION,
            TOTAL_SUPPLY
        );
        assert_eq!(TOTAL_SUPPLY, 1_000_000_000_000_000);
    }
}
