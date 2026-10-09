/**
 * Funds a demo wallet (for example the Openfort embedded wallet) with SOL and devnet USDC from the CLI wallet.
 *
 *   npx ts-node scripts/fund-demo.ts <wallet> [sol=0.5] [usdc=10]
 *
 * Creates the recipient's USDC associated token account when missing. If the CLI wallet does not hold
 * enough USDC it warns and points at the Circle faucet instead of failing the SOL transfer.
 */
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
   CIRCLE_FAUCET_URL,
   USDC_DECIMALS,
   USDC_MINT_DEVNET,
   explorerAddress,
   explorerTx,
   fmtSol,
   fmtUsdc,
   log,
   run,
   section,
   setup,
   toBaseUnits,
   tokenBalance,
   warn,
} from "./common";

function usage(): never {
   console.error("usage: npx ts-node scripts/fund-demo.ts <wallet> [sol=0.5] [usdc=10]");
   process.exit(2);
}

run(async () => {
   const [walletArg, solArg = "0.5", usdcArg = "10"] = process.argv.slice(2);
   if (!walletArg) usage();
   let recipient: PublicKey;
   try {
      recipient = new PublicKey(walletArg);
   } catch {
      usage();
   }
   const lamports = toBaseUnits(solArg, 9);
   const usdcAmount = toBaseUnits(usdcArg, USDC_DECIMALS);

   const ctx = setup();
   const payer = ctx.wallet;
   section("Fund demo wallet");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("from", payer.publicKey);
   log("to", recipient);
   log("sol", fmtSol(lamports));
   log("usdc", fmtUsdc(usdcAmount));

   const payerLamports = BigInt(await ctx.connection.getBalance(payer.publicKey));
   const minKeep = BigInt(0.05 * LAMPORTS_PER_SOL);
   if (payerLamports < lamports + minKeep) {
      throw new Error(
         `CLI wallet holds ${fmtSol(payerLamports)}; need ${fmtSol(lamports + minKeep)} (transfer + fees). Run: solana airdrop 2 ${payer.publicKey.toBase58()} -u devnet`,
      );
   }

   if (lamports > 0n) {
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: Number(lamports) }));
      const sig = await sendAndConfirmTransaction(ctx.connection, tx, [payer], { commitment: "confirmed" });
      log("sol transfer", explorerTx(sig, ctx.cluster));
   }

   if (usdcAmount > 0n) {
      const usdcMint = USDC_MINT_DEVNET;
      const sourceAta = getAssociatedTokenAddressSync(usdcMint, payer.publicKey, false, TOKEN_PROGRAM_ID);
      const destAta = getAssociatedTokenAddressSync(usdcMint, recipient, true, TOKEN_PROGRAM_ID);
      log("source USDC ATA", sourceAta);
      log("dest USDC ATA", destAta);
      const have = await tokenBalance(ctx.connection, sourceAta);
      if (have < usdcAmount) {
         warn(`CLI wallet holds ${fmtUsdc(have)} but ${fmtUsdc(usdcAmount)} was requested. Skipping the USDC transfer.`);
         warn(`Get devnet USDC for ${payer.publicKey.toBase58()} at ${CIRCLE_FAUCET_URL} (select Solana Devnet) and re-run.`);
      } else {
         const tx = new Transaction()
            .add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, destAta, recipient, usdcMint, TOKEN_PROGRAM_ID))
            .add(createTransferCheckedInstruction(sourceAta, usdcMint, destAta, payer.publicKey, usdcAmount, USDC_DECIMALS, [], TOKEN_PROGRAM_ID));
         const sig = await sendAndConfirmTransaction(ctx.connection, tx, [payer], { commitment: "confirmed" });
         log("usdc transfer", explorerTx(sig, ctx.cluster));
      }
   }

   section("Result");
   const finalSol = await ctx.connection.getBalance(recipient);
   log("recipient SOL", fmtSol(finalSol));
   const finalUsdc = await tokenBalance(ctx.connection, getAssociatedTokenAddressSync(USDC_MINT_DEVNET, recipient, true, TOKEN_PROGRAM_ID));
   log("recipient USDC", fmtUsdc(finalUsdc));
   log("explorer", explorerAddress(recipient, ctx.cluster));
});
