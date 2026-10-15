/**
 * The "fan with 0 SOL" transaction: a brand-new wallet that never holds SOL ends up owning a Mostro Pass.
 *
 * - The CLI wallet (Mostro) is the `payer`: it pays the receipt rent, the Core asset rent and the Core fee.
 * - The fan is the `buyer`: it only spends tokens and signs once. Its SOL balance is 0 before and after.
 *
 * The fan's tokens come from the CLI wallet here (a transfer); in production they come from a card purchase.
 *
 *   npx ts-node scripts/demo-sponsored.ts [perkIndex=0]
 */
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
   MPL_CORE_PROGRAM_ID,
   artistPda,
   assetPda,
   blacklistPda,
   computeBudgetIxs,
   configPda,
   curvePda,
   explorerAddress,
   explorerTx,
   fmtTokens,
   log,
   mintPda,
   perkPda,
   randomNonce,
   receiptPda,
   rewardsVaultPda,
   run,
   section,
   setup,
} from "./common";

run(async () => {
   const perkIndex = Number(process.argv[2] ?? "0");
   const ctx = setup();
   const sponsor = ctx.wallet.publicKey;
   const fan = Keypair.generate();
   const mint = mintPda(0);
   const curve = curvePda(0);
   const artist = artistPda(0);
   const perk = perkPda(artist, perkIndex);
   const perkState = await ctx.program.account.perk.fetch(perk);
   if (perkState.priceTokens.isZero()) throw new Error(`Perk #${perkIndex} is SOL-priced; this demo needs a token-priced perk.`);
   const symbol = (await ctx.program.account.curve.fetch(curve)).symbol;

   section("Sponsored redeem: fan wallet with 0 SOL");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("sponsor (payer)", sponsor);
   log("fan (buyer)", fan.publicKey);
   log("perk", `${perkState.name} (${fmtTokens(perkState.priceTokens, symbol)})`);

   // 1. Sponsor funds the fan with tokens only (creates the fan's token account, pays its rent).
   const fanAta = getAssociatedTokenAddressSync(mint, fan.publicKey);
   const sponsorAta = getAssociatedTokenAddressSync(mint, sponsor);
   const fund = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(sponsor, fanAta, fan.publicKey, mint),
      createTransferInstruction(sponsorAta, fanAta, sponsor, BigInt(perkState.priceTokens.toString())),
   );
   const fundSig = await ctx.provider.sendAndConfirm(fund, []);
   log("fund tokens tx", explorerTx(fundSig, ctx.cluster));
   log("fan SOL before", (await ctx.connection.getBalance(fan.publicKey)) / 1e9);

   // 2. The fan redeems; the sponsor co-signs as payer.
   const nonce = randomNonce();
   const asset = assetPda(perk, nonce);
   const sig = await ctx.program.methods
      .redeemPerk(nonce, perkState.priceTokens)
      .accountsStrict({
         payer: sponsor,
         buyer: fan.publicKey,
         config: configPda(),
         artist,
         perk,
         curve,
         mint,
         buyerAta: fanAta,
         rewardsVault: rewardsVaultPda(curve),
         collection: perkState.collection,
         asset,
         receipt: receiptPda(asset),
         blacklistEntry: blacklistPda(fan.publicKey),
         mplCoreProgram: MPL_CORE_PROGRAM_ID,
         tokenProgram: TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudgetIxs())
      .signers([fan])
      .rpc();
   log("redeem tx", explorerTx(sig, ctx.cluster));
   log("asset (owned by the fan)", explorerAddress(asset, ctx.cluster));
   log("fan SOL after", (await ctx.connection.getBalance(fan.publicKey)) / 1e9);
   const receipt = await ctx.program.account.receipt.fetch(receiptPda(asset));
   log("receipt buyer == fan", receipt.buyer.equals(fan.publicKey));
   log("paid / burned / rewards", `${fmtTokens(receipt.paidTokens, symbol)} / ${fmtTokens(receipt.burned, symbol)} / ${fmtTokens(receipt.toRewards, symbol)}`);
});
