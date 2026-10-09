/**
 * Typed account fetchers. Account types come straight from the generated IDL types, so a field
 * rename on-chain is a compile error here, not a runtime surprise in the front.
 *
 * Offsets used in `memcmp` filters are computed from the field order in `state.rs` plus the 8-byte
 * Anchor discriminator:
 *   Receipt: disc(8) bump(1) version(1) buyer(32) perk(32) artist(32) asset(32) ...
 *   Perk:    disc(8) bump(1) version(1) index(4) artist(32) mint(32) collection(32) ...
 *   Artist:  disc(8) bump(1) version(1) index(4) authority(32) ...
 *   Curve:   disc(8) bump(1) version(1) index(4) mint(32) ...
 */
import { IdlAccounts, IdlTypes } from "@coral-xyz/anchor";
import { Connection, GetProgramAccountsFilter, PublicKey } from "@solana/web3.js";
import { getMint, Mint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { applyDiscount } from "./curve";
import type { Mostro } from "../types/mostro";
import { MostroProgram } from "./program";
import { artistPda, configPda, curvePda, kycPda, mintPda, perkPda, receiptPda, treasuryPda, treasuryUsdcAta, solVaultPda, rewardsVaultPda, artistVaultPda } from "./pda";
import { BPS_DENOMINATOR, PerkKindCode, TIER_VIP } from "./constants";

export type ConfigAccount = IdlAccounts<Mostro>["config"];
export type CurveAccount = IdlAccounts<Mostro>["curve"];
export type ArtistAccount = IdlAccounts<Mostro>["artist"];
export type PerkAccount = IdlAccounts<Mostro>["perk"];
export type ReceiptAccount = IdlAccounts<Mostro>["receipt"];
export type KycAccount = IdlAccounts<Mostro>["kyc"];
export type PerkKind = IdlTypes<Mostro>["perkKind"];

export interface WithKey<T> {
   publicKey: PublicKey;
   account: T;
}

/** Byte offsets used for `getProgramAccounts` memcmp filters. */
export const OFFSETS = {
   receipt: { buyer: 10, perk: 42, artist: 74, asset: 106 },
   perk: { index: 10, artist: 14, mint: 46, collection: 78 },
   artist: { index: 10, authority: 14 },
   curve: { index: 10, mint: 14 },
} as const;

// ---- enum helpers ------------------------------------------------------------------------------

export type PerkKindName = "pass" | "music" | "event" | "merch";

/** Anchor decodes Rust enums as `{ pass: {} }`; this gives you the lowercase variant name. */
export function perkKindName(kind: PerkKind): PerkKindName {
   // Program-decoded accounts use camelCase variant keys (`{ pass: {} }`); a coder built from the raw
   // IDL yields the Rust spelling (`{ Pass: {} }`). Normalise both.
   const k = Object.keys(kind)[0].toLowerCase();
   return k as PerkKindName;
}

export function perkKindCode(kind: PerkKind): PerkKindCode {
   switch (perkKindName(kind)) {
      case "pass":
         return PerkKindCode.Pass;
      case "music":
         return PerkKindCode.Music;
      case "event":
         return PerkKindCode.Event;
      case "merch":
         return PerkKindCode.Merch;
   }
}

/** Build the enum value the program expects in `CreatePerkArgs.kind`. */
export function perkKindArg(name: PerkKindName): PerkKind {
   return { [name]: {} } as unknown as PerkKind;
}

export function isPassPerk(perk: PerkAccount): boolean {
   return perkKindName(perk.kind) === "pass";
}

export function isVipPass(perk: PerkAccount): boolean {
   return isPassPerk(perk) && perk.tier === TIER_VIP;
}

/** Pass label for UI ("Standard" / "VIP"); `null` for non-pass perks. */
export function passTierLabel(perk: Pick<PerkAccount, "kind" | "tier">): "Standard" | "VIP" | null {
   if (perkKindName(perk.kind) !== "pass") return null;
   return perk.tier === TIER_VIP ? "VIP" : "Standard";
}

// ---- single fetches ----------------------------------------------------------------------------

export async function fetchConfig(program: MostroProgram): Promise<ConfigAccount> {
   return program.account.config.fetch(configPda(program.programId)[0]);
}

export async function fetchConfigNullable(program: MostroProgram): Promise<ConfigAccount | null> {
   return program.account.config.fetchNullable(configPda(program.programId)[0]);
}

export async function fetchCurve(program: MostroProgram, curve: number | PublicKey): Promise<CurveAccount> {
   const key = typeof curve === "number" ? curvePda(curve, program.programId)[0] : curve;
   return program.account.curve.fetch(key);
}

export async function fetchArtist(program: MostroProgram, artist: number | PublicKey): Promise<ArtistAccount> {
   const key = typeof artist === "number" ? artistPda(artist, program.programId)[0] : artist;
   return program.account.artist.fetch(key);
}

export async function fetchPerk(program: MostroProgram, perk: PublicKey): Promise<PerkAccount>;
export async function fetchPerk(program: MostroProgram, artist: PublicKey, perkIndex: number): Promise<PerkAccount>;
export async function fetchPerk(program: MostroProgram, a: PublicKey, perkIndex?: number): Promise<PerkAccount> {
   const key = perkIndex === undefined ? a : perkPda(a, perkIndex, program.programId)[0];
   return program.account.perk.fetch(key);
}

/** Fetch a receipt by its own address or by the asset it certifies. */
export async function fetchReceipt(program: MostroProgram, receiptOrAsset: PublicKey, by: "receipt" | "asset" = "receipt"): Promise<ReceiptAccount> {
   const key = by === "asset" ? receiptPda(receiptOrAsset, program.programId)[0] : receiptOrAsset;
   return program.account.receipt.fetch(key);
}

export async function fetchKyc(program: MostroProgram, wallet: PublicKey): Promise<KycAccount | null> {
   return program.account.kyc.fetchNullable(kycPda(wallet, program.programId)[0]);
}

/** Live mint (supply, decimals). Pass the token program the curve was created with (default Tokenkeg). */
export async function fetchMint(connection: Connection, mint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): Promise<Mint> {
   return getMint(connection, mint, "confirmed", tokenProgram);
}

// ---- lists -------------------------------------------------------------------------------------

function memcmp(offset: number, key: PublicKey): GetProgramAccountsFilter {
   return { memcmp: { offset, bytes: key.toBase58() } };
}

export async function listCurves(program: MostroProgram): Promise<WithKey<CurveAccount>[]> {
   const all = await program.account.curve.all();
   return all.sort((a, b) => a.account.index - b.account.index);
}

export async function listArtists(program: MostroProgram, onlyActive = false): Promise<WithKey<ArtistAccount>[]> {
   const all = await program.account.artist.all();
   return all.filter((a) => !onlyActive || a.account.active).sort((a, b) => a.account.index - b.account.index);
}

export async function listPerks(program: MostroProgram, artist: PublicKey, onlyActive = false): Promise<WithKey<PerkAccount>[]> {
   const all = await program.account.perk.all([memcmp(OFFSETS.perk.artist, artist)]);
   return all.filter((p) => !onlyActive || p.account.active).sort((a, b) => a.account.index - b.account.index);
}

/** Every perk across all artists (small protocol; one GPA call). */
export async function listAllPerks(program: MostroProgram): Promise<WithKey<PerkAccount>[]> {
   const all = await program.account.perk.all();
   return all.sort((a, b) => a.account.artist.toBase58().localeCompare(b.account.artist.toBase58()) || a.account.index - b.account.index);
}

/** Pass perks (kind == Pass), the input `findPassForBuyer` needs. */
export async function listPassPerks(program: MostroProgram, artist?: PublicKey): Promise<WithKey<PerkAccount>[]> {
   const perks = artist ? await listPerks(program, artist) : await listAllPerks(program);
   return perks.filter((p) => isPassPerk(p.account));
}

/** "My perks": receipts whose `buyer` equals the wallet. */
export async function listReceiptsByBuyer(program: MostroProgram, buyer: PublicKey): Promise<WithKey<ReceiptAccount>[]> {
   const all = await program.account.receipt.all([memcmp(OFFSETS.receipt.buyer, buyer)]);
   return all.sort((a, b) => b.account.ts.cmp(a.account.ts));
}

/** All redemptions of one perk (artist dashboard). */
export async function listReceiptsByPerk(program: MostroProgram, perk: PublicKey): Promise<WithKey<ReceiptAccount>[]> {
   const all = await program.account.receipt.all([memcmp(OFFSETS.receipt.perk, perk)]);
   return all.sort((a, b) => a.account.edition - b.account.edition);
}

/** All redemptions across an artist's perks. */
export async function listReceiptsByArtist(program: MostroProgram, artist: PublicKey): Promise<WithKey<ReceiptAccount>[]> {
   const all = await program.account.receipt.all([memcmp(OFFSETS.receipt.artist, artist)]);
   return all.sort((a, b) => b.account.ts.cmp(a.account.ts));
}

// ---- aggregates for the UI ----------------------------------------------------------------------

export interface ProtocolAddresses {
   programId: PublicKey;
   config: PublicKey;
   treasury: PublicKey;
   treasuryUsdc: PublicKey;
}

export function protocolAddresses(program: MostroProgram, usdcMint: PublicKey): ProtocolAddresses {
   return {
      programId: program.programId,
      config: configPda(program.programId)[0],
      treasury: treasuryPda(program.programId)[0],
      treasuryUsdc: treasuryUsdcAta(usdcMint, program.programId),
   };
}

export interface CurveSnapshot {
   curve: PublicKey;
   account: CurveAccount;
   mint: Mint;
   solVault: PublicKey;
   rewardsVault: PublicKey;
}

/** Curve account + live mint in one call: everything the token page needs. */
export async function fetchCurveSnapshot(program: MostroProgram, curveIndex: number, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): Promise<CurveSnapshot> {
   const curve = curvePda(curveIndex, program.programId)[0];
   const mint = mintPda(curveIndex, program.programId)[0];
   const [account, mintInfo] = await Promise.all([program.account.curve.fetch(curve), getMint(program.provider.connection, mint, "confirmed", tokenProgram)]);
   return { curve, account, mint: mintInfo, solVault: solVaultPda(curve, program.programId)[0], rewardsVault: rewardsVaultPda(curve, program.programId)[0] };
}

export interface ArtistSnapshot {
   artist: PublicKey;
   account: ArtistAccount;
   perks: WithKey<PerkAccount>[];
   /** Artist vault for `mint`, derived (may not exist until the first perk is created). */
   artistVault: PublicKey;
}

export async function fetchArtistSnapshot(program: MostroProgram, artistIndex: number, mint: PublicKey): Promise<ArtistSnapshot> {
   const artist = artistPda(artistIndex, program.programId)[0];
   const [account, perks] = await Promise.all([program.account.artist.fetch(artist), listPerks(program, artist)]);
   return { artist, account, perks, artistVault: artistVaultPda(artist, mint, program.programId)[0] };
}

/** Perk + its collection (read from the account; the PDA salt is not stored on-chain), for the perk card and for `findPassForBuyer`. */
export interface PerkSummary {
   perk: PublicKey;
   collection: PublicKey;
   account: PerkAccount;
   kind: PerkKindName;
   tierLabel: "Standard" | "VIP" | null;
   remaining: number | null;
   soldOut: boolean;
}

export function summarizePerk(p: WithKey<PerkAccount>): PerkSummary {
   const remaining = p.account.maxSupply === 0 ? null : Math.max(0, p.account.maxSupply - p.account.sold);
   return {
      perk: p.publicKey,
      collection: p.account.collection,
      account: p.account,
      kind: perkKindName(p.account.kind),
      tierLabel: passTierLabel(p.account),
      remaining,
      soldOut: remaining === 0,
   };
}

/**
 * Does a perk split pass `create_perk` / `set_perk`? Mirrors the on-chain checks: `burn + rewards <= 10_000`,
 * `burn >= config.minBurnBps`, `rewards >= config.minRewardsBps`. All three fail with `InvalidBps` on-chain.
 */
export function checkPerkSplit(
   config: Pick<ConfigAccount, "minBurnBps" | "minRewardsBps">,
   burnBps: number,
   rewardsBps: number,
): { ok: boolean; reason: "SumExceeds" | "BurnBelowFloor" | "RewardsBelowFloor" | null } {
   if (burnBps + rewardsBps > BPS_DENOMINATOR) return { ok: false, reason: "SumExceeds" };
   if (burnBps < config.minBurnBps) return { ok: false, reason: "BurnBelowFloor" };
   if (rewardsBps < config.minRewardsBps) return { ok: false, reason: "RewardsBelowFloor" };
   return { ok: true, reason: null };
}

/** Can `signer` call `create_perk` with this kind? Pass perks are admin-only; the rest accept the artist authority or the admin. */
export function canCreatePerk(config: Pick<ConfigAccount, "admin">, artist: Pick<ArtistAccount, "authority">, signer: PublicKey, kind: PerkKindName): boolean {
   if (signer.equals(config.admin)) return true;
   return kind !== "pass" && signer.equals(artist.authority);
}

/** Can `signer` call `set_perk` on this perk? Same rule as `canCreatePerk`: editing a Pass perk is admin-only. */
export function canSetPerk(config: Pick<ConfigAccount, "admin">, artist: Pick<ArtistAccount, "authority">, signer: PublicKey, perk: Pick<PerkAccount, "kind">): boolean {
   return canCreatePerk(config, artist, signer, perkKindName(perk.kind));
}

/**
 * Can `signer` call `set_artist` with these fields? Name / URI / active: artist authority or admin. Handing the
 * artist over (`authority` set) is reserved to the current authority, so the admin cannot reach the vault by rotation.
 */
export function canSetArtist(config: Pick<ConfigAccount, "admin">, artist: Pick<ArtistAccount, "authority">, signer: PublicKey, changesAuthority: boolean): boolean {
   if (signer.equals(artist.authority)) return true;
   return !changesAuthority && signer.equals(config.admin);
}

/**
 * Effective redeem price exactly as `redeem_perk` computes it: `perk.price` minus the pass-tier discount when
 * `perk.discountEligible`, floor-rounded. Pass the result as `max_paid`; no margin is needed, the number is
 * deterministic for a given perk/config/pass state.
 */
export function expectedPaid(
   config: Pick<ConfigAccount, "standardDiscountBps" | "vipDiscountBps">,
   perk: Pick<PerkAccount, "price" | "discountEligible">,
   passTier: number | null,
): { paid: BN; discountBps: number } {
   const discountBps = passTier === null || !perk.discountEligible ? 0 : passTier === TIER_VIP ? config.vipDiscountBps : config.standardDiscountBps;
   return { paid: applyDiscount(perk.price, discountBps), discountBps };
}

/**
 * Can `wallet` redeem `perk` right now? Mirrors the checks in `redeem_perk` (pause, active,
 * supply, VIP gate, early access) so the UI can disable the button with the right reason.
 * `passPerkActive` is the `active` flag of the pass perk being presented: the program rejects an
 * inactive pass tier with `PerkInactive`, so a pass from a retired tier gives no benefits.
 */
export function redeemEligibility(
   config: Pick<ConfigAccount, "paused" | "standardEarlySecs" | "vipEarlySecs">,
   perk: Pick<PerkAccount, "active" | "maxSupply" | "sold" | "vipOnly" | "publicStartTs">,
   artistActive: boolean,
   passTier: number | null,
   now: number = Math.floor(Date.now() / 1000),
   passPerkActive = true,
): { ok: boolean; reason: string | null; opensAt: number } {
   const earlySecs = passTier === null ? 0 : passTier === TIER_VIP ? config.vipEarlySecs : config.standardEarlySecs;
   const opensAt = Math.max(0, perk.publicStartTs.toNumber() - earlySecs);
   if (config.paused) return { ok: false, reason: "Paused", opensAt };
   if (passTier !== null && !passPerkActive) return { ok: false, reason: "PassPerkInactive", opensAt };
   if (!artistActive) return { ok: false, reason: "ArtistInactive", opensAt };
   if (!perk.active) return { ok: false, reason: "PerkInactive", opensAt };
   if (perk.maxSupply !== 0 && perk.sold >= perk.maxSupply) return { ok: false, reason: "PerkSoldOut", opensAt };
   if (perk.vipOnly && passTier !== TIER_VIP) return { ok: false, reason: "VipOnly", opensAt };
   if (now < opensAt) return { ok: false, reason: "SaleNotStarted", opensAt };
   return { ok: true, reason: null, opensAt };
}
