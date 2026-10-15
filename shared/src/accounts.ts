/**
 * Typed account fetchers. Account types come straight from the generated IDL types, so a field
 * rename on-chain is a compile error here, not a runtime surprise in the front.
 *
 * Offsets used in `memcmp` filters are computed from the field order in `state.rs` plus the 8-byte
 * Anchor discriminator:
 *   Receipt:  disc(8) bump(1) version(1) buyer(32) perk(32) artist(32) asset(32) ...
 *   Perk:     disc(8) bump(1) version(1) index(4) artist(32) mint(32) collection(32) ...
 *   Artist:   disc(8) bump(1) version(1) index(4) authority(32) curve(32) ...
 *   Curve:    disc(8) bump(1) version(1) index(4) artist(32) mint(32) ...
 *   Proposal: disc(8) bump(1) index(8) proposer(32) kind(1) ...
 *   Approval: disc(8) bump(1) proposal(32) member(32) ...
 *   Member:   disc(8) bump(1) wallet(32) role(1) ...
 */
import { IdlAccounts, IdlTypes } from "@coral-xyz/anchor";
import { Connection, GetProgramAccountsFilter, PublicKey } from "@solana/web3.js";
import { getMint, Mint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import type { Mostro } from "../types/mostro";
import { MostroProgram } from "./program";
import {
   artistPda,
   artistReservePda,
   blacklistPda,
   configPda,
   curvePda,
   curveVaultPda,
   dexReservePda,
   memberPda,
   mintPda,
   mostroReservePda,
   perkPda,
   proposalPda,
   receiptPda,
   rewardsVaultPda,
   solVaultPda,
   spendPda,
   treasuryPda,
   treasuryUsdcAta,
} from "./pda";
import { PerkKindCode, ROLE_NONE, ROLE_WEIGHT, SPEND_PERIOD_SECS, THRESHOLD_PERCENT, TIER_VIP } from "./constants";

export type ConfigAccount = IdlAccounts<Mostro>["config"];
export type CurveAccount = IdlAccounts<Mostro>["curve"];
export type ArtistAccount = IdlAccounts<Mostro>["artist"];
export type PerkAccount = IdlAccounts<Mostro>["perk"];
export type ReceiptAccount = IdlAccounts<Mostro>["receipt"];
export type BlacklistAccount = IdlAccounts<Mostro>["blacklist"];
export type MemberAccount = IdlAccounts<Mostro>["member"];
export type ProposalAccount = IdlAccounts<Mostro>["proposal"];
export type ApprovalAccount = IdlAccounts<Mostro>["approval"];
export type SpendTrackerAccount = IdlAccounts<Mostro>["spendTracker"];
export type PerkKind = IdlTypes<Mostro>["perkKind"];

export interface WithKey<T> {
   publicKey: PublicKey;
   account: T;
}

/** Byte offsets used for `getProgramAccounts` memcmp filters. */
export const OFFSETS = {
   receipt: { buyer: 10, perk: 42, artist: 74, asset: 106 },
   perk: { index: 10, artist: 14, mint: 46, collection: 78 },
   artist: { index: 10, authority: 14, curve: 46 },
   curve: { index: 10, artist: 14, mint: 46 },
   proposal: { index: 9, proposer: 17, kind: 49 },
   approval: { proposal: 9, member: 41 },
   member: { wallet: 9, role: 41 },
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

export function isPassPerk(perk: Pick<PerkAccount, "kind">): boolean {
   return perkKindName(perk.kind) === "pass";
}

export function isVipPass(perk: Pick<PerkAccount, "kind" | "tier">): boolean {
   return isPassPerk(perk) && perk.tier === TIER_VIP;
}

/** Pass label for UI ("Classic" / "VIP"); `null` for non-pass perks. */
export function passTierLabel(perk: Pick<PerkAccount, "kind" | "tier">): "Classic" | "VIP" | null {
   if (perkKindName(perk.kind) !== "pass") return null;
   return perk.tier === TIER_VIP ? "VIP" : "Classic";
}

/** How a perk is paid: `"tokens"` -> `redeem_perk`, `"sol"` -> `buy_perk_sol` (hybrid). */
export type PerkPayment = "tokens" | "sol";

export function perkPayment(perk: Pick<PerkAccount, "priceTokens" | "priceLamports">): PerkPayment {
   return new BN(perk.priceLamports).gtn(0) ? "sol" : "tokens";
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

/** `null` when the wallet was never blacklisted; check `.blocked` otherwise. */
export async function fetchBlacklist(program: MostroProgram, wallet: PublicKey): Promise<BlacklistAccount | null> {
   return program.account.blacklist.fetchNullable(blacklistPda(wallet, program.programId)[0]);
}

/** True when the wallet currently cannot buy or redeem. */
export async function isBlacklisted(program: MostroProgram, wallet: PublicKey): Promise<boolean> {
   const e = await fetchBlacklist(program, wallet);
   return !!e && e.blocked;
}

/** `null` when the wallet never was a member; a removed member has `role == ROLE_NONE`. */
export async function fetchMember(program: MostroProgram, wallet: PublicKey): Promise<MemberAccount | null> {
   return program.account.member.fetchNullable(memberPda(wallet, program.programId)[0]);
}

export async function fetchProposal(program: MostroProgram, proposal: number | BN | PublicKey): Promise<ProposalAccount> {
   const key = proposal instanceof PublicKey ? proposal : proposalPda(proposal, program.programId)[0];
   return program.account.proposal.fetch(key);
}

export async function fetchSpend(program: MostroProgram, curve: PublicKey, wallet: PublicKey): Promise<SpendTrackerAccount | null> {
   return program.account.spendTracker.fetchNullable(spendPda(curve, wallet, program.programId)[0]);
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

/** Current governance members (role != none), super-admins first. */
export async function listMembers(program: MostroProgram): Promise<WithKey<MemberAccount>[]> {
   const all = await program.account.member.all();
   return all.filter((m) => m.account.role !== ROLE_NONE).sort((a, b) => b.account.role - a.account.role);
}

/** Proposals, newest first. `openOnly` drops executed, cancelled and expired ones. */
export async function listProposals(program: MostroProgram, openOnly = false, now: number = Math.floor(Date.now() / 1000)): Promise<WithKey<ProposalAccount>[]> {
   const all = await program.account.proposal.all();
   return all.filter((p) => !openOnly || proposalStatus(p.account, now) === "open").sort((a, b) => b.account.index.cmp(a.account.index));
}

/** Approvals of one proposal. */
export async function listApprovals(program: MostroProgram, proposal: PublicKey): Promise<WithKey<ApprovalAccount>[]> {
   return program.account.approval.all([memcmp(OFFSETS.approval.proposal, proposal)]);
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
   curveVault: PublicKey;
   artistReserve: PublicKey;
   mostroReserve: PublicKey;
   dexReserve: PublicKey;
   solVault: PublicKey;
   rewardsVault: PublicKey;
}

/** Curve account + live mint in one call: everything the token page needs. */
export async function fetchCurveSnapshot(program: MostroProgram, curveIndex: number, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): Promise<CurveSnapshot> {
   const pid = program.programId;
   const curve = curvePda(curveIndex, pid)[0];
   const mint = mintPda(curveIndex, pid)[0];
   const [account, mintInfo] = await Promise.all([program.account.curve.fetch(curve), getMint(program.provider.connection, mint, "confirmed", tokenProgram)]);
   return {
      curve,
      account,
      mint: mintInfo,
      curveVault: curveVaultPda(curve, pid)[0],
      artistReserve: artistReservePda(curve, pid)[0],
      mostroReserve: mostroReservePda(curve, pid)[0],
      dexReserve: dexReservePda(curve, pid)[0],
      solVault: solVaultPda(curve, pid)[0],
      rewardsVault: rewardsVaultPda(curve, pid)[0],
   };
}

export interface ArtistSnapshot {
   artist: PublicKey;
   account: ArtistAccount;
   perks: WithKey<PerkAccount>[];
}

export async function fetchArtistSnapshot(program: MostroProgram, artistIndex: number): Promise<ArtistSnapshot> {
   const artist = artistPda(artistIndex, program.programId)[0];
   const [account, perks] = await Promise.all([program.account.artist.fetch(artist), listPerks(program, artist)]);
   return { artist, account, perks };
}

/** Perk + its collection (read from the account; the PDA salt is not stored on-chain), for the perk card and for `findPassForBuyer`. */
export interface PerkSummary {
   perk: PublicKey;
   collection: PublicKey;
   account: PerkAccount;
   kind: PerkKindName;
   tierLabel: "Classic" | "VIP" | null;
   payment: PerkPayment;
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
      payment: perkPayment(p.account),
      remaining,
      soldOut: remaining === 0,
   };
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
 * artist over (`authority` set) is reserved to the current authority, so the admin cannot redirect its SOL income.
 */
export function canSetArtist(config: Pick<ConfigAccount, "admin">, artist: Pick<ArtistAccount, "authority">, signer: PublicKey, changesAuthority: boolean): boolean {
   if (signer.equals(artist.authority)) return true;
   return !changesAuthority && signer.equals(config.admin);
}

/** Mirrors `create_perk` / `set_perk`: exactly one of the two prices must be non-zero, else `InvalidPerkPrice`. */
export function checkPerkPrice(priceTokens: BN | number | string, priceLamports: BN | number | string): boolean {
   return new BN(priceTokens).gtn(0) !== new BN(priceLamports).gtn(0);
}

/**
 * Can `wallet` redeem or buy `perk` right now? Mirrors the gates of `redeem_perk` / `buy_perk_sol`
 * (circuit breakers, active flags, supply, start time, blacklist) so the UI can disable the button with
 * the right reason. For SOL-priced perks the curve must also be open (`curveEligibility`).
 */
export function redeemEligibility(
   config: Pick<ConfigAccount, "redeemsPaused" | "buysPaused">,
   perk: Pick<PerkAccount, "active" | "maxSupply" | "sold" | "publicStartTs" | "priceLamports" | "priceTokens">,
   artistActive: boolean,
   blacklisted = false,
   curve: Pick<CurveAccount, "complete" | "saleStartTs"> | null = null,
   now: number = Math.floor(Date.now() / 1000),
): { ok: boolean; reason: string | null; opensAt: number } {
   const opensAt = perk.publicStartTs.toNumber();
   if (config.redeemsPaused) return { ok: false, reason: "RedeemsPaused", opensAt };
   if (blacklisted) return { ok: false, reason: "Blacklisted", opensAt };
   if (!artistActive) return { ok: false, reason: "ArtistInactive", opensAt };
   if (!perk.active) return { ok: false, reason: "PerkInactive", opensAt };
   if (perk.maxSupply !== 0 && perk.sold >= perk.maxSupply) return { ok: false, reason: "PerkSoldOut", opensAt };
   if (now < opensAt) return { ok: false, reason: "SaleNotStarted", opensAt };
   if (perkPayment(perk) === "sol") {
      if (config.buysPaused) return { ok: false, reason: "BuysPaused", opensAt };
      if (curve) {
         const c = curveEligibility(config, curve, blacklisted, now);
         if (!c.ok) return { ok: false, reason: c.reason, opensAt: Math.max(opensAt, c.opensAt) };
      }
   }
   return { ok: true, reason: null, opensAt };
}

/** Can anyone buy on this curve right now? Mirrors `check_can_buy` (pause, completion, cool-down, blacklist). */
export function curveEligibility(
   config: Pick<ConfigAccount, "buysPaused">,
   curve: Pick<CurveAccount, "complete" | "saleStartTs">,
   blacklisted = false,
   now: number = Math.floor(Date.now() / 1000),
): { ok: boolean; reason: string | null; opensAt: number } {
   const opensAt = curve.saleStartTs.toNumber();
   if (config.buysPaused) return { ok: false, reason: "BuysPaused", opensAt };
   if (blacklisted) return { ok: false, reason: "Blacklisted", opensAt };
   if (curve.complete) return { ok: false, reason: "CurveComplete", opensAt };
   if (now < opensAt) return { ok: false, reason: "SaleNotStarted", opensAt };
   return { ok: true, reason: null, opensAt };
}

/**
 * Lamports a wallet can still put into a curve in the current 30-day period, or `null` when the cap is off.
 * `spend` is the fetched `SpendTracker` (or `null` before the first buy).
 */
export function remainingSpend(
   config: Pick<ConfigAccount, "maxSpendPerPeriodLamports">,
   spend: Pick<SpendTrackerAccount, "period" | "spentLamports"> | null,
   now: number = Math.floor(Date.now() / 1000),
): BN | null {
   const cap = new BN(config.maxSpendPerPeriodLamports);
   if (cap.isZero()) return null;
   const period = Math.floor(now / SPEND_PERIOD_SECS);
   const spent = spend && spend.period.toNumber() === period ? new BN(spend.spentLamports) : new BN(0);
   const left = cap.sub(spent);
   return left.isNeg() ? new BN(0) : left;
}

// ---- governance helpers ----------------------------------------------------------------------------

export type ProposalStatus = "open" | "executed" | "cancelled" | "expired";

export function proposalStatus(p: Pick<ProposalAccount, "executed" | "cancelled" | "expiresTs">, now: number = Math.floor(Date.now() / 1000)): ProposalStatus {
   if (p.executed) return "executed";
   if (p.cancelled) return "cancelled";
   if (now > p.expiresTs.toNumber()) return "expired";
   return "open";
}

/** Mirrors `state::meets_threshold`: strictly more than 51 % of the live total weight. */
export function meetsThreshold(approvedWeight: number, totalWeight: number): boolean {
   return totalWeight > 0 && approvedWeight * 100 > totalWeight * THRESHOLD_PERCENT;
}

/** Smallest approved weight that passes with the given total. */
export function weightNeeded(totalWeight: number): number {
   return Math.floor((totalWeight * THRESHOLD_PERCENT) / 100) + 1;
}

export function roleWeight(role: number): number {
   return ROLE_WEIGHT[role] ?? 0;
}
