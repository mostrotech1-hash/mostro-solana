import { PublicKey } from "@solana/web3.js";

/** Mostro program id (same on localnet and devnet, see Anchor.toml). */
export const PROGRAM_ID = new PublicKey("4GZtfZvBFXy2YP69kE5cGL1UXjyqhSoZvQPtLtoAVDvG");

/** Metaplex Core program. Every redeemed perk is a Core asset inside the perk's Core collection. */
export const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/** Metaplex Token Metadata program. `create_curve` creates the token's metadata there so wallets show the symbol. */
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

/** Every artist token has 6 decimals. */
export const TOKEN_DECIMALS = 6;
export const USDC_DECIMALS = 6;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const BPS_DENOMINATOR = 10_000;

// ---- fixed supply (mirror `state.rs`) ---------------------------------------------------------------

/** Base units in one whole token. */
export const TOKEN_UNIT = "1000000";
/** 1,000,000,000 whole tokens per artist, minted once in `create_curve`; the mint authority is then revoked. */
export const TOTAL_SUPPLY = "1000000000000000";
/** 28 %: sold on the bonding curve (hot vault `curve_vault`). Also `curve.supplyCap`. */
export const CURVE_ALLOCATION = "280000000000000";
/** 7 %: DEX liquidity reserve (cold vault `dex_reserve`). */
export const DEX_ALLOCATION = "70000000000000";
/** 15 %: Mostro reserve (cold vault `mostro_reserve`). */
export const MOSTRO_ALLOCATION = "150000000000000";
/** 50 %: artist reserve (cold vault `artist_reserve`), also the source of the artist half of hybrid perks. */
export const ARTIST_ALLOCATION = "500000000000000";

/** Fixed redeem split applied to every perk: 80 % burned, 20 % to the curve's rewards vault. */
export const BURN_BPS = 8_000;
export const REWARDS_BPS = 2_000;

/** Anti-whale window length: `period = unix_time / SPEND_PERIOD_SECS`. */
export const SPEND_PERIOD_SECS = 30 * 86_400;

// ---- governance -------------------------------------------------------------------------------------

/** `Member.role` and its voting weight. */
export const ROLE_NONE = 0;
export const ROLE_ADMIN = 1;
export const ROLE_SUPER_ADMIN = 2;
export const ROLE_WEIGHT: Record<number, number> = { [ROLE_NONE]: 0, [ROLE_ADMIN]: 1, [ROLE_SUPER_ADMIN]: 2 };
/** A proposal executes when `approved * 100 > total * THRESHOLD_PERCENT`. */
export const THRESHOLD_PERCENT = 51;

/** `Proposal.kind`. */
export const PROPOSAL_VAULT_TRANSFER = 0;
export const PROPOSAL_SET_MEMBER = 1;

/** `Proposal.vault` for vault transfers. Token vaults first, SOL vaults after. */
export enum VaultKind {
   ArtistReserve = 0,
   MostroReserve = 1,
   DexReserve = 2,
   Rewards = 3,
   Usdc = 4,
   TreasuryUsdc = 5,
   Sol = 6,
   TreasurySol = 7,
}
/** Vaults that belong to a curve (the proposal names the curve); the rest belong to the treasury. */
export const CURVE_VAULTS: ReadonlySet<number> = new Set([
   VaultKind.ArtistReserve,
   VaultKind.MostroReserve,
   VaultKind.DexReserve,
   VaultKind.Rewards,
   VaultKind.Usdc,
   VaultKind.Sol,
]);
/** Vaults moved with `execute_sol_transfer`; the others with `execute_token_transfer`. */
export const SOL_VAULTS: ReadonlySet<number> = new Set([VaultKind.Sol, VaultKind.TreasurySol]);

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
   curveVault: Buffer.from("curve_vault"),
   artistReserve: Buffer.from("artist_reserve"),
   mostroReserve: Buffer.from("mostro_reserve"),
   dexReserve: Buffer.from("dex_reserve"),
   solVault: Buffer.from("sol_vault"),
   rewards: Buffer.from("rewards"),
   artist: Buffer.from("artist"),
   perk: Buffer.from("perk"),
   collection: Buffer.from("collection"),
   asset: Buffer.from("asset"),
   receipt: Buffer.from("receipt"),
   blacklist: Buffer.from("blacklist"),
   member: Buffer.from("member"),
   proposal: Buffer.from("proposal"),
   approval: Buffer.from("approval"),
   spend: Buffer.from("spend"),
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

/** Devnet `Config.admin_price_max_age_secs` (mode 0) and `max_price_age_secs` (mode 1, Pyth), as seeded. Read the live values from `Config`. */
export const DEVNET_PRICE_MAX_AGE = { adminPriceMaxAgeSecs: 86_400, maxPriceAgeSecs: 300 } as const;

/** Pyth confidence ceiling enforced in price mode 1: `conf * 10_000 <= price * MAX_CONF_BPS`, else `PriceUncertain`. */
export const MAX_PRICE_CONF_BPS = 200;

/** `Perk.tier` for `PerkKind::Pass`. Informational: pass benefits are applied by the web app. */
export const TIER_CLASSIC = 0;
export const TIER_VIP = 1;

/** Product value of `Config.launch_cooldown_secs`: the curve opens 24 h after the token is created. */
export const PRODUCT_LAUNCH_COOLDOWN_SECS = 86_400;

/** Demo curve parameters: 30 SOL virtual, 379,000,000 tokens virtual (cap is the fixed 280M allocation), fee 1 %. */
export const DEMO_CURVE_PARAMS = {
   virtualSolReserves: "30000000000",
   virtualTokenReserves: "379000000000000",
   supplyCap: CURVE_ALLOCATION,
   feeBps: 100,
} as const;

/** Send parameters the fronts should use on devnet. */
export const SEND_DEFAULTS = {
   computeUnitLimit: 400_000,
   computeUnitPriceMicroLamports: 1_000,
   preflightCommitment: "confirmed",
   defaultSlippageBps: 100,
} as const;
