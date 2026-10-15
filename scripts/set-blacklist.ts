/**
 * Blocks or unblocks a wallet. Admin only. Every wallet is allowed by default; a blocked wallet cannot
 * buy on any curve or redeem perks (`Blacklisted`).
 *
 *   npx ts-node scripts/set-blacklist.ts <wallet> <blocked: true|false>
 */
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { blacklistPda, computeBudgetIxs, configPda, explorerAddress, explorerTx, log, run, section, setup } from "./common";

function usage(): never {
   console.error("usage: npx ts-node scripts/set-blacklist.ts <wallet> <blocked: true|false>");
   process.exit(2);
}

function parseBool(s: string): boolean {
   const v = s.trim().toLowerCase();
   if (["true", "1", "yes", "y", "block", "blocked"].includes(v)) return true;
   if (["false", "0", "no", "n", "unblock", "allowed"].includes(v)) return false;
   return usage();
}

run(async () => {
   const [walletArg, blockedArg] = process.argv.slice(2);
   if (!walletArg || !blockedArg) usage();
   let wallet: PublicKey;
   try {
      wallet = new PublicKey(walletArg);
   } catch {
      usage();
   }
   const blocked = parseBool(blockedArg);

   const ctx = setup();
   section("Set blacklist");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("admin (CLI wallet)", ctx.wallet.publicKey);
   log("wallet", wallet);
   log("blocked", blocked);
   const entry = blacklistPda(wallet);
   log("entry PDA", entry);

   const config = await ctx.program.account.config.fetch(configPda());
   if (!config.admin.equals(ctx.wallet.publicKey)) {
      throw new Error(`CLI wallet is not the admin (${config.admin.toBase58()}).`);
   }

   const sig = await ctx.program.methods
      .setBlacklist(wallet, blocked)
      .accountsStrict({ admin: ctx.wallet.publicKey, config: configPda(), entry, systemProgram: SystemProgram.programId })
      .preInstructions(computeBudgetIxs(50_000))
      .rpc();
   log("set_blacklist", explorerTx(sig, ctx.cluster));

   const record = await ctx.program.account.blacklist.fetch(entry);
   section("On-chain record");
   log("wallet", record.wallet);
   log("blocked", record.blocked);
   log("updated", new Date(record.updatedTs.toNumber() * 1000).toISOString());
   log("explorer", explorerAddress(entry, ctx.cluster));
});
