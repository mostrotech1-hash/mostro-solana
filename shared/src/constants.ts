import { PublicKey } from "@solana/web3.js";

/** Mostro program id (same on localnet and devnet, see Anchor.toml). */
export const PROGRAM_ID = new PublicKey("6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK");

/** Metaplex Core program. Every redeemed perk is a Core asset inside the perk's Core collection. */
export const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/** Metaplex Token Metadata program. `set_curve_metadata` creates the curve mint's metadata there so wallets show the symbol. */
export const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/** Circle devnet USDC mint (6 decimals, classic Token program). */
export const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/** Pyth Solana receiver program (same on devnet and mainnet). */
export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/** Pyth SOL/USD `PriceUpdateV2` account on devnet (feed id below). */
export const PYTH_SOL_USD_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");

/** Pyth SOL/USD feed id, hex without 0x. */
export const PYTH_SOL_USD_FEED_ID_HEX = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

/** Pyth SOL/USD feed id as 32 bytes. */
export const PYTH_SOL_USD_FEED_ID = Uint8Array.from(Buffer.from(PYTH_SOL_USD_FEED_ID_HEX, "hex"));

/** $MOST (and every curve mint) has 6 decimals. */
export const MOST_DECIMALS = 6;
export const USDC_DECIMALS = 6;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const BPS_DENOMINATOR = 10_000;

/** String limits enforced on-chain. */
export const MAX_NAME = 32;
export const MAX_SYMBOL = 10;
export const MAX_URI = 200;

/** PDA seeds (mirror `state.rs`). */
export const SEEDS = {
   config: Buffer.from("config"),
   treasury: Buffer.from("treasury"),
   curve: Buffer.from("curve"),
   mint: Buffer.from("mint"),
   solVault: Buffer.from("sol_vault"),
   rewards: Buffer.from("rewards"),
   artist: Buffer.from("artist"),
   artistVault: Buffer.from("artist_vault"),
   perk: Buffer.from("perk"),
   collection: Buffer.from("collection"),
   asset: Buffer.from("asset"),
   receipt: Buffer.from("receipt"),
   kyc: Buffer.from("kyc"),
   /** Token Metadata program seed (not a seed of this program). */
   metadata: Buffer.from("metadata"),
} as const;

/** `Config.price_mode` values. */
export const PRICE_MODE_ADMIN = 0;
export const PRICE_MODE_PYTH = 1;

/** `Perk.kind` discriminants (Rust `#[repr(u8)] enum PerkKind`). */
export enum PerkKindCode {
   Pass = 0,
   Music = 1,
   Event = 2,
   Merch = 3,
}

/**
 * `CreatePerkArgs.collection_salt` used by the devnet seed for every perk. The Core collection PDA is
 * `["collection", perk, salt u64 LE]`; the salt lets a perk whose collection creation failed half-way be
 * retried under a fresh address. Reads should trust `perk.collection` on-chain, not re-derive.
 */
export const DEFAULT_COLLECTION_SALT = 1;

/** Pyth confidence ceiling enforced in price mode 1: `conf * 10_000 <= price * MAX_CONF_BPS`, else `PriceUncertain`. */
export const MAX_PRICE_CONF_BPS = 200;

/** `Perk.tier` for `PerkKind::Pass`. */
export const TIER_STANDARD = 0;
export const TIER_VIP = 1;

/** Product defaults written by `initialize_config` (also readable live from `Config`). */
export const DEFAULT_PASS_BENEFITS = {
   standardDiscountBps: 500,
   vipDiscountBps: 1_500,
   standardEarlySecs: 86_400,
   vipEarlySecs: 259_200,
} as const;

/** Default redeem split: burn 80%, rewards 20%, artist 0% (configurable per perk). */
export const DEFAULT_REDEEM_SPLIT = { burnBps: 8_000, rewardsBps: 2_000 } as const;

/**
 * Protocol floors every perk split must respect (`Config.min_burn_bps` / `min_rewards_bps`, settable with
 * `set_config`). The devnet seed writes 0 / 0; read the live values from `Config` before building `create_perk`.
 */
export const DEFAULT_SPLIT_FLOORS = { minBurnBps: 0, minRewardsBps: 0 } as const;

/** Demo curve parameters ("set B"): 30 SOL virtual, 1,000,000 tokens virtual, cap 800,000, fee 1%. */
export const DEMO_CURVE_PARAMS = {
   virtualSolReserves: "30000000000",
   virtualTokenReserves: "1000000000000",
   supplyCap: "800000000000",
   feeBps: 100,
   saleStartTs: 0,
} as const;

/** Demo perk price points in $MOST base units (6 decimals). */
export const DEMO_PERK_PRICES = {
   passStandard: 1_200_000_000,
   passVip: 3_750_000_000,
   musicFrom: 50_000_000,
   eventFrom: 900_000_000,
   merchFrom: 1_500_000_000,
} as const;

/** Send parameters the fronts should use on devnet. */
export const SEND_DEFAULTS = {
   computeUnitLimit: 400_000,
   computeUnitPriceMicroLamports: 1_000,
   preflightCommitment: "confirmed",
   defaultSlippageBps: 100,
} as const;
