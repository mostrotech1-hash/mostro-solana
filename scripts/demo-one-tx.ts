/**
 * The "after the card" step in ONE transaction: buy exactly the pass price in $MOST from the curve
 * (`buy_tokens_exact_out_sol`) and redeem the pass (`redeem_perk`) in the same transaction.
 * Buyer is the only user signer; `payer` can be the same wallet or a sponsor.
 *
 *   yarn ts-node scripts/demo-one-tx.ts [perkIndex=0]
 */
import { BN } from "@coral-xyz/anchor";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram, Transaction } from "@solana/web3.js";
import {
   MPL_CORE_PROGRAM_ID,
   artistPda,
   artistVaultPda,
   assetPda,
   ataOf,
   computeBudgetIxs,
   configPda,
   curvePda,
   explorerAddress,
   explorerTx,
   log,
   optionalKyc,
   perkPda,
   quoteBuyExactOut,
   receiptPda,
   rewardsVaultPda,
   run,
   section,
   setup,
   solVaultPda,
   treasuryPda,
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
   const mint = c.mint;
   const price = toBigInt(p.price);
   const q = quoteBuyExactOut(toBigInt(c.virtualSolReserves), toBigInt(c.virtualTokenReserves), price, config.feeBps);
   const maxIn = ((q.netIn + q.fee) * 101n) / 100n;

   section("One transaction: buy exact $MOST + redeem the pass");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("buyer / payer", me);
   log("perk", `${p.name} (${Number(price) / 1e6} $MOST)`);
   log("SOL needed for the tokens", `${Number(q.netIn + q.fee) / 1e9} SOL (max ${Number(maxIn) / 1e9})`);

   const buyIx = await ctx.program.methods
      .buyTokensExactOutSol(new BN(price.toString()), new BN(maxIn.toString()))
      .accountsStrict({
         payer: me,
         buyer: me,
         config: configPda(),
         curve,
         mint,
         solVault: solVaultPda(curve),
         treasury: treasuryPda(),
         buyerAta: ataOf(me, mint),
         kyc: await optionalKyc(ctx.connection, me),
         tokenProgram: TOKEN_PROGRAM_ID,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();

   const nonce = new BN(Date.now());
   const asset = assetPda(perk, nonce);
   const redeemIx = await ctx.program.methods
      .redeemPerk(nonce, p.price)
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
         artistVault: artistVaultPda(artist, mint),
         collection: p.collection,
         asset,
         receipt: receiptPda(asset),
         passAsset: null,
         passPerk: null,
         mplCoreProgram: MPL_CORE_PROGRAM_ID,
         tokenProgram: TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();

   const tx = new Transaction().add(...computeBudgetIxs(250_000), buyIx, redeemIx);
   const sig = await ctx.provider.sendAndConfirm(tx, []);
   log("tx (buy + redeem)", explorerTx(sig, ctx.cluster));
   log("asset", explorerAddress(asset, ctx.cluster));
   const parsed = await ctx.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
   log("compute units", parsed?.meta?.computeUnitsConsumed ?? "n/a");
   log("tx size (bytes)", tx.serialize({ requireAllSignatures: false }).length);
   log("instructions", tx.instructions.length);
});
