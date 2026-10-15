/**
 * End-to-end demo from the CLI wallet, printing explorer links for every step:
 *
 *   1. buy 0.1 SOL worth of the artist token on curve #0 (`buy_tokens_sol`, 1 % slippage bound),
 *   2. redeem the Mostro Pass Classic with tokens (`redeem_perk`),
 *   3. buy the hybrid "Exclusive drop" with SOL (`buy_perk_sol`): half curve, half artist, tokens burned 80/20.
 *
 *   npx ts-node scripts/demo-buy.ts [solToBuy=0.1]
 *
 * Re-running is safe: an already-owned pass is reused instead of buying a second one, and the token
 * balance is topped up with `buy_tokens_exact_out_sol` only when it does not cover the pass.
 */
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Mostro } from "../shared/types/mostro";
import {
   Ctx,
   MPL_CORE_PROGRAM_ID,
   TIER_CLASSIC,
   artistPda,
   artistReservePda,
   assetPda,
   ataOf,
   blacklistPda,
   buyAccounts,
   computeBudgetIxs,
   configPda,
   curvePda,
   curveVaultPda,
   explorerAddress,
   explorerTx,
   fmtSol,
   fmtTokens,
   log,
   perkKindName,
   perkPda,
   quoteBuyExactIn,
   quoteBuyExactOut,
   quoteHybridPerk,
   randomNonce,
   receiptPda,
   rewardsVaultPda,
   run,
   section,
   setup,
   sol,
   solVaultPda,
   spendPda,
   splitRedeem,
   toBigInt,
   tokenBalance,
   treasuryPda,
   warn,
   withSlippageDown,
   withSlippageUp,
} from "./common";

const SLIPPAGE_BPS = 100; // 1 %
const CURVE_INDEX = 0;
const ARTIST_INDEX = 0;

type PerkAccount = Awaited<ReturnType<Program<Mostro>["account"]["perk"]["fetch"]>>;

interface PerkRef {
   address: PublicKey;
   data: PerkAccount;
}

async function loadPerks(ctx: Ctx, artist: PublicKey): Promise<PerkRef[]> {
   const a = await ctx.program.account.artist.fetch(artist);
   const out: PerkRef[] = [];
   for (let i = 0; i < a.perkCount; i++) {
      const address = perkPda(artist, i);
      out.push({ address, data: await ctx.program.account.perk.fetch(address) });
   }
   return out;
}

async function buyExactIn(ctx: Ctx, lamportsIn: BN, symbol: string): Promise<bigint> {
   const curve = curvePda(CURVE_INDEX);
   const [config, c] = await Promise.all([ctx.program.account.config.fetch(configPda()), ctx.program.account.curve.fetch(curve)]);
   if (c.complete) throw new Error("Curve is complete (sold out); nothing to buy.");
   const q = quoteBuyExactIn(toBigInt(c.virtualSolReserves), toBigInt(c.virtualTokenReserves), toBigInt(lamportsIn), config.feeBps);
   const minOut = withSlippageDown(q.tokensOut, SLIPPAGE_BPS);
   log("quote", `${fmtSol(lamportsIn)} -> ~${fmtTokens(q.tokensOut, symbol)} (fee ${fmtSol(q.fee)}), min out ${fmtTokens(minOut, symbol)}`);
   const sig = await ctx.program.methods
      .buyTokensSol(lamportsIn, new BN(minOut.toString()))
      // payer == buyer: the wallet covers its own rent. A sponsor (Openfort/Kora) would sign as payer instead.
      .accountsStrict(buyAccounts(ctx, CURVE_INDEX, c.mint, ctx.wallet.publicKey))
      .preInstructions(computeBudgetIxs())
      .rpc();
   log("buy_tokens_sol", explorerTx(sig, ctx.cluster));
   return q.tokensOut;
}

async function buyExactOut(ctx: Ctx, tokensOut: bigint, symbol: string): Promise<void> {
   const curve = curvePda(CURVE_INDEX);
   const [config, c] = await Promise.all([ctx.program.account.config.fetch(configPda()), ctx.program.account.curve.fetch(curve)]);
   const q = quoteBuyExactOut(toBigInt(c.virtualSolReserves), toBigInt(c.virtualTokenReserves), tokensOut, config.feeBps);
   const maxIn = withSlippageUp(q.netIn + q.fee, SLIPPAGE_BPS);
   log("top-up quote", `${fmtTokens(tokensOut, symbol)} for ~${fmtSol(q.netIn + q.fee)}, max in ${fmtSol(maxIn)}`);
   const sig = await ctx.program.methods
      .buyTokensExactOutSol(new BN(tokensOut.toString()), new BN(maxIn.toString()))
      .accountsStrict(buyAccounts(ctx, CURVE_INDEX, c.mint, ctx.wallet.publicKey))
      .preInstructions(computeBudgetIxs())
      .rpc();
   log("buy_tokens_exact_out_sol", explorerTx(sig, ctx.cluster));
}

/** Finds a pass asset minted from `passPerk` that the buyer still owns, via this program's receipts. */
async function findOwnedPass(ctx: Ctx, buyer: PublicKey, passPerk: PublicKey): Promise<PublicKey | null> {
   // Receipt layout: 8 discriminator, bump u8, version u8, buyer @10, perk @42.
   const receipts = await ctx.program.account.receipt.all([{ memcmp: { offset: 10, bytes: buyer.toBase58() } }, { memcmp: { offset: 42, bytes: passPerk.toBase58() } }]);
   for (const r of receipts) {
      // Metaplex Core BaseAssetV1 layout: key (1 byte) then owner (32 bytes).
      const info = await ctx.connection.getAccountInfo(r.account.asset, "confirmed");
      if (info && info.data.length >= 33 && new PublicKey(info.data.subarray(1, 33)).equals(buyer)) return r.account.asset;
   }
   return null;
}

interface RedeemResult {
   sig: string;
   asset: PublicKey;
   receipt: PublicKey;
}

/** `redeem_perk`: `max_paid` is exactly `perk.price_tokens`, so a `set_perk` bump between quote and confirmation fails with SlippageExceeded. */
async function redeem(ctx: Ctx, artist: PublicKey, perk: PerkRef): Promise<RedeemResult> {
   const curve = curvePda(CURVE_INDEX);
   const mint = perk.data.mint;
   const nonce = randomNonce();
   const asset = assetPda(perk.address, nonce);
   const receipt = receiptPda(asset);
   const me = ctx.wallet.publicKey;
   const sig = await ctx.program.methods
      .redeemPerk(nonce, perk.data.priceTokens)
      .accountsStrict({
         payer: me,
         buyer: me,
         config: configPda(),
         artist,
         perk: perk.address,
         curve,
         mint,
         buyerAta: ataOf(me, mint),
         rewardsVault: rewardsVaultPda(curve),
         collection: perk.data.collection,
         asset,
         receipt,
         blacklistEntry: blacklistPda(me),
         mplCoreProgram: MPL_CORE_PROGRAM_ID,
         tokenProgram: TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudgetIxs())
      .rpc();
   return { sig, asset, receipt };
}

/** `buy_perk_sol`: the hybrid perk. `max_lamports` is exactly `perk.price_lamports`. */
async function buyPerk(ctx: Ctx, artist: PublicKey, artistAuthority: PublicKey, perk: PerkRef): Promise<RedeemResult> {
   const curve = curvePda(CURVE_INDEX);
   const mint = perk.data.mint;
   const nonce = randomNonce();
   const asset = assetPda(perk.address, nonce);
   const receipt = receiptPda(asset);
   const me = ctx.wallet.publicKey;
   const sig = await ctx.program.methods
      .buyPerkSol(nonce, perk.data.priceLamports)
      .accountsStrict({
         payer: me,
         buyer: me,
         config: configPda(),
         artist,
         artistAuthority,
         perk: perk.address,
         curve,
         mint,
         curveVault: curveVaultPda(curve),
         artistReserve: artistReservePda(curve),
         rewardsVault: rewardsVaultPda(curve),
         solVault: solVaultPda(curve),
         treasury: treasuryPda(),
         spend: spendPda(curve, me),
         blacklistEntry: blacklistPda(me),
         collection: perk.data.collection,
         asset,
         receipt,
         mplCoreProgram: MPL_CORE_PROGRAM_ID,
         tokenProgram: TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudgetIxs())
      .rpc();
   return { sig, asset, receipt };
}

async function printReceipt(ctx: Ctx, r: RedeemResult, symbol: string): Promise<void> {
   const rec = await ctx.program.account.receipt.fetch(r.receipt);
   log("tx", explorerTx(r.sig, ctx.cluster));
   log("asset", explorerAddress(r.asset, ctx.cluster));
   log("receipt", r.receipt);
   log("edition", `#${rec.edition}`);
   if (!rec.paidLamports.isZero()) {
      log("paid", fmtSol(rec.paidLamports));
      log("to curve / to artist", `${fmtSol(rec.lamportsToCurve)} / ${fmtSol(rec.lamportsToArtist)}`);
      log("tokens curve / artist", `${fmtTokens(rec.tokensFromCurve, symbol)} / ${fmtTokens(rec.tokensFromArtist, symbol)}`);
   } else {
      log("paid", fmtTokens(rec.paidTokens, symbol));
   }
   log("burned", fmtTokens(rec.burned, symbol));
   log("to rewards", fmtTokens(rec.toRewards, symbol));
}

run(async () => {
   const [solArg = "0.1"] = process.argv.slice(2);
   const lamportsIn = sol(solArg);

   const ctx = setup();
   const buyer = ctx.wallet.publicKey;
   section("Environment");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("buyer (CLI wallet)", buyer);
   const balance = await ctx.connection.getBalance(buyer);
   log("SOL balance", fmtSol(balance));
   if (balance < toBigInt(lamportsIn) + 300_000_000n) warn("Low SOL: the demo needs the buy amount, the 0.2 SOL drop and ~0.02 SOL of rent.");

   const config = await ctx.program.account.config.fetch(configPda());
   if (config.buysPaused || config.redeemsPaused) throw new Error(`Circuit breakers: buys_paused=${config.buysPaused} redeems_paused=${config.redeemsPaused}.`);
   const curveAddr = curvePda(CURVE_INDEX);
   const curve = await ctx.program.account.curve.fetch(curveAddr);
   const symbol = curve.symbol;
   const mint = curve.mint;
   const buyerAta = ataOf(buyer, mint);
   log("curve", curveAddr);
   log(`${symbol} mint`, mint);
   log("buyer ATA", buyerAta);
   const opensIn = curve.saleStartTs.toNumber() - Math.floor(Date.now() / 1000);
   if (opensIn > 0) throw new Error(`The curve opens in ${opensIn}s (launch cool-down).`);

   const artist = artistPda(ARTIST_INDEX);
   const artistState = await ctx.program.account.artist.fetch(artist);
   const perks = await loadPerks(ctx, artist);
   const passPerk = perks.find((p) => perkKindName(p.data.kind) === "pass" && p.data.tier === TIER_CLASSIC);
   const dropPerk = perks.find((p) => !p.data.priceLamports.isZero());
   if (!passPerk) throw new Error("No Classic pass perk on artist #0. Run scripts/seed-devnet.ts first.");
   if (!dropPerk) throw new Error("No SOL-priced perk on artist #0. Run scripts/seed-devnet.ts first.");
   log("pass perk", `${passPerk.address.toBase58()} (${passPerk.data.name}, ${fmtTokens(passPerk.data.priceTokens, symbol)})`);
   log("drop perk", `${dropPerk.address.toBase58()} (${dropPerk.data.name}, ${fmtSol(dropPerk.data.priceLamports)})`);

   // 1. Buy tokens.
   section(`1. Buy ${fmtSol(lamportsIn)} of ${symbol}`);
   await buyExactIn(ctx, lamportsIn, symbol);
   let held = await tokenBalance(ctx.connection, buyerAta);
   log(`${symbol} balance`, fmtTokens(held, symbol));

   // 2. Pass: reuse one the wallet already owns, otherwise redeem it.
   section("2. Mostro Pass Classic (paid in tokens)");
   let passAsset = await findOwnedPass(ctx, buyer, passPerk.address);
   const passPrice = toBigInt(passPerk.data.priceTokens);
   if (!passAsset && held < passPrice) {
      warn(`Balance ${fmtTokens(held, symbol)} does not cover ${fmtTokens(passPrice, symbol)}; topping up.`);
      await buyExactOut(ctx, passPrice - held, symbol);
      held = await tokenBalance(ctx.connection, buyerAta);
      log(`${symbol} balance`, fmtTokens(held, symbol));
   }
   if (passAsset) {
      log("already owned", explorerAddress(passAsset, ctx.cluster));
   } else {
      const split = splitRedeem(passPrice);
      log("expected", `pay ${fmtTokens(passPrice, symbol)}: burn ${fmtTokens(split.burned, symbol)}, rewards ${fmtTokens(split.toRewards, symbol)}`);
      const res = await redeem(ctx, artist, passPerk);
      await printReceipt(ctx, res, symbol);
      passAsset = res.asset;
   }

   // 3. Hybrid drop paid in SOL.
   section(`3. ${dropPerk.data.name} (paid in SOL, hybrid)`);
   const c2 = await ctx.program.account.curve.fetch(curveAddr);
   const hq = quoteHybridPerk(toBigInt(c2.virtualSolReserves), toBigInt(c2.virtualTokenReserves), toBigInt(dropPerk.data.priceLamports), config.feeBps);
   log("expected", `${fmtSol(hq.curveHalf)} to the curve (fee ${fmtSol(hq.leg.fee)}), ${fmtSol(hq.artistHalf)} to the artist wallet`);
   log(
      "expected tokens",
      `${fmtTokens(hq.tokensFromCurve, symbol)} from the curve + ${fmtTokens(hq.tokensFromArtist, symbol)} from the artist reserve: burn ${fmtTokens(hq.burned, symbol)}, rewards ${fmtTokens(hq.toRewards, symbol)}`,
   );
   const res = await buyPerk(ctx, artist, artistState.authority, dropPerk);
   await printReceipt(ctx, res, symbol);

   section("Done");
   log(`${symbol} balance`, fmtTokens(await tokenBalance(ctx.connection, buyerAta), symbol));
   const after = await ctx.program.account.curve.fetch(curveAddr);
   log("curve sold", fmtTokens(after.tokensSold, symbol));
   log("artist reserve used", fmtTokens(after.artistReserveUsed, symbol));
   log("curve burned", fmtTokens(after.totalBurned, symbol));
   log("rewards accrued", fmtTokens(after.rewardsAccrued, symbol));
   log("artist revenue", fmtSol((await ctx.program.account.artist.fetch(artist)).revenueLamports));
   log("pass asset", explorerAddress(passAsset, ctx.cluster));
   log("drop asset", explorerAddress(res.asset, ctx.cluster));
});
