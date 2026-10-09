/**
 * The "fan with 0 SOL" transaction: a brand-new wallet that never holds SOL ends up owning a MoOG Pass.
 *
 * - The CLI wallet (Mostro) is the `payer`: it pays the receipt rent, the Core asset rent and the Core fee.
 * - The fan is the `buyer`: it only spends $MOST and signs once. Its SOL balance is 0 before and after.
 *
 * The fan's $MOST comes from the CLI wallet here (a transfer); in production it comes from a card purchase.
 *
 *   yarn ts-node scripts/demo-sponsored.ts [perkIndex=0]
 */
import { BN } from "@coral-xyz/anchor";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
   MPL_CORE_PROGRAM_ID,
   artistPda,
   artistVaultPda,
   assetPda,
   computeBudgetIxs,
   configPda,
   curvePda,
   explorerAddress,
   explorerTx,
   log,
   mintPda,
   perkPda,
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

   section("Sponsored redeem: fan wallet with 0 SOL");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("sponsor (payer)", sponsor);
   log("fan (buyer)", fan.publicKey);
   log("perk", `${perkState.name} (${perkState.price.toNumber() / 1e6} $MOST)`);

   // 1. Sponsor funds the fan with $MOST only (creates the fan's token account, pays its rent).
   const fanAta = getAssociatedTokenAddressSync(mint, fan.publicKey);
   const sponsorAta = getAssociatedTokenAddressSync(mint, sponsor);
   const fund = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(sponsor, fanAta, fan.publicKey, mint),
      createTransferInstruction(sponsorAta, fanAta, sponsor, BigInt(perkState.price.toString())),
   );
   const fundSig = await ctx.provider.sendAndConfirm(fund, []);
   log("fund $MOST tx", explorerTx(fundSig, ctx.cluster));
   log("fan SOL before", (await ctx.connection.getBalance(fan.publicKey)) / 1e9);

   // 2. The fan redeems; the sponsor co-signs as payer.
   const nonce = new BN(Date.now());
   const asset = assetPda(perk, nonce);
   const sig = await ctx.program.methods
      .redeemPerk(nonce, perkState.price)
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
         artistVault: artistVaultPda(artist, mint),
         collection: perkState.collection,
         asset,
         receipt: receiptPda(asset),
         passAsset: null,
         passPerk: null,
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
   log(
      "paid / burned / rewards / artist",
      `${receipt.paid.toNumber() / 1e6} / ${receipt.burned.toNumber() / 1e6} / ${receipt.toRewards.toNumber() / 1e6} / ${receipt.toArtist.toNumber() / 1e6} $MOST`,
   );
});
