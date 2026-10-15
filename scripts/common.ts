/**
 * Shared plumbing for the operational scripts in `scripts/`.
 *
 * - Provider / program setup from `Anchor.toml` `[provider]` or the `ANCHOR_PROVIDER_URL` /
 *   `ANCHOR_WALLET` environment variables.
 * - PDA helpers duplicated here on purpose so the scripts never depend on the `shared/` build order.
 * - Curve math mirrored from `programs/mostro/src/curve.rs` (same integer rounding) for slippage bounds.
 * - Small logging / formatting helpers.
 *
 * Every script runs from the repo root with `npx ts-node scripts/<name>.ts`.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AnchorProvider, BN, Program, Wallet, setProvider } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idlJson from "../shared/idl/mostro.json";
import type { Mostro } from "../shared/types/mostro";

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

export const REPO_ROOT = path.resolve(__dirname, "..");
export const IDL = idlJson as Mostro;
export const PROGRAM_ID = new PublicKey(IDL.address);
export const PROGRAM_VERSION: string = (idlJson as { metadata: { version: string } }).metadata.version;

export const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const USDC_MINT_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const PYTH_SOL_USD_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
export const PYTH_SOL_USD_FEED_ID_HEX = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
export const CIRCLE_FAUCET_URL = "https://faucet.circle.com";

export const TOKEN_DECIMALS = 6;
export const USDC_DECIMALS = 6;
export const BPS_DENOMINATOR = 10_000n;
export const LAMPORTS_PER_SOL_BI = 1_000_000_000n;

/** Fixed supply and allocations (mirror `state.rs`), in base units. */
export const TOKEN_UNIT = 1_000_000n;
export const TOTAL_SUPPLY = 1_000_000_000n * TOKEN_UNIT;
export const CURVE_ALLOCATION = 280_000_000n * TOKEN_UNIT;
export const DEX_ALLOCATION = 70_000_000n * TOKEN_UNIT;
export const MOSTRO_ALLOCATION = 150_000_000n * TOKEN_UNIT;
export const ARTIST_ALLOCATION = 500_000_000n * TOKEN_UNIT;
export const BURN_BPS = 8_000n;

/** Pass tiers (mirror `state.rs`). Informational: pass benefits are applied by the web app. */
export const TIER_CLASSIC = 0;
export const TIER_VIP = 1;

/** Price modes (mirror `state.rs`). */
export const PRICE_MODE_ADMIN = 0;
export const PRICE_MODE_PYTH = 1;

/** Governance (mirror `state.rs`). */
export const ROLE_NONE = 0;
export const ROLE_ADMIN = 1;
export const ROLE_SUPER_ADMIN = 2;
export const PROPOSAL_VAULT_TRANSFER = 0;
export const PROPOSAL_SET_MEMBER = 1;
export const VAULT_NAMES = ["artist_reserve", "mostro_reserve", "dex_reserve", "rewards", "usdc", "treasury_usdc", "sol", "treasury_sol"] as const;
export type VaultName = (typeof VAULT_NAMES)[number];
export const vaultKind = (name: VaultName): number => VAULT_NAMES.indexOf(name);
export const isCurveVault = (kind: number): boolean => kind <= 4 || kind === 6;
export const isSolVault = (kind: number): boolean => kind === 6 || kind === 7;

/** Compute budget used for every program call (Core CPIs and `create_curve` are heavy). */
export const CU_LIMIT = 400_000;
export const CU_PRICE_MICRO_LAMPORTS = 1_000;

// ---------------------------------------------------------------------------------------------
// Cluster / wallet resolution
// ---------------------------------------------------------------------------------------------

export type ClusterName = "devnet" | "mainnet" | "localnet" | "testnet" | "custom";

export interface ClusterInfo {
   /** Short name used for `shared/addresses/<cluster>.json` and explorer links. */
   name: ClusterName;
   /** RPC endpoint the scripts talk to. */
   rpc: string;
}

const WELL_KNOWN_RPC: Record<string, string> = {
   devnet: "https://api.devnet.solana.com",
   mainnet: "https://api.mainnet-beta.solana.com",
   "mainnet-beta": "https://api.mainnet-beta.solana.com",
   testnet: "https://api.testnet.solana.com",
   localnet: "http://127.0.0.1:8899",
   localhost: "http://127.0.0.1:8899",
};

function readAnchorTomlProvider(): { cluster?: string; wallet?: string } {
   const file = path.join(REPO_ROOT, "Anchor.toml");
   if (!fs.existsSync(file)) return {};
   const text = fs.readFileSync(file, "utf8");
   const section = text.split(/^\[/m).find((s) => s.startsWith("provider]"));
   if (!section) return {};
   const pick = (key: string): string | undefined => {
      const m = section.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
      return m ? m[1] : undefined;
   };
   return { cluster: pick("cluster"), wallet: pick("wallet") };
}

function clusterNameFromUrl(url: string): ClusterName {
   const u = url.toLowerCase();
   if (u.includes("devnet")) return "devnet";
   if (u.includes("testnet")) return "testnet";
   if (u.includes("mainnet")) return "mainnet";
   if (u.includes("127.0.0.1") || u.includes("localhost")) return "localnet";
   return "custom";
}

/** Resolves the cluster from `ANCHOR_PROVIDER_URL` first, then `Anchor.toml [provider].cluster`. */
export function resolveCluster(): ClusterInfo {
   const fromEnv = process.env.ANCHOR_PROVIDER_URL;
   const raw = (fromEnv && fromEnv.trim()) || readAnchorTomlProvider().cluster || "devnet";
   if (/^https?:\/\//i.test(raw) || /^wss?:\/\//i.test(raw)) {
      return { name: clusterNameFromUrl(raw), rpc: raw };
   }
   const key = raw.toLowerCase();
   const rpc = WELL_KNOWN_RPC[key];
   if (!rpc) throw new Error(`Unknown cluster "${raw}". Use a URL or one of ${Object.keys(WELL_KNOWN_RPC).join(", ")}.`);
   const name: ClusterName = key === "mainnet-beta" ? "mainnet" : key === "localhost" ? "localnet" : (key as ClusterName);
   return { name, rpc };
}

function expandHome(p: string): string {
   return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Loads the CLI keypair from `ANCHOR_WALLET` or `Anchor.toml [provider].wallet`. */
export function loadWalletKeypair(): Keypair {
   const fromEnv = process.env.ANCHOR_WALLET;
   const raw = (fromEnv && fromEnv.trim()) || readAnchorTomlProvider().wallet || "~/.config/solana/id.json";
   const file = path.resolve(REPO_ROOT, expandHome(raw));
   if (!fs.existsSync(file)) throw new Error(`Wallet keypair not found at ${file} (set ANCHOR_WALLET or Anchor.toml [provider].wallet).`);
   const secret = JSON.parse(fs.readFileSync(file, "utf8")) as number[];
   return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export interface Ctx {
   cluster: ClusterInfo;
   connection: Connection;
   wallet: Keypair;
   provider: AnchorProvider;
   program: Program<Mostro>;
}

/** Builds connection, provider and `Program<Mostro>` and registers the provider globally. */
export function setup(): Ctx {
   const cluster = resolveCluster();
   const wallet = loadWalletKeypair();
   const connection = new Connection(cluster.rpc, { commitment: "confirmed" });
   const provider = new AnchorProvider(connection, new Wallet(wallet), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      skipPreflight: false,
   });
   setProvider(provider);
   const program = new Program<Mostro>(IDL, provider);
   return { cluster, connection, wallet, provider, program };
}

// ---------------------------------------------------------------------------------------------
// PDA helpers (seeds mirror `programs/mostro/src/state.rs`)
// ---------------------------------------------------------------------------------------------

export function u32Le(n: number): Buffer {
   const b = Buffer.alloc(4);
   b.writeUInt32LE(n, 0);
   return b;
}

export function u64Le(n: BN | bigint | number): Buffer {
   const v = BigInt(n.toString());
   const b = Buffer.alloc(8);
   b.writeBigUInt64LE(v, 0);
   return b;
}

const pda = (seeds: (Buffer | Uint8Array)[], programId: PublicKey = PROGRAM_ID): PublicKey => PublicKey.findProgramAddressSync(seeds, programId)[0];

export const configPda = (): PublicKey => pda([Buffer.from("config")]);
export const treasuryPda = (): PublicKey => pda([Buffer.from("treasury")]);
export const curvePda = (index: number): PublicKey => pda([Buffer.from("curve"), u32Le(index)]);
export const mintPda = (index: number): PublicKey => pda([Buffer.from("mint"), u32Le(index)]);
export const curveVaultPda = (curve: PublicKey): PublicKey => pda([Buffer.from("curve_vault"), curve.toBuffer()]);
export const artistReservePda = (curve: PublicKey): PublicKey => pda([Buffer.from("artist_reserve"), curve.toBuffer()]);
export const mostroReservePda = (curve: PublicKey): PublicKey => pda([Buffer.from("mostro_reserve"), curve.toBuffer()]);
export const dexReservePda = (curve: PublicKey): PublicKey => pda([Buffer.from("dex_reserve"), curve.toBuffer()]);
export const solVaultPda = (curve: PublicKey): PublicKey => pda([Buffer.from("sol_vault"), curve.toBuffer()]);
export const rewardsVaultPda = (curve: PublicKey): PublicKey => pda([Buffer.from("rewards"), curve.toBuffer()]);
export const artistPda = (index: number): PublicKey => pda([Buffer.from("artist"), u32Le(index)]);
export const perkPda = (artist: PublicKey, index: number): PublicKey => pda([Buffer.from("perk"), artist.toBuffer(), u32Le(index)]);
/** Core collection of a perk: `["collection", perk, collection_salt u64 LE]`. Reads should use `perk.collection`; the salt is not stored on-chain. */
export const collectionPda = (perk: PublicKey, collectionSalt: BN | bigint | number): PublicKey => pda([Buffer.from("collection"), perk.toBuffer(), u64Le(collectionSalt)]);
/** Salt the seed passes to `create_perk` for every perk (recorded in `shared/addresses/<cluster>.json`). */
export const COLLECTION_SALT = 1;
export const assetPda = (perk: PublicKey, nonce: BN | bigint): PublicKey => pda([Buffer.from("asset"), perk.toBuffer(), u64Le(nonce)]);
export const receiptPda = (asset: PublicKey): PublicKey => pda([Buffer.from("receipt"), asset.toBuffer()]);
export const blacklistPda = (wallet: PublicKey): PublicKey => pda([Buffer.from("blacklist"), wallet.toBuffer()]);
export const spendPda = (curve: PublicKey, wallet: PublicKey): PublicKey => pda([Buffer.from("spend"), curve.toBuffer(), wallet.toBuffer()]);
export const memberPda = (wallet: PublicKey): PublicKey => pda([Buffer.from("member"), wallet.toBuffer()]);
export const proposalPda = (index: BN | bigint | number): PublicKey => pda([Buffer.from("proposal"), u64Le(index)]);
export const approvalPda = (proposal: PublicKey, wallet: PublicKey): PublicKey => pda([Buffer.from("approval"), proposal.toBuffer(), wallet.toBuffer()]);
/** Metaplex Token Metadata account of a mint (`create_curve` creates it). */
export const metadataPda = (mint: PublicKey): PublicKey => pda([Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], TOKEN_METADATA_PROGRAM_ID);
/** `ProgramData` account of the upgradeable program (needed by `initialize_config`). */
export const programDataPda = (programId: PublicKey = PROGRAM_ID): PublicKey => pda([programId.toBuffer()], BPF_LOADER_UPGRADEABLE_ID);

/** Associated token accounts for PDA owners (`allowOwnerOffCurve = true`). */
export const ataOf = (owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey =>
   getAssociatedTokenAddressSync(mint, owner, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
export const treasuryUsdcAta = (usdcMint: PublicKey): PublicKey => ataOf(configPda(), usdcMint);
export const curveUsdcAta = (curve: PublicKey, usdcMint: PublicKey): PublicKey => ataOf(curve, usdcMint);

/** Random u64 nonce for `redeem_perk` / `buy_perk_sol` (seeds the asset PDA so concurrent buyers never collide). */
export function randomNonce(): BN {
   const bytes = Buffer.alloc(8);
   for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
   return new BN(bytes, "le");
}

/** Every account a buy needs besides the user-specific ones. */
export function buyAccounts(_ctx: Ctx, curveIndex: number, mint: PublicKey, buyer: PublicKey, payer: PublicKey = buyer) {
   const curve = curvePda(curveIndex);
   return {
      payer,
      buyer,
      config: configPda(),
      curve,
      mint,
      curveVault: curveVaultPda(curve),
      solVault: solVaultPda(curve),
      treasury: treasuryPda(),
      buyerAta: ataOf(buyer, mint),
      spend: spendPda(curve, buyer),
      blacklistEntry: blacklistPda(buyer),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
   };
}

// ---------------------------------------------------------------------------------------------
// Program argument helpers
// ---------------------------------------------------------------------------------------------

export type PerkKindName = "pass" | "music" | "event" | "merch";

/** Anchor encodes Rust enums as single-key objects: `{ pass: {} }`. */
export function perkKindArg(kind: PerkKindName): { pass: {} } | { music: {} } | { event: {} } | { merch: {} } {
   switch (kind) {
      case "pass":
         return { pass: {} };
      case "music":
         return { music: {} };
      case "event":
         return { event: {} };
      case "merch":
         return { merch: {} };
   }
}

/** Reads the variant name out of a decoded `PerkKind`. */
export function perkKindName(kind: object): PerkKindName {
   return Object.keys(kind)[0] as PerkKindName;
}

/** Pyth feed id hex -> `[u8; 32]` as the IDL expects (`number[]`). */
export function feedIdBytes(hex: string = PYTH_SOL_USD_FEED_ID_HEX): number[] {
   const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
   if (clean.length !== 64) throw new Error(`Feed id must be 32 bytes hex, got ${clean.length / 2} bytes`);
   return Array.from(Buffer.from(clean, "hex"));
}

/** Whole tokens -> base units (6 decimals) as BN. */
export function tokens(amount: number | string): BN {
   return new BN(toBaseUnits(amount, TOKEN_DECIMALS).toString());
}

/** Whole SOL -> lamports as BN. */
export function sol(amount: number | string): BN {
   return new BN(toBaseUnits(amount, 9).toString());
}

/** Whole USDC -> base units (6 decimals) as BN. */
export function usdc(amount: number | string): BN {
   return new BN(toBaseUnits(amount, USDC_DECIMALS).toString());
}

/** Decimal string/number -> integer base units without float drift. */
export function toBaseUnits(amount: number | string, decimals: number): bigint {
   const s = typeof amount === "number" ? amount.toString() : amount.trim();
   if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error(`Invalid decimal amount "${amount}"`);
   const [whole, frac = ""] = s.split(".");
   const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
   return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

export function toBigInt(v: BN | bigint | number | string): bigint {
   return BigInt(v.toString());
}

/** All-`null` `SetConfigArgs`, to spread a few fields over. */
export function emptySetConfigArgs() {
   return {
      buysPaused: null,
      redeemsPaused: null,
      priceMode: null,
      solUsdPriceE6: null,
      pythSolUsdAccount: null,
      pythFeedId: null,
      maxPriceAgeSecs: null,
      adminPriceMaxAgeSecs: null,
      feeBps: null,
      launchCooldownSecs: null,
      maxSpendPerPeriodLamports: null,
      proposalTtlSecs: null,
   };
}

// ---------------------------------------------------------------------------------------------
// Curve math mirrored from `curve.rs` (integer, same rounding). Used for slippage bounds only.
// ---------------------------------------------------------------------------------------------

export interface BuyQuote {
   netIn: bigint;
   fee: bigint;
   tokensOut: bigint;
}

/** `net = (q - 1) * 10000 / (10000 + fee_bps)`, `out = net * VT / (VQ + net)`. */
export function quoteBuyExactIn(virtualSol: bigint, virtualTokens: bigint, quoteIn: bigint, feeBps: number): BuyQuote {
   if (quoteIn <= 1n) throw new Error("quoteIn must be > 1 lamport");
   const net = ((quoteIn - 1n) * BPS_DENOMINATOR) / (BPS_DENOMINATOR + BigInt(feeBps));
   if (net <= 0n) throw new Error("quoteIn too small");
   const out = (net * virtualTokens) / (virtualSol + net);
   return { netIn: net, fee: quoteIn - net, tokensOut: out };
}

/** `cost = t * VQ / (VT - t) + 1`, `fee = ceil(cost * fee_bps / 10000)`. */
export function quoteBuyExactOut(virtualSol: bigint, virtualTokens: bigint, tokensOut: bigint, feeBps: number): BuyQuote {
   if (tokensOut <= 0n || tokensOut >= virtualTokens) throw new Error("tokensOut out of range");
   const cost = (tokensOut * virtualSol) / (virtualTokens - tokensOut) + 1n;
   const fee = ceilDiv(cost * BigInt(feeBps), BPS_DENOMINATOR);
   return { netIn: cost, fee, tokensOut };
}

/** `split_redeem`: burn 80 % (floor), the rest to rewards. */
export function splitRedeem(amount: bigint): { burned: bigint; toRewards: bigint } {
   const burned = (amount * BURN_BPS) / BPS_DENOMINATOR;
   return { burned, toRewards: amount - burned };
}

/** What `buy_perk_sol` does for a hybrid perk at the given curve state. */
export function quoteHybridPerk(virtualSol: bigint, virtualTokens: bigint, priceLamports: bigint, feeBps: number) {
   const curveHalf = priceLamports / 2n;
   const artistHalf = priceLamports - curveHalf;
   const leg = quoteBuyExactIn(virtualSol, virtualTokens, curveHalf, feeBps);
   const per = splitRedeem(leg.tokensOut);
   return { curveHalf, artistHalf, leg, tokensFromCurve: leg.tokensOut, tokensFromArtist: leg.tokensOut, burned: per.burned * 2n, toRewards: per.toRewards * 2n };
}

function ceilDiv(a: bigint, b: bigint): bigint {
   return (a + b - 1n) / b;
}

/** `x * (10000 - bps) / 10000`, used for `min_out` bounds. */
export function withSlippageDown(x: bigint, bps: number): bigint {
   return (x * (BPS_DENOMINATOR - BigInt(bps))) / BPS_DENOMINATOR;
}

/** `x * (10000 + bps) / 10000`, used for `max_in` bounds. */
export function withSlippageUp(x: bigint, bps: number): bigint {
   return (x * (BPS_DENOMINATOR + BigInt(bps))) / BPS_DENOMINATOR;
}

// ---------------------------------------------------------------------------------------------
// Pyth PriceUpdateV2 (hand-decoded, same offsets as `pricing.rs`)
// ---------------------------------------------------------------------------------------------

export interface PythPrice {
   feedIdHex: string;
   price: bigint;
   exponent: number;
   publishTime: number;
   verificationFull: boolean;
   /** USD per SOL with 6 decimals, like the program computes. */
   priceE6: bigint;
}

export function decodePriceUpdateV2(data: Buffer): PythPrice {
   if (data.length < 133) throw new Error(`PriceUpdateV2 too short (${data.length} bytes)`);
   const tag = data[40];
   const feedIdHex = data.subarray(41, 73).toString("hex");
   const price = data.readBigInt64LE(73);
   const exponent = data.readInt32LE(89);
   const publishTime = Number(data.readBigInt64LE(93));
   const shift = 6 + exponent;
   const priceE6 = shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift);
   return { feedIdHex, price, exponent, publishTime, verificationFull: tag === 1, priceE6 };
}

// ---------------------------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------------------------

export async function accountExists(connection: Connection, address: PublicKey): Promise<boolean> {
   const info = await connection.getAccountInfo(address, "confirmed");
   return info !== null;
}

/** Compute budget instructions prepended to every program call. */
export function computeBudgetIxs(units: number = CU_LIMIT, microLamports: number = CU_PRICE_MICRO_LAMPORTS): TransactionInstruction[] {
   return [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports })];
}

export async function tokenBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
   const info = await connection.getAccountInfo(ata, "confirmed");
   if (!info) return 0n;
   // SPL token account layout: amount is a u64 at offset 64.
   return info.data.readBigUInt64LE(64);
}

// ---------------------------------------------------------------------------------------------
// Logging / formatting
// ---------------------------------------------------------------------------------------------

export function log(label: string, value?: unknown): void {
   if (value === undefined) {
      console.log(label);
      return;
   }
   const v = value instanceof PublicKey ? value.toBase58() : typeof value === "bigint" ? value.toString() : value;
   console.log(`${label.padEnd(26)} ${typeof v === "string" ? v : JSON.stringify(v)}`);
}

export function section(title: string): void {
   console.log(`\n== ${title} ==`);
}

export function warn(message: string): void {
   console.warn(`WARNING: ${message}`);
}

export function explorerSuffix(cluster: ClusterInfo): string {
   switch (cluster.name) {
      case "mainnet":
         return "";
      case "devnet":
      case "testnet":
         return `?cluster=${cluster.name}`;
      default:
         return `?cluster=custom&customUrl=${encodeURIComponent(cluster.rpc)}`;
   }
}

export function explorerTx(sig: string, cluster: ClusterInfo): string {
   return `https://explorer.solana.com/tx/${sig}${explorerSuffix(cluster)}`;
}

export function explorerAddress(address: PublicKey | string, cluster: ClusterInfo): string {
   return `https://explorer.solana.com/address/${address.toString()}${explorerSuffix(cluster)}`;
}

/** Formats base units with `decimals` as a human string (no float drift). */
export function fmtUnits(amount: BN | bigint | number | string, decimals: number, symbol = ""): string {
   const v = toBigInt(amount);
   const neg = v < 0n;
   const abs = neg ? -v : v;
   const whole = abs / 10n ** BigInt(decimals);
   const frac = (abs % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
   const s = `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
   return symbol ? `${s} ${symbol}` : s;
}

export const fmtTokens = (amount: BN | bigint | number | string, symbol = "tokens"): string => fmtUnits(amount, TOKEN_DECIMALS, symbol);
export const fmtSol = (lamports: BN | bigint | number | string): string => fmtUnits(lamports, 9, "SOL");
export const fmtUsdc = (amount: BN | bigint | number | string): string => fmtUnits(amount, USDC_DECIMALS, "USDC");

export function nowTs(): number {
   return Math.floor(Date.now() / 1000);
}

/** Runs `main`, prints a clean error and exits non-zero on failure. */
export function run(main: () => Promise<void>): void {
   main().then(
      () => process.exit(0),
      (err: unknown) => {
         const e = err as { message?: string; logs?: string[] };
         console.error(`\nERROR: ${e?.message ?? String(err)}`);
         if (Array.isArray(e?.logs)) console.error(e.logs.join("\n"));
         process.exit(1);
      },
   );
}
