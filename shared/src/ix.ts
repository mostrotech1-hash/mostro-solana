/**
 * Instruction builders. Each one resolves every account (PDAs, ATAs, program ids, optional accounts)
 * and returns `{ instruction, derived }` where `derived` holds the addresses the UI will want to
 * show or poll (asset, receipt, nonce, ATAs). Nothing here signs or sends: the fronts put the
 * legacy `TransactionInstruction` into their own transaction (web3.js v1 or `@solana/kit` via
 * `@solana/compat`).
 *
 * Signers: the buyer signs every user instruction. Buys, `redeem_perk` and `buy_perk_sol` also take
 * a `payer` (rent + Metaplex Core fee); it defaults to the buyer, so the normal case still has one
 * signer. A gas sponsor (Openfort / Kora) passes its own key as `payer` and co-signs.
 *
 * Every buy and redeem also passes the buyer's blacklist PDA (`["blacklist", buyer]`), which is
 * usually an empty account: the program only rejects wallets whose entry says `blocked`.
 *
 * Account orders come from the generated IDL (`accountsStrict` is type-checked against it).
 */
import { PublicKey, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import {
   CURVE_VAULTS,
   DEFAULT_COLLECTION_SALT,
   MPL_CORE_PROGRAM_ID,
   PROPOSAL_SET_MEMBER,
   PROPOSAL_VAULT_TRANSFER,
   PYTH_SOL_USD_ACCOUNT,
   SOL_VAULTS,
   TOKEN_METADATA_PROGRAM_ID,
   VaultKind,
} from "./constants";
import { MostroProgram } from "./program";
import {
   approvalPda,
   artistPda,
   artistReservePda,
   assetPda,
   ata,
   blacklistPda,
   collectionPda,
   configPda,
   curvePda,
   curveUsdcVaultAta,
   curveVaultPda,
   dexReservePda,
   memberPda,
   metadataPda,
   mintPda,
   mostroReservePda,
   perkPda,
   proposalPda,
   receiptPda,
   rewardsVaultPda,
   solVaultPda,
   spendPda,
   toBn,
   treasuryPda,
   treasuryUsdcAta,
   U64Like,
} from "./pda";
import { BNLike, bn, quoteBuyExactIn, quoteBuyExactOut, minOut, maxIn, BuyQuote, CurveLike, quoteHybridPerk, HybridPerkQuote } from "./curve";
import { PerkAccount, PerkKind } from "./accounts";

export interface BuiltInstruction<D> {
   instruction: TransactionInstruction;
   derived: D;
}

/** Options shared by every user-facing builder. */
export interface CommonOpts {
   /** Token program the curve mint lives in. Default: classic Token program. */
   tokenProgram?: PublicKey;
   /**
    * Who pays rent (buyer ATA, spend tracker, receipt, Core asset) and the Metaplex Core protocol fee.
    * Default: the buyer. Set it to the sponsor's key for gas-sponsored flows; the sponsor must also sign.
    */
   payer?: PublicKey;
}

/** A random u64 nonce for `redeem_perk` / `buy_perk_sol` so concurrent buyers never collide on the asset PDA. */
export function randomNonce(): BN {
   const bytes = new Uint8Array(8);
   // Web Crypto: browsers and Node >= 19 (the repo requires Node >= 24). No `require("crypto")`
   // fallback, so browser bundles do not externalize a Node built-in.
   const g = globalThis as unknown as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
   if (!g.crypto || typeof g.crypto.getRandomValues !== "function") {
      throw new Error("randomNonce: globalThis.crypto.getRandomValues is not available");
   }
   g.crypto.getRandomValues(bytes);
   return new BN(bytes, "le");
}

// ---- trading -----------------------------------------------------------------------------------

export interface BuyTokensSolParams extends CommonOpts {
   buyer: PublicKey;
   curveIndex: number;
   /** Exact lamports the buyer spends (fee included). */
   lamportsIn: BNLike;
   /** Slippage floor; compute with `quoteBuyExactIn` + `minOut`. */
   minTokensOut: BNLike;
}

export interface TradeDerived {
   config: PublicKey;
   curve: PublicKey;
   mint: PublicKey;
   curveVault: PublicKey;
   solVault: PublicKey;
   treasury: PublicKey;
   /** Buyer's associated token account for the curve mint. */
   userAta: PublicKey;
   /** `["spend", curve, buyer]`, created on the first buy (rent paid by `payer`). */
   spend: PublicKey;
   /** `["blacklist", buyer]`, usually empty. */
   blacklistEntry: PublicKey;
   /** Rent payer actually encoded (`opts.payer ?? user`). Equals the user unless a sponsor was given. */
   payer: PublicKey;
}

function tradeDerived(program: MostroProgram, user: PublicKey, curveIndex: number, opts: CommonOpts): TradeDerived {
   const pid = program.programId;
   const curve = curvePda(curveIndex, pid)[0];
   const mint = mintPda(curveIndex, pid)[0];
   return {
      config: configPda(pid)[0],
      curve,
      mint,
      curveVault: curveVaultPda(curve, pid)[0],
      solVault: solVaultPda(curve, pid)[0],
      treasury: treasuryPda(pid)[0],
      userAta: ata(user, mint, opts.tokenProgram ?? TOKEN_PROGRAM_ID),
      spend: spendPda(curve, user, pid)[0],
      blacklistEntry: blacklistPda(user, pid)[0],
      payer: opts.payer ?? user,
   };
}

/** `buy_tokens_sol(lamports_in, min_tokens_out)`. Creates the buyer's ATA and spend tracker if needed (rent paid by `payer`). */
export async function buildBuyTokensSol(program: MostroProgram, p: BuyTokensSolParams): Promise<BuiltInstruction<TradeDerived>> {
   const d = tradeDerived(program, p.buyer, p.curveIndex, p);
   const instruction = await program.methods
      .buyTokensSol(bn(p.lamportsIn), bn(p.minTokensOut))
      .accountsStrict({
         payer: d.payer,
         buyer: p.buyer,
         config: d.config,
         curve: d.curve,
         mint: d.mint,
         curveVault: d.curveVault,
         solVault: d.solVault,
         treasury: d.treasury,
         buyerAta: d.userAta,
         spend: d.spend,
         blacklistEntry: d.blacklistEntry,
         tokenProgram: p.tokenProgram ?? TOKEN_PROGRAM_ID,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();
   return { instruction, derived: d };
}

export interface BuyTokensExactOutSolParams extends CommonOpts {
   buyer: PublicKey;
   curveIndex: number;
   /** Exact tokens (base units) to receive. */
   tokensOut: BNLike;
   /** Ceiling on `cost + fee`; compute with `quoteBuyExactOut` + `maxIn`. */
   maxLamportsIn: BNLike;
}

/** `buy_tokens_exact_out_sol(tokens_out, max_lamports_in)`. */
export async function buildBuyTokensExactOutSol(program: MostroProgram, p: BuyTokensExactOutSolParams): Promise<BuiltInstruction<TradeDerived>> {
   const d = tradeDerived(program, p.buyer, p.curveIndex, p);
   const instruction = await program.methods
      .buyTokensExactOutSol(bn(p.tokensOut), bn(p.maxLamportsIn))
      .accountsStrict({
         payer: d.payer,
         buyer: p.buyer,
         config: d.config,
         curve: d.curve,
         mint: d.mint,
         curveVault: d.curveVault,
         solVault: d.solVault,
         treasury: d.treasury,
         buyerAta: d.userAta,
         spend: d.spend,
         blacklistEntry: d.blacklistEntry,
         tokenProgram: p.tokenProgram ?? TOKEN_PROGRAM_ID,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();
   return { instruction, derived: d };
}

export interface BuyTokensUsdcParams extends CommonOpts {
   buyer: PublicKey;
   curveIndex: number;
   /** USDC base units (6 dp) the buyer spends. */
   usdcIn: BNLike;
   minTokensOut: BNLike;
   /** `config.usdcMint`. */
   usdcMint: PublicKey;
   /** Token program of the USDC mint. Default: classic Token program. */
   usdcTokenProgram?: PublicKey;
   /** Pyth `PriceUpdateV2` account (`config.pythSolUsdAccount`). Always passed; only read in price mode 1. */
   priceUpdate?: PublicKey;
   /** Buyer's USDC token account. Default: the buyer's ATA. */
   buyerUsdc?: PublicKey;
}

export interface BuyUsdcDerived extends TradeDerived {
   usdcMint: PublicKey;
   buyerUsdc: PublicKey;
   usdcVault: PublicKey;
   treasuryUsdc: PublicKey;
   priceUpdate: PublicKey;
}

/** `buy_tokens_usdc(usdc_in, min_tokens_out)`. Precondition: the buyer already holds USDC in `buyerUsdc`. */
export async function buildBuyTokensUsdc(program: MostroProgram, p: BuyTokensUsdcParams): Promise<BuiltInstruction<BuyUsdcDerived>> {
   const base = tradeDerived(program, p.buyer, p.curveIndex, p);
   const usdcTokenProgram = p.usdcTokenProgram ?? TOKEN_PROGRAM_ID;
   const d: BuyUsdcDerived = {
      ...base,
      usdcMint: p.usdcMint,
      buyerUsdc: p.buyerUsdc ?? ata(p.buyer, p.usdcMint, usdcTokenProgram),
      usdcVault: curveUsdcVaultAta(base.curve, p.usdcMint, usdcTokenProgram),
      treasuryUsdc: treasuryUsdcAta(p.usdcMint, program.programId, usdcTokenProgram),
      priceUpdate: p.priceUpdate ?? PYTH_SOL_USD_ACCOUNT,
   };
   const instruction = await program.methods
      .buyTokensUsdc(bn(p.usdcIn), bn(p.minTokensOut))
      .accountsStrict({
         payer: d.payer,
         buyer: p.buyer,
         config: d.config,
         curve: d.curve,
         mint: d.mint,
         curveVault: d.curveVault,
         usdcMint: d.usdcMint,
         buyerUsdc: d.buyerUsdc,
         usdcVault: d.usdcVault,
         treasuryUsdc: d.treasuryUsdc,
         buyerAta: d.userAta,
         spend: d.spend,
         blacklistEntry: d.blacklistEntry,
         priceUpdate: d.priceUpdate,
         tokenProgram: p.tokenProgram ?? TOKEN_PROGRAM_ID,
         usdcTokenProgram,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();
   return { instruction, derived: d };
}

// ---- quote + build in one step --------------------------------------------------------------------

export interface PreparedBuy extends BuiltInstruction<TradeDerived> {
   quote: BuyQuote;
}

/** Quote `lamportsIn` against the given curve state and build the instruction with `slippageBps` protection. */
export async function prepareBuyTokensSol(
   program: MostroProgram,
   curve: CurveLike,
   feeBps: number,
   p: Omit<BuyTokensSolParams, "minTokensOut"> & { slippageBps?: number },
): Promise<PreparedBuy> {
   const quote = quoteBuyExactIn(curve.virtualSolReserves, curve.virtualTokenReserves, p.lamportsIn, feeBps);
   const built = await buildBuyTokensSol(program, { ...p, minTokensOut: minOut(quote.tokensOut, p.slippageBps ?? 100) });
   return { ...built, quote };
}

/** Quote `tokensOut` and build the exact-out instruction with `slippageBps` headroom on the SOL ceiling. */
export async function prepareBuyTokensExactOutSol(
   program: MostroProgram,
   curve: CurveLike,
   feeBps: number,
   p: Omit<BuyTokensExactOutSolParams, "maxLamportsIn"> & { slippageBps?: number },
): Promise<PreparedBuy> {
   const quote = quoteBuyExactOut(curve.virtualSolReserves, curve.virtualTokenReserves, p.tokensOut, feeBps);
   const built = await buildBuyTokensExactOutSol(program, { ...p, maxLamportsIn: maxIn(quote.totalIn, p.slippageBps ?? 100) });
   return { ...built, quote };
}

// ---- perks -------------------------------------------------------------------------------------

export type ArtistRef = { artistIndex: number; artist?: undefined } | { artist: PublicKey; artistIndex?: undefined };
export type PerkRef = { perkIndex: number; perk?: undefined } | { perk: PublicKey; perkIndex?: undefined };

export type RedeemPerkParams = CommonOpts &
   ArtistRef &
   PerkRef & {
      buyer: PublicKey;
      /** Curve of the artist the perk belongs to. */
      curveIndex: number;
      /**
       * Ceiling on the tokens paid. The program fails with `SlippageExceeded` when `perk.priceTokens` is higher,
       * so a `set_perk` price bump between quote and confirmation cannot overcharge. Pass exactly `perk.priceTokens`.
       */
      maxPaid: BNLike;
      /** Client nonce for the asset PDA. Random when omitted. */
      nonce?: U64Like;
      /** Buyer's token account for the perk mint. Default: the buyer's ATA. */
      buyerAta?: PublicKey;
      /** `perk.collection` from the fetched account (preferred). When omitted it is derived with `collectionSalt`. */
      collection?: PublicKey;
      /** Salt the perk was created with; only used when `collection` is omitted. Default `DEFAULT_COLLECTION_SALT`. */
      collectionSalt?: U64Like;
   };

export interface RedeemDerived {
   /** Rent + Core fee payer actually encoded (`p.payer ?? buyer`). */
   payer: PublicKey;
   config: PublicKey;
   artist: PublicKey;
   perk: PublicKey;
   curve: PublicKey;
   mint: PublicKey;
   buyerAta: PublicKey;
   rewardsVault: PublicKey;
   collection: PublicKey;
   /** Exact address of the Core asset that will be minted. */
   asset: PublicKey;
   /** Exact address of the receipt. */
   receipt: PublicKey;
   blacklistEntry: PublicKey;
   nonce: BN;
   /** The `max_paid` argument encoded. */
   maxPaid: BN;
}

/**
 * `redeem_perk(nonce, max_paid)`: pays `perk.price_tokens` from the buyer's wallet (80 % burned, 20 % to
 * rewards), mints a Core asset into the perk's collection and writes a receipt. Only for token-priced perks
 * (`perkPayment(perk) === "tokens"`); SOL-priced perks use `buildBuyPerkSol`.
 */
export async function buildRedeemPerk(program: MostroProgram, p: RedeemPerkParams): Promise<BuiltInstruction<RedeemDerived>> {
   const pid = program.programId;
   const artist = p.artist ?? artistPda(p.artistIndex as number, pid)[0];
   const perk = p.perk ?? perkPda(artist, p.perkIndex as number, pid)[0];
   const curve = curvePda(p.curveIndex, pid)[0];
   const mint = mintPda(p.curveIndex, pid)[0];
   const nonce = p.nonce === undefined ? randomNonce() : toBn(p.nonce);
   const asset = assetPda(perk, nonce, pid)[0];
   const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
   const d: RedeemDerived = {
      payer: p.payer ?? p.buyer,
      config: configPda(pid)[0],
      artist,
      perk,
      curve,
      mint,
      buyerAta: p.buyerAta ?? ata(p.buyer, mint, tokenProgram),
      rewardsVault: rewardsVaultPda(curve, pid)[0],
      collection: p.collection ?? collectionPda(perk, p.collectionSalt ?? DEFAULT_COLLECTION_SALT, pid)[0],
      asset,
      receipt: receiptPda(asset, pid)[0],
      blacklistEntry: blacklistPda(p.buyer, pid)[0],
      nonce,
      maxPaid: bn(p.maxPaid),
   };
   const instruction = await program.methods
      .redeemPerk(nonce, d.maxPaid)
      .accountsStrict({
         payer: d.payer,
         buyer: p.buyer,
         config: d.config,
         artist: d.artist,
         perk: d.perk,
         curve: d.curve,
         mint: d.mint,
         buyerAta: d.buyerAta,
         rewardsVault: d.rewardsVault,
         collection: d.collection,
         asset: d.asset,
         receipt: d.receipt,
         blacklistEntry: d.blacklistEntry,
         mplCoreProgram: MPL_CORE_PROGRAM_ID,
         tokenProgram,
         systemProgram: SystemProgram.programId,
      })
      .instruction();
   return { instruction, derived: d };
}

export interface PreparedRedeem extends BuiltInstruction<RedeemDerived> {
   /** Tokens the buyer will pay (also encoded as `max_paid`). */
   paid: BN;
}

/** Build `redeem_perk` with `max_paid = perk.priceTokens` and `collection` taken from the fetched account. */
export async function prepareRedeemPerk(
   program: MostroProgram,
   perkKey: PublicKey,
   perk: Pick<PerkAccount, "priceTokens" | "artist" | "collection">,
   p: Omit<RedeemPerkParams, "maxPaid" | "perk" | "perkIndex" | "artist" | "artistIndex" | "collection">,
): Promise<PreparedRedeem> {
   const paid = new BN(perk.priceTokens);
   const built = await buildRedeemPerk(program, { ...p, perk: perkKey, artist: perk.artist, collection: perk.collection, maxPaid: paid });
   return { ...built, paid };
}

export type BuyPerkSolParams = CommonOpts &
   ArtistRef &
   PerkRef & {
      buyer: PublicKey;
      curveIndex: number;
      /** `artist.authority`: the wallet that receives the artist half. Fetch the artist account. */
      artistAuthority: PublicKey;
      /** Ceiling on the lamports paid (`SlippageExceeded` when `perk.priceLamports` is higher). Pass exactly `perk.priceLamports`. */
      maxLamports: BNLike;
      nonce?: U64Like;
      collection?: PublicKey;
      collectionSalt?: U64Like;
   };

export interface BuyPerkDerived {
   payer: PublicKey;
   config: PublicKey;
   artist: PublicKey;
   artistAuthority: PublicKey;
   perk: PublicKey;
   curve: PublicKey;
   mint: PublicKey;
   curveVault: PublicKey;
   artistReserve: PublicKey;
   rewardsVault: PublicKey;
   solVault: PublicKey;
   treasury: PublicKey;
   spend: PublicKey;
   blacklistEntry: PublicKey;
   collection: PublicKey;
   asset: PublicKey;
   receipt: PublicKey;
   nonce: BN;
   maxLamports: BN;
}

/**
 * `buy_perk_sol(nonce, max_lamports)`: hybrid perk paid in SOL. Half of the price buys on the curve (fee to
 * the treasury, net to `sol_vault`), the other half goes to `artist.authority`; the same number of tokens
 * leaves `curve_vault` and `artist_reserve`, all burned 80 % / sent to rewards 20 %. Mints the Core asset
 * and writes the receipt like `redeem_perk`. Only for SOL-priced perks (`perkPayment(perk) === "sol"`).
 * The buyer needs no token account: it never holds the tokens.
 */
export async function buildBuyPerkSol(program: MostroProgram, p: BuyPerkSolParams): Promise<BuiltInstruction<BuyPerkDerived>> {
   const pid = program.programId;
   const artist = p.artist ?? artistPda(p.artistIndex as number, pid)[0];
   const perk = p.perk ?? perkPda(artist, p.perkIndex as number, pid)[0];
   const curve = curvePda(p.curveIndex, pid)[0];
   const mint = mintPda(p.curveIndex, pid)[0];
   const nonce = p.nonce === undefined ? randomNonce() : toBn(p.nonce);
   const asset = assetPda(perk, nonce, pid)[0];
   const d: BuyPerkDerived = {
      payer: p.payer ?? p.buyer,
      config: configPda(pid)[0],
      artist,
      artistAuthority: p.artistAuthority,
      perk,
      curve,
      mint,
      curveVault: curveVaultPda(curve, pid)[0],
      artistReserve: artistReservePda(curve, pid)[0],
      rewardsVault: rewardsVaultPda(curve, pid)[0],
      solVault: solVaultPda(curve, pid)[0],
      treasury: treasuryPda(pid)[0],
      spend: spendPda(curve, p.buyer, pid)[0],
      blacklistEntry: blacklistPda(p.buyer, pid)[0],
      collection: p.collection ?? collectionPda(perk, p.collectionSalt ?? DEFAULT_COLLECTION_SALT, pid)[0],
      asset,
      receipt: receiptPda(asset, pid)[0],
      nonce,
      maxLamports: bn(p.maxLamports),
   };
   const instruction = await program.methods
      .buyPerkSol(nonce, d.maxLamports)
      .accountsStrict({
         payer: d.payer,
         buyer: p.buyer,
         config: d.config,
         artist: d.artist,
         artistAuthority: d.artistAuthority,
         perk: d.perk,
         curve: d.curve,
         mint: d.mint,
         curveVault: d.curveVault,
         artistReserve: d.artistReserve,
         rewardsVault: d.rewardsVault,
         solVault: d.solVault,
         treasury: d.treasury,
         spend: d.spend,
         blacklistEntry: d.blacklistEntry,
         collection: d.collection,
         asset: d.asset,
         receipt: d.receipt,
         mplCoreProgram: MPL_CORE_PROGRAM_ID,
         tokenProgram: p.tokenProgram ?? TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();
   return { instruction, derived: d };
}

export interface PreparedBuyPerk extends BuiltInstruction<BuyPerkDerived> {
   quote: HybridPerkQuote;
}

/** Quote the hybrid perk at the current curve state and build `buy_perk_sol` with `max_lamports = perk.priceLamports`. */
export async function prepareBuyPerkSol(
   program: MostroProgram,
   curve: CurveLike,
   feeBps: number,
   perkKey: PublicKey,
   perk: Pick<PerkAccount, "priceLamports" | "artist" | "collection">,
   artistAuthority: PublicKey,
   p: Omit<BuyPerkSolParams, "maxLamports" | "perk" | "perkIndex" | "artist" | "artistIndex" | "collection" | "artistAuthority">,
): Promise<PreparedBuyPerk> {
   const quote = quoteHybridPerk(curve, perk.priceLamports, feeBps);
   const built = await buildBuyPerkSol(program, { ...p, perk: perkKey, artist: perk.artist, artistAuthority, collection: perk.collection, maxLamports: perk.priceLamports });
   return { ...built, quote };
}

// ---- artist side -------------------------------------------------------------------------------

export interface CreatePerkParams {
   /** Artist authority or protocol admin. `kind: pass` is admin-only (artists get `Unauthorized`). */
   signer: PublicKey;
   artistIndex: number;
   /** Must equal `artist.perkCount` at execution time (the PDA is seeded with it). */
   perkIndex: number;
   /** The artist's curve (`artist.curve`). */
   curveIndex: number;
   args: {
      kind: PerkKind;
      /** 0 Classic / 1 VIP for passes; 0 otherwise. */
      tier: number;
      /** Token base units (6 dp). Set exactly one of `priceTokens` / `priceLamports` (`checkPerkPrice`). */
      priceTokens: BNLike;
      /** Lamports, for a hybrid perk. */
      priceLamports: BNLike;
      /** 0 = unlimited. */
      maxSupply: number;
      publicStartTs: BNLike;
      name: string;
      uri: string;
      /** Seeds the Core collection PDA (`["collection", perk, salt]`). Default `DEFAULT_COLLECTION_SALT`; record what you used. */
      collectionSalt?: U64Like;
   };
}

export interface CreatePerkDerived {
   config: PublicKey;
   artist: PublicKey;
   curve: PublicKey;
   mint: PublicKey;
   perk: PublicKey;
   collection: PublicKey;
}

/** `create_perk(args)`: perk account + its Core collection (MasterEdition plugin). */
export async function buildCreatePerk(program: MostroProgram, p: CreatePerkParams): Promise<BuiltInstruction<CreatePerkDerived>> {
   const pid = program.programId;
   const artist = artistPda(p.artistIndex, pid)[0];
   const perk = perkPda(artist, p.perkIndex, pid)[0];
   const curve = curvePda(p.curveIndex, pid)[0];
   const mint = mintPda(p.curveIndex, pid)[0];
   const collectionSalt = toBn(p.args.collectionSalt ?? DEFAULT_COLLECTION_SALT);
   const d: CreatePerkDerived = { config: configPda(pid)[0], artist, curve, mint, perk, collection: collectionPda(perk, collectionSalt, pid)[0] };
   const instruction = await program.methods
      .createPerk({
         kind: p.args.kind,
         tier: p.args.tier,
         priceTokens: bn(p.args.priceTokens),
         priceLamports: bn(p.args.priceLamports),
         maxSupply: p.args.maxSupply,
         publicStartTs: bn(p.args.publicStartTs),
         name: p.args.name,
         uri: p.args.uri,
         collectionSalt,
      })
      .accountsStrict({
         signer: p.signer,
         config: d.config,
         artist: d.artist,
         curve: d.curve,
         mint: d.mint,
         perk: d.perk,
         collection: d.collection,
         mplCoreProgram: MPL_CORE_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();
   return { instruction, derived: d };
}

export interface SetPerkParams {
   signer: PublicKey;
   artistIndex: number;
   perkIndex: number;
   args: {
      priceTokens?: BNLike | null;
      priceLamports?: BNLike | null;
      active?: boolean | null;
      maxSupply?: number | null;
      publicStartTs?: BNLike | null;
      uri?: string | null;
   };
}

/**
 * `set_perk(args)`: every field optional; `null`/omitted leaves it unchanged. The resulting prices must still
 * have exactly one non-zero. Editing a Pass perk is admin-only (artist authority gets `Unauthorized`).
 */
export async function buildSetPerk(program: MostroProgram, p: SetPerkParams): Promise<BuiltInstruction<{ config: PublicKey; artist: PublicKey; perk: PublicKey }>> {
   const pid = program.programId;
   const artist = artistPda(p.artistIndex, pid)[0];
   const perk = perkPda(artist, p.perkIndex, pid)[0];
   const d = { config: configPda(pid)[0], artist, perk };
   const a = p.args;
   const opt = (v: BNLike | null | undefined) => (v === undefined || v === null ? null : bn(v));
   const instruction = await program.methods
      .setPerk({
         priceTokens: opt(a.priceTokens),
         priceLamports: opt(a.priceLamports),
         active: a.active ?? null,
         maxSupply: a.maxSupply ?? null,
         publicStartTs: opt(a.publicStartTs),
         uri: a.uri ?? null,
      })
      .accountsStrict({ signer: p.signer, config: d.config, artist: d.artist, perk: d.perk })
      .instruction();
   return { instruction, derived: d };
}

export interface FulfillReceiptParams {
   signer: PublicKey;
   artistIndex: number;
   /** Receipt address, or the asset it certifies (set `by: "asset"`). */
   receipt: PublicKey;
   by?: "receipt" | "asset";
}

/** `fulfill_receipt`: artist (or admin) marks an off-chain perk as delivered. */
export async function buildFulfillReceipt(
   program: MostroProgram,
   p: FulfillReceiptParams,
): Promise<BuiltInstruction<{ config: PublicKey; artist: PublicKey; receipt: PublicKey }>> {
   const pid = program.programId;
   const artist = artistPda(p.artistIndex, pid)[0];
   const receipt = p.by === "asset" ? receiptPda(p.receipt, pid)[0] : p.receipt;
   const d = { config: configPda(pid)[0], artist, receipt };
   const instruction = await program.methods.fulfillReceipt().accountsStrict({ signer: p.signer, config: d.config, artist: d.artist, receipt: d.receipt }).instruction();
   return { instruction, derived: d };
}

// ---- admin: token creation, blacklist ----------------------------------------------------------------

export interface CreateCurveParams {
   /** Must equal `config.admin`. */
   admin: PublicKey;
   /** Must equal `config.curveCount` at execution time. */
   curveIndex: number;
   artistIndex: number;
   usdcMint: PublicKey;
   args: {
      name: string;
      symbol: string;
      uri: string;
      virtualSolReserves: BNLike;
      /** Must exceed `CURVE_ALLOCATION`. */
      virtualTokenReserves: BNLike;
      /** Requested opening time; the program enforces at least `now + config.launchCooldownSecs`. */
      saleStartTs: BNLike;
   };
   tokenProgram?: PublicKey;
   usdcTokenProgram?: PublicKey;
}

/**
 * `create_curve(args)`: admin-only. Mints the fixed 1B supply into the four vaults, attaches token metadata and
 * revokes the mint authority. One token per artist (`ArtistHasCurve` otherwise). Set a 400k CU limit.
 */
export async function buildCreateCurve(
   program: MostroProgram,
   p: CreateCurveParams,
): Promise<BuiltInstruction<{ config: PublicKey; artist: PublicKey; curve: PublicKey; mint: PublicKey; metadata: PublicKey }>> {
   const pid = program.programId;
   const artist = artistPda(p.artistIndex, pid)[0];
   const curve = curvePda(p.curveIndex, pid)[0];
   const mint = mintPda(p.curveIndex, pid)[0];
   const usdcTokenProgram = p.usdcTokenProgram ?? TOKEN_PROGRAM_ID;
   const d = { config: configPda(pid)[0], artist, curve, mint, metadata: metadataPda(mint)[0] };
   const instruction = await program.methods
      .createCurve({
         name: p.args.name,
         symbol: p.args.symbol,
         uri: p.args.uri,
         virtualSolReserves: bn(p.args.virtualSolReserves),
         virtualTokenReserves: bn(p.args.virtualTokenReserves),
         saleStartTs: bn(p.args.saleStartTs),
      })
      .accountsStrict({
         admin: p.admin,
         config: d.config,
         artist,
         curve,
         mint,
         curveVault: curveVaultPda(curve, pid)[0],
         artistReserve: artistReservePda(curve, pid)[0],
         mostroReserve: mostroReservePda(curve, pid)[0],
         dexReserve: dexReservePda(curve, pid)[0],
         rewardsVault: rewardsVaultPda(curve, pid)[0],
         solVault: solVaultPda(curve, pid)[0],
         usdcMint: p.usdcMint,
         usdcVault: curveUsdcVaultAta(curve, p.usdcMint, usdcTokenProgram),
         metadata: d.metadata,
         tokenProgram: p.tokenProgram ?? TOKEN_PROGRAM_ID,
         usdcTokenProgram,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
         rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();
   return { instruction, derived: d };
}

export interface SetBlacklistParams {
   /** Must equal `config.admin`. */
   admin: PublicKey;
   wallet: PublicKey;
   blocked: boolean;
}

/** `set_blacklist(wallet, blocked)`: admin-only. Creates the entry on first use (rent paid by the admin). */
export async function buildSetBlacklist(program: MostroProgram, p: SetBlacklistParams): Promise<BuiltInstruction<{ config: PublicKey; entry: PublicKey }>> {
   const pid = program.programId;
   const d = { config: configPda(pid)[0], entry: blacklistPda(p.wallet, pid)[0] };
   const instruction = await program.methods
      .setBlacklist(p.wallet, p.blocked)
      .accountsStrict({ admin: p.admin, config: d.config, entry: d.entry, systemProgram: SystemProgram.programId })
      .instruction();
   return { instruction, derived: d };
}

// ---- governance ---------------------------------------------------------------------------------------

export type ProposalArgs =
   | {
        kind: "vaultTransfer";
        /** Which vault; `CURVE_VAULTS` need `curve`, the treasury vaults must not have one. */
        vault: VaultKind;
        /** Curve PDA for curve vaults; omit for treasury vaults. */
        curve?: PublicKey;
        /** Token account (token vaults) or system account (SOL vaults). */
        destination: PublicKey;
        /** Base units or lamports. */
        amount: BNLike;
     }
   | {
        kind: "setMember";
        wallet: PublicKey;
        /** `ROLE_ADMIN` (weight 1), `ROLE_SUPER_ADMIN` (weight 2) or `ROLE_NONE` to remove. */
        role: number;
     };

export interface CreateProposalParams {
   /** A current member; its approval is recorded at creation. */
   proposer: PublicKey;
   /** `config.proposalCount` at execution time. */
   proposalIndex: U64Like;
   args: ProposalArgs;
}

export interface ProposalDerived {
   config: PublicKey;
   member: PublicKey;
   proposal: PublicKey;
   approval: PublicKey;
}

/** `create_proposal(args)`. Fails with `InvalidVault` when a curve is given for a treasury vault or missing for a curve vault. */
export async function buildCreateProposal(program: MostroProgram, p: CreateProposalParams): Promise<BuiltInstruction<ProposalDerived>> {
   const pid = program.programId;
   const proposal = proposalPda(p.proposalIndex, pid)[0];
   const d: ProposalDerived = { config: configPda(pid)[0], member: memberPda(p.proposer, pid)[0], proposal, approval: approvalPda(proposal, p.proposer, pid)[0] };
   const a = p.args;
   const encoded =
      a.kind === "vaultTransfer"
         ? {
              kind: PROPOSAL_VAULT_TRANSFER,
              curve: CURVE_VAULTS.has(a.vault) ? (a.curve ?? PublicKey.default) : PublicKey.default,
              vault: a.vault,
              destination: a.destination,
              amount: bn(a.amount),
              wallet: PublicKey.default,
              role: 0,
           }
         : { kind: PROPOSAL_SET_MEMBER, curve: PublicKey.default, vault: 0, destination: PublicKey.default, amount: new BN(0), wallet: a.wallet, role: a.role };
   const instruction = await program.methods
      .createProposal(encoded)
      .accountsStrict({ proposer: p.proposer, config: d.config, member: d.member, proposal: d.proposal, approval: d.approval, systemProgram: SystemProgram.programId })
      .instruction();
   return { instruction, derived: d };
}

export interface MemberActionParams {
   /** A current member. */
   member: PublicKey;
   proposal: PublicKey;
}

/** `approve_proposal`: one approval per member per proposal (a second one fails because the PDA exists). */
export async function buildApproveProposal(program: MostroProgram, p: MemberActionParams): Promise<BuiltInstruction<ProposalDerived>> {
   const pid = program.programId;
   const d: ProposalDerived = { config: configPda(pid)[0], member: memberPda(p.member, pid)[0], proposal: p.proposal, approval: approvalPda(p.proposal, p.member, pid)[0] };
   const instruction = await program.methods
      .approveProposal()
      .accountsStrict({ memberWallet: p.member, config: d.config, member: d.member, proposal: d.proposal, approval: d.approval, systemProgram: SystemProgram.programId })
      .instruction();
   return { instruction, derived: d };
}

/** `cancel_proposal`: the proposer or any super-admin. */
export async function buildCancelProposal(program: MostroProgram, p: MemberActionParams): Promise<BuiltInstruction<{ member: PublicKey; proposal: PublicKey }>> {
   const pid = program.programId;
   const d = { member: memberPda(p.member, pid)[0], proposal: p.proposal };
   const instruction = await program.methods.cancelProposal().accountsStrict({ memberWallet: p.member, member: d.member, proposal: d.proposal }).instruction();
   return { instruction, derived: d };
}

export interface ExecuteVaultTransferParams extends MemberActionParams {
   /** The fetched proposal: tells which vault, curve and destination to wire. */
   proposalAccount: { vault: number; curve: PublicKey; destination: PublicKey };
   /** Curve index of `proposalAccount.curve` (curve vaults only). */
   curveIndex?: number;
   /** `config.usdcMint`, needed for the USDC vaults. */
   usdcMint?: PublicKey;
   tokenProgram?: PublicKey;
}

/**
 * Builds the right executor for a vault-transfer proposal: `execute_sol_transfer` for the SOL vaults,
 * `execute_token_transfer` for the token vaults. The source account is derived from the vault kind.
 */
export async function buildExecuteVaultTransfer(
   program: MostroProgram,
   p: ExecuteVaultTransferParams,
): Promise<BuiltInstruction<{ member: PublicKey; proposal: PublicKey; source: PublicKey; destination: PublicKey; curve: PublicKey | null }>> {
   const pid = program.programId;
   const v = p.proposalAccount.vault as VaultKind;
   const member = memberPda(p.member, pid)[0];
   const config = configPda(pid)[0];
   const isCurveVault = CURVE_VAULTS.has(v);
   if (isCurveVault && p.curveIndex === undefined) throw new Error("curveIndex is required for curve vaults");
   const curve = isCurveVault ? curvePda(p.curveIndex as number, pid)[0] : null;
   const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
   const dest = p.proposalAccount.destination;
   if (SOL_VAULTS.has(v)) {
      const source = v === VaultKind.Sol ? solVaultPda(curve as PublicKey, pid)[0] : treasuryPda(pid)[0];
      const instruction = await program.methods
         .executeSolTransfer()
         .accountsStrict({ memberWallet: p.member, config, member, proposal: p.proposal, curve, source, destination: dest, systemProgram: SystemProgram.programId })
         .instruction();
      return { instruction, derived: { member, proposal: p.proposal, source, destination: dest, curve } };
   }
   let source: PublicKey;
   let mint: PublicKey;
   switch (v) {
      case VaultKind.ArtistReserve:
         source = artistReservePda(curve as PublicKey, pid)[0];
         mint = mintPda(p.curveIndex as number, pid)[0];
         break;
      case VaultKind.MostroReserve:
         source = mostroReservePda(curve as PublicKey, pid)[0];
         mint = mintPda(p.curveIndex as number, pid)[0];
         break;
      case VaultKind.DexReserve:
         source = dexReservePda(curve as PublicKey, pid)[0];
         mint = mintPda(p.curveIndex as number, pid)[0];
         break;
      case VaultKind.Rewards:
         source = rewardsVaultPda(curve as PublicKey, pid)[0];
         mint = mintPda(p.curveIndex as number, pid)[0];
         break;
      case VaultKind.Usdc:
         if (!p.usdcMint) throw new Error("usdcMint is required for the USDC vaults");
         source = curveUsdcVaultAta(curve as PublicKey, p.usdcMint, tokenProgram);
         mint = p.usdcMint;
         break;
      case VaultKind.TreasuryUsdc:
         if (!p.usdcMint) throw new Error("usdcMint is required for the USDC vaults");
         source = treasuryUsdcAta(p.usdcMint, pid, tokenProgram);
         mint = p.usdcMint;
         break;
      default:
         throw new Error(`unknown vault kind ${v}`);
   }
   const instruction = await program.methods
      .executeTokenTransfer()
      .accountsStrict({ memberWallet: p.member, config, member, proposal: p.proposal, curve, mint, source, destination: dest, tokenProgram })
      .instruction();
   return { instruction, derived: { member, proposal: p.proposal, source, destination: dest, curve } };
}

export interface ExecuteSetMemberParams extends MemberActionParams {
   /** `proposal.wallet`. */
   wallet: PublicKey;
}

/** `execute_set_member`: applies a membership proposal (creates the target's `Member` PDA on first appointment). */
export async function buildExecuteSetMember(
   program: MostroProgram,
   p: ExecuteSetMemberParams,
): Promise<BuiltInstruction<{ config: PublicKey; member: PublicKey; proposal: PublicKey; target: PublicKey }>> {
   const pid = program.programId;
   const d = { config: configPda(pid)[0], member: memberPda(p.member, pid)[0], proposal: p.proposal, target: memberPda(p.wallet, pid)[0] };
   const instruction = await program.methods
      .executeSetMember()
      .accountsStrict({ memberWallet: p.member, config: d.config, member: d.member, proposal: d.proposal, target: d.target, systemProgram: SystemProgram.programId })
      .instruction();
   return { instruction, derived: d };
}

/** `emergency_pause`: any member stops buys and redeems at once. Only the admin resumes them (`set_config`). */
export async function buildEmergencyPause(program: MostroProgram, member: PublicKey): Promise<BuiltInstruction<{ config: PublicKey; member: PublicKey }>> {
   const pid = program.programId;
   const d = { config: configPda(pid)[0], member: memberPda(member, pid)[0] };
   const instruction = await program.methods.emergencyPause().accountsStrict({ memberWallet: member, config: d.config, member: d.member }).instruction();
   return { instruction, derived: d };
}
