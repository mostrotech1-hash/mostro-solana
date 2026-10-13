/**
 * Instruction builders. Each one resolves every account (PDAs, ATAs, program ids, optional accounts)
 * and returns `{ instruction, derived }` where `derived` holds the addresses the UI will want to
 * show or poll (asset, receipt, nonce, ATAs). Nothing here signs or sends: the fronts put the
 * legacy `TransactionInstruction` into their own transaction (web3.js v1 or `@solana/kit` via
 * `@solana/compat`).
 *
 * Signers: the buyer/seller signs every user instruction. Buys and `redeem_perk` also take a `payer`
 * (rent + Metaplex Core fee); it defaults to the buyer, so the normal case still has one signer. A gas
 * sponsor (Openfort / Kora) passes its own key as `payer` and co-signs.
 *
 * Account orders come from the generated IDL (`accountsStrict` is type-checked against it).
 */
import { PublicKey, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { DEFAULT_COLLECTION_SALT, MPL_CORE_PROGRAM_ID, PYTH_SOL_USD_ACCOUNT, TOKEN_METADATA_PROGRAM_ID } from "./constants";
import { MostroProgram } from "./program";
import {
   artistPda,
   artistVaultPda,
   assetPda,
   ata,
   collectionPda,
   configPda,
   curvePda,
   kycPda,
   metadataPda,
   mintPda,
   perkPda,
   receiptPda,
   rewardsVaultPda,
   solVaultPda,
   treasuryPda,
   treasuryUsdcAta,
   curveUsdcVaultAta,
   U64Like,
   toBn,
} from "./pda";
import { BNLike, bn, quoteBuyExactIn, quoteBuyExactOut, quoteSell, minOut, maxIn, BuyQuote, SellQuote, CurveLike } from "./curve";
import { ConfigAccount, PerkAccount, PerkKind, expectedPaid } from "./accounts";

export interface BuiltInstruction<D> {
   instruction: TransactionInstruction;
   derived: D;
}

/** Options shared by every user-facing builder. */
export interface CommonOpts {
   /** Token program the curve mint lives in. Default: classic Token program. */
   tokenProgram?: PublicKey;
   /**
    * KYC record to pass. `true` derives `["kyc", buyer]` (or seller); a `PublicKey` is used as is;
    * `false`/omitted passes `None` (the program only requires it when `config.kyc_required`).
    */
   kyc?: boolean | PublicKey;
   /**
    * Who pays rent (buyer ATA, receipt, Core asset) and the Metaplex Core protocol fee. Default: the
    * buyer. Set it to the sponsor's key for gas-sponsored flows; the sponsor must also sign.
    */
   payer?: PublicKey;
}

function resolveKyc(buyer: PublicKey, programId: PublicKey, kyc: boolean | PublicKey | undefined): PublicKey | null {
   if (!kyc) return null;
   if (kyc === true) return kycPda(buyer, programId)[0];
   return kyc;
}

/** A random u64 nonce for `redeem_perk` so concurrent buyers never collide on the asset PDA. */
export function randomNonce(): BN {
   const bytes = new Uint8Array(8);
   const g = globalThis as unknown as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
   if (g.crypto && typeof g.crypto.getRandomValues === "function") {
      g.crypto.getRandomValues(bytes);
   } else {
      // Node < 19 fallback.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodeCrypto = require("crypto") as { randomFillSync: (b: Uint8Array) => Uint8Array };
      nodeCrypto.randomFillSync(bytes);
   }
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
   solVault: PublicKey;
   treasury: PublicKey;
   /** Buyer's/seller's associated token account for the curve mint. */
   userAta: PublicKey;
   kyc: PublicKey | null;
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
      solVault: solVaultPda(curve, pid)[0],
      treasury: treasuryPda(pid)[0],
      userAta: ata(user, mint, opts.tokenProgram ?? TOKEN_PROGRAM_ID),
      kyc: resolveKyc(user, pid, opts.kyc),
      payer: opts.payer ?? user,
   };
}

/** `buy_tokens_sol(lamports_in, min_tokens_out)`. Creates the buyer's ATA if needed (init_if_needed, rent paid by `payer`). */
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
         solVault: d.solVault,
         treasury: d.treasury,
         buyerAta: d.userAta,
         kyc: d.kyc,
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
         solVault: d.solVault,
         treasury: d.treasury,
         buyerAta: d.userAta,
         kyc: d.kyc,
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
         usdcMint: d.usdcMint,
         buyerUsdc: d.buyerUsdc,
         usdcVault: d.usdcVault,
         treasuryUsdc: d.treasuryUsdc,
         buyerAta: d.userAta,
         priceUpdate: d.priceUpdate,
         kyc: d.kyc,
         tokenProgram: p.tokenProgram ?? TOKEN_PROGRAM_ID,
         usdcTokenProgram,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();
   return { instruction, derived: d };
}

/** Sells create no accounts, so there is no separate payer; `kyc` works exactly as on buys. */
export interface SellTokensParams extends Omit<CommonOpts, "payer"> {
   seller: PublicKey;
   curveIndex: number;
   tokensIn: BNLike;
   /** Floor on the net lamports received; compute with `quoteSell` + `minOut`. */
   minLamportsOut: BNLike;
   /** Seller's token account. Default: the seller's ATA. */
   sellerAta?: PublicKey;
}

/** `sell_tokens(tokens_in, min_lamports_out)`. Burns the tokens and pays SOL from the curve vault. Gated by KYC like buys. */
export async function buildSellTokens(program: MostroProgram, p: SellTokensParams): Promise<BuiltInstruction<TradeDerived>> {
   const d = tradeDerived(program, p.seller, p.curveIndex, p);
   if (p.sellerAta) d.userAta = p.sellerAta;
   const instruction = await program.methods
      .sellTokens(bn(p.tokensIn), bn(p.minLamportsOut))
      .accountsStrict({
         seller: p.seller,
         config: d.config,
         curve: d.curve,
         mint: d.mint,
         solVault: d.solVault,
         treasury: d.treasury,
         sellerAta: d.userAta,
         kyc: d.kyc,
         tokenProgram: p.tokenProgram ?? TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();
   return { instruction, derived: d };
}

// ---- quote + build in one step --------------------------------------------------------------------

export interface PreparedBuy extends BuiltInstruction<TradeDerived> {
   quote: BuyQuote;
}

export interface PreparedSell extends BuiltInstruction<TradeDerived> {
   quote: SellQuote;
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

/** Quote `tokensIn` and build the sell instruction with `slippageBps` protection. */
export async function prepareSellTokens(
   program: MostroProgram,
   curve: CurveLike,
   feeBps: number,
   p: Omit<SellTokensParams, "minLamportsOut"> & { slippageBps?: number },
): Promise<PreparedSell> {
   const quote = quoteSell(curve.virtualSolReserves, curve.virtualTokenReserves, p.tokensIn, feeBps);
   const built = await buildSellTokens(program, { ...p, minLamportsOut: minOut(quote.netOut, p.slippageBps ?? 100) });
   return { ...built, quote };
}

// ---- perks -------------------------------------------------------------------------------------

export type ArtistRef = { artistIndex: number; artist?: undefined } | { artist: PublicKey; artistIndex?: undefined };
export type PerkRef = { perkIndex: number; perk?: undefined } | { perk: PublicKey; perkIndex?: undefined };

export type RedeemPerkParams = Omit<CommonOpts, "kyc"> &
   ArtistRef &
   PerkRef & {
      buyer: PublicKey;
      /** Curve of the mint the perk is priced in ($MOST is curve 0). */
      curveIndex: number;
      /**
       * Ceiling on the tokens actually paid (`perk.price` minus the pass discount). The program fails with
       * `SlippageExceeded` when the effective price is higher, so a `set_perk` price bump between quote and
       * confirmation cannot overcharge. The price is deterministic: pass exactly `expectedPaid(...)`, no margin.
       */
      maxPaid: BNLike;
      /** Client nonce for the asset PDA. Random when omitted. */
      nonce?: U64Like;
      /** MoOG Pass to present for discount / early access / VIP gating. `null`/omitted = no pass. */
      pass?: { asset: PublicKey; perk: PublicKey } | null;
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
   artistVault: PublicKey;
   collection: PublicKey;
   /** Exact address of the Core asset that will be minted. */
   asset: PublicKey;
   /** Exact address of the receipt. */
   receipt: PublicKey;
   nonce: BN;
   /** The `max_paid` argument encoded. */
   maxPaid: BN;
   passAsset: PublicKey | null;
   passPerk: PublicKey | null;
}

/**
 * `redeem_perk(nonce, max_paid)`: pays `perk.price` in tokens (minus any pass discount, capped by `max_paid`),
 * burns/routes the split, mints a Core asset into the perk's collection and writes a receipt. Signers: the
 * buyer, plus the `payer` when it is a sponsor (default payer = buyer, so one signer in the normal case).
 * Optional accounts not provided are passed as `None` (Anchor encodes them as the program id).
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
      artistVault: artistVaultPda(artist, mint, pid)[0],
      collection: p.collection ?? collectionPda(perk, p.collectionSalt ?? DEFAULT_COLLECTION_SALT, pid)[0],
      asset,
      receipt: receiptPda(asset, pid)[0],
      nonce,
      maxPaid: bn(p.maxPaid),
      passAsset: p.pass ? p.pass.asset : null,
      passPerk: p.pass ? p.pass.perk : null,
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
         artistVault: d.artistVault,
         collection: d.collection,
         asset: d.asset,
         receipt: d.receipt,
         passAsset: d.passAsset,
         passPerk: d.passPerk,
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
   discountBps: number;
}

/**
 * Compute the effective price from the fetched `perk` and `config` (and the pass tier being presented, or
 * `null`) and build `redeem_perk` with `max_paid` set to exactly that amount and `collection` taken from the
 * account. `perkKey` is the perk's address; `p.pass` must match `passTier`.
 */
export async function prepareRedeemPerk(
   program: MostroProgram,
   config: Pick<ConfigAccount, "standardDiscountBps" | "vipDiscountBps">,
   perkKey: PublicKey,
   perk: Pick<PerkAccount, "price" | "discountEligible" | "artist" | "collection">,
   passTier: number | null,
   p: Omit<RedeemPerkParams, "maxPaid" | "perk" | "perkIndex" | "artist" | "artistIndex" | "collection">,
): Promise<PreparedRedeem> {
   const { paid, discountBps } = expectedPaid(config, perk, passTier);
   const built = await buildRedeemPerk(program, { ...p, perk: perkKey, artist: perk.artist, collection: perk.collection, maxPaid: paid });
   return { ...built, paid, discountBps };
}

// ---- admin: curve metadata -----------------------------------------------------------------------

export interface SetCurveMetadataParams {
   /** Must equal `config.admin`. */
   admin: PublicKey;
   curveIndex: number;
}

export interface SetCurveMetadataDerived {
   config: PublicKey;
   curve: PublicKey;
   mint: PublicKey;
   /** Token Metadata account that will be created: `["metadata", token_metadata_program, mint]`. */
   metadata: PublicKey;
}

/**
 * `set_curve_metadata()`: admin-only. Creates the Metaplex Token Metadata account of the curve mint from
 * `curve.name` / `curve.symbol` / `curve.uri` (update authority = curve PDA) so wallets show the symbol
 * instead of "Unknown Token". Succeeds once per mint: a second call fails because the account exists.
 */
export async function buildSetCurveMetadata(program: MostroProgram, p: SetCurveMetadataParams): Promise<BuiltInstruction<SetCurveMetadataDerived>> {
   const pid = program.programId;
   const curve = curvePda(p.curveIndex, pid)[0];
   const mint = mintPda(p.curveIndex, pid)[0];
   const d: SetCurveMetadataDerived = { config: configPda(pid)[0], curve, mint, metadata: metadataPda(mint)[0] };
   const instruction = await program.methods
      .setCurveMetadata()
      .accountsStrict({
         admin: p.admin,
         config: d.config,
         curve: d.curve,
         mint: d.mint,
         metadata: d.metadata,
         tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
         rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();
   return { instruction, derived: d };
}

// ---- artist side -------------------------------------------------------------------------------

export interface CreatePerkParams {
   /** Artist authority or protocol admin. `kind: pass` is admin-only (artists get `Unauthorized`). */
   signer: PublicKey;
   artistIndex: number;
   /** Must equal `artist.perkCount` at execution time (the PDA is seeded with it). */
   perkIndex: number;
   curveIndex: number;
   args: {
      kind: PerkKind;
      /** 0 Standard / 1 VIP for passes; 0 otherwise. */
      tier: number;
      /** Token base units (6 dp). */
      price: BNLike;
      /** Must be `>= config.minBurnBps`; `burnBps + rewardsBps <= 10_000`. Check with `checkPerkSplit`. */
      burnBps: number;
      /** Must be `>= config.minRewardsBps`. */
      rewardsBps: number;
      /** 0 = unlimited. */
      maxSupply: number;
      publicStartTs: BNLike;
      vipOnly: boolean;
      discountEligible: boolean;
      name: string;
      uri: string;
      /** Seeds the Core collection PDA (`["collection", perk, salt]`). Default `DEFAULT_COLLECTION_SALT`; record what you used. */
      collectionSalt?: U64Like;
   };
   tokenProgram?: PublicKey;
}

export interface CreatePerkDerived {
   config: PublicKey;
   artist: PublicKey;
   curve: PublicKey;
   mint: PublicKey;
   perk: PublicKey;
   collection: PublicKey;
   artistVault: PublicKey;
}

/**
 * `create_perk(args)`: perk account + its Core collection (MasterEdition plugin) + lazy artist vault.
 * Pass perks (`kind: pass`) can only be created by `config.admin`; every perk's split must respect
 * `config.minBurnBps` / `config.minRewardsBps`, else `InvalidBps`.
 */
export async function buildCreatePerk(program: MostroProgram, p: CreatePerkParams): Promise<BuiltInstruction<CreatePerkDerived>> {
   const pid = program.programId;
   const artist = artistPda(p.artistIndex, pid)[0];
   const perk = perkPda(artist, p.perkIndex, pid)[0];
   const curve = curvePda(p.curveIndex, pid)[0];
   const mint = mintPda(p.curveIndex, pid)[0];
   const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
   const collectionSalt = toBn(p.args.collectionSalt ?? DEFAULT_COLLECTION_SALT);
   const d: CreatePerkDerived = {
      config: configPda(pid)[0],
      artist,
      curve,
      mint,
      perk,
      collection: collectionPda(perk, collectionSalt, pid)[0],
      artistVault: artistVaultPda(artist, mint, pid)[0],
   };
   const instruction = await program.methods
      .createPerk({
         kind: p.args.kind,
         tier: p.args.tier,
         price: bn(p.args.price),
         burnBps: p.args.burnBps,
         rewardsBps: p.args.rewardsBps,
         maxSupply: p.args.maxSupply,
         publicStartTs: bn(p.args.publicStartTs),
         vipOnly: p.args.vipOnly,
         discountEligible: p.args.discountEligible,
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
         artistVault: d.artistVault,
         mplCoreProgram: MPL_CORE_PROGRAM_ID,
         tokenProgram,
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
      price?: BNLike | null;
      active?: boolean | null;
      maxSupply?: number | null;
      publicStartTs?: BNLike | null;
      vipOnly?: boolean | null;
      discountEligible?: boolean | null;
      burnBps?: number | null;
      rewardsBps?: number | null;
      uri?: string | null;
   };
}

/**
 * `set_perk(args)`: every field optional; `null`/omitted leaves it unchanged. The resulting split must still respect
 * the config floors. Editing a Pass perk is admin-only (artist authority gets `Unauthorized`).
 */
export async function buildSetPerk(program: MostroProgram, p: SetPerkParams): Promise<BuiltInstruction<{ config: PublicKey; artist: PublicKey; perk: PublicKey }>> {
   const pid = program.programId;
   const artist = artistPda(p.artistIndex, pid)[0];
   const perk = perkPda(artist, p.perkIndex, pid)[0];
   const d = { config: configPda(pid)[0], artist, perk };
   const a = p.args;
   const instruction = await program.methods
      .setPerk({
         price: a.price === undefined || a.price === null ? null : bn(a.price),
         active: a.active ?? null,
         maxSupply: a.maxSupply ?? null,
         publicStartTs: a.publicStartTs === undefined || a.publicStartTs === null ? null : bn(a.publicStartTs),
         vipOnly: a.vipOnly ?? null,
         discountEligible: a.discountEligible ?? null,
         burnBps: a.burnBps ?? null,
         rewardsBps: a.rewardsBps ?? null,
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

export interface WithdrawArtistVaultParams {
   /** Must equal `artist.authority`. The protocol admin cannot withdraw artist vaults. */
   authority: PublicKey;
   artistIndex: number;
   curveIndex: number;
   amount: BNLike;
   /** Destination token account for the curve mint. Default: the authority's ATA (must already exist). */
   destination?: PublicKey;
   tokenProgram?: PublicKey;
}

/** `withdraw_artist_vault(amount)`: the artist authority moves the artist's token revenue to any token account of the same mint. */
export async function buildWithdrawArtistVault(
   program: MostroProgram,
   p: WithdrawArtistVaultParams,
): Promise<BuiltInstruction<{ artist: PublicKey; mint: PublicKey; artistVault: PublicKey; destination: PublicKey }>> {
   const pid = program.programId;
   const artist = artistPda(p.artistIndex, pid)[0];
   const mint = mintPda(p.curveIndex, pid)[0];
   const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
   const d = {
      artist,
      mint,
      artistVault: artistVaultPda(artist, mint, pid)[0],
      destination: p.destination ?? ata(p.authority, mint, tokenProgram),
   };
   const instruction = await program.methods
      .withdrawArtistVault(bn(p.amount))
      .accountsStrict({ authority: p.authority, artist: d.artist, mint: d.mint, artistVault: d.artistVault, destination: d.destination, tokenProgram })
      .instruction();
   return { instruction, derived: d };
}
