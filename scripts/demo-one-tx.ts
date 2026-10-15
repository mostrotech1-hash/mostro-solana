/**
 * The "after the card" step in ONE transaction: buy exactly the pass price in tokens from the curve
 * (`buy_tokens_exact_out_sol`) and redeem the pass (`redeem_perk`) in the same transaction.
 * Buyer is the only user signer; `payer` can be the same wallet or a sponsor.
 *
 *   npx ts-node scripts/demo-one-tx.ts [perkIndex=0]
 */
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram, Transaction } from "@solana/web3.js";
import {
   MPL_CORE_PROGRAM_ID,
   artistPda,
   assetPda,
   ataOf,
   blacklistPda,
   buyAccounts,
   computeBudgetIxs,
   configPda,
   curvePda,
   explorerAddress,
   explorerTx,
   fmtSol,
   fmtTokens,
   log,
   perkPda,
   quoteBuyExactOut,
   randomNonce,
   receiptPda,
   rewardsVaultPda,
   run,
   section,
   setup,
} from "./common";

const toBigInt = (v: BN): bigint => BigInt(v.toString());

run(async () => {
   const perkIndex = Number(process.argv[2] ?? "0");
   const ctx = setup();
   const me = ctx.wallet.publicKey;
   const curve = curvePda(0);
   const artist = artistPda(0);
   const perk = perkPda(artist, perkIndex);
   const [config, c, p] = await Promise.all([ctx.program.account.config.fetch(configPda()), ctx.program.account.curve.fetch(curve), ctx.program.account.perk.fetch(perk)]);
   if (p.priceTokens.isZero()) throw new Error(`Perk #${perkIndex} is SOL-priced; use buy_perk_sol directly (see demo-buy.ts).`);
   const mint = c.mint;
   const price = toBigInt(p.priceTokens);
   const q = quoteBuyExactOut(toBigInt(c.virtualSolReserves), toBigInt(c.virtualTokenReserves), price, config.feeBps);
   const maxIn = ((q.netIn + q.fee) * 101n) / 100n;

   section("One transaction: buy exact tokens + redeem the pass");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("buyer / payer", me);
   log("perk", `${p.name} (${fmtTokens(price, c.symbol)})`);
   log("SOL needed for the tokens", `${fmtSol(q.netIn + q.fee)} (max ${fmtSol(maxIn)})`);

   const buyIx = await ctx.program.methods
      .buyTokensExactOutSol(new BN(price.toString()), new BN(maxIn.toString()))
      .accountsStrict(buyAccounts(ctx, 0, mint, me))
      .instruction();

   const nonce = randomNonce();
   const asset = assetPda(perk, nonce);
   const redeemIx = await ctx.program.methods
      .redeemPerk(nonce, p.priceTokens)
      .accountsStrict({
         payer: me,
         buyer: me,
         config: configPda(),
         artist,
         perk,
         curve,
         mint,
         buyerAta: ataOf(me, mint),
         rewardsVault: rewardsVaultPda(curve),
         collection: p.collection,
         asset,
         receipt: receiptPda(asset),
         blacklistEntry: blacklistPda(me),
         mplCoreProgram: MPL_CORE_PROGRAM_ID,
         tokenProgram: TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();

   const tx = new Transaction().add(...computeBudgetIxs(300_000), buyIx, redeemIx);
   const sig = await ctx.provider.sendAndConfirm(tx, []);
   log("tx (buy + redeem)", explorerTx(sig, ctx.cluster));
   log("asset", explorerAddress(asset, ctx.cluster));
   const parsed = await ctx.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
   log("compute units", parsed?.meta?.computeUnitsConsumed ?? "n/a");
   log("tx size (bytes)", tx.serialize({ requireAllSignatures: false }).length);
   log("instructions", tx.instructions.length);
});
