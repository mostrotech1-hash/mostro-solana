/**
 * Writes (or updates) the KYC attestation PDA for a wallet. Admin only.
 *
 *   npx ts-node scripts/set-kyc.ts <wallet> <approved: true|false> [country=GB]
 *
 * Buying and selling on the curve check this record only while `config.kyc_required` is on
 * (toggle it with `set_config`); the record itself can be written at any time.
 */
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { computeBudgetIxs, configPda, countryBytes, explorerAddress, explorerTx, kycPda, log, run, section, setup } from "./common";

function usage(): never {
   console.error("usage: npx ts-node scripts/set-kyc.ts <wallet> <approved: true|false> [country=GB]");
   process.exit(2);
}

function parseBool(s: string): boolean {
   const v = s.trim().toLowerCase();
   if (["true", "1", "yes", "y", "approved"].includes(v)) return true;
   if (["false", "0", "no", "n", "rejected"].includes(v)) return false;
   return usage();
}

run(async () => {
   const [walletArg, approvedArg, countryArg = "GB"] = process.argv.slice(2);
   if (!walletArg || !approvedArg) usage();
   let wallet: PublicKey;
   try {
      wallet = new PublicKey(walletArg);
   } catch {
      usage();
   }
   const approved = parseBool(approvedArg);
   const country = countryBytes(countryArg);

   const ctx = setup();
   section("Set KYC");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("admin (CLI wallet)", ctx.wallet.publicKey);
   log("wallet", wallet);
   log("approved", approved);
   log("country", countryArg.toUpperCase());
   const kyc = kycPda(wallet);
   log("kyc PDA", kyc);

   const config = await ctx.program.account.config.fetch(configPda());
   if (!config.admin.equals(ctx.wallet.publicKey)) {
      throw new Error(`CLI wallet is not the admin (${config.admin.toBase58()}).`);
   }
   log("kyc_required (config)", config.kycRequired);

   const sig = await ctx.program.methods
      .setKyc(wallet, approved, country)
      .accountsStrict({
         admin: ctx.wallet.publicKey,
         config: configPda(),
         kyc,
         systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudgetIxs(50_000))
      .rpc();
   log("set_kyc", explorerTx(sig, ctx.cluster));

   const record = await ctx.program.account.kyc.fetch(kyc);
   section("On-chain record");
   log("wallet", record.wallet);
   log("approved", record.approved);
   log("country", String.fromCharCode(...record.country));
   log("updated", new Date(record.updatedTs.toNumber() * 1000).toISOString());
   log("explorer", explorerAddress(kyc, ctx.cluster));
});
