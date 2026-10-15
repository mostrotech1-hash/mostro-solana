/**
 * Generic admin switchboard for `set_config`.
 *
 *   npx ts-node scripts/set-config.ts key=value [key=value ...]
 *
 * Keys (camelCase as in the IDL): buysPaused, redeemsPaused, priceMode, solUsdPriceE6, pythSolUsdAccount,
 * pythFeedId (hex), maxPriceAgeSecs, adminPriceMaxAgeSecs, feeBps, launchCooldownSecs,
 * maxSpendPerPeriodLamports, proposalTtlSecs. Unspecified keys are left untouched.
 *
 * Examples:
 *   scripts/set-config.ts buysPaused=false redeemsPaused=false      # resume after an emergency pause
 *   scripts/set-config.ts maxSpendPerPeriodLamports=5000000000      # 5 SOL per wallet per curve per 30 days
 *   scripts/set-config.ts launchCooldownSecs=86400
 */
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { computeBudgetIxs, configPda, emptySetConfigArgs, explorerTx, feedIdBytes, fmtSol, log, run, section, setup } from "./common";

const BOOL_KEYS = new Set(["buysPaused", "redeemsPaused"]);
const U8_KEYS = new Set(["priceMode"]);
const U16_KEYS = new Set(["feeBps"]);
const U32_KEYS = new Set(["maxPriceAgeSecs", "adminPriceMaxAgeSecs", "launchCooldownSecs", "proposalTtlSecs"]);
const U64_KEYS = new Set(["solUsdPriceE6", "maxSpendPerPeriodLamports"]);
const PUBKEY_KEYS = new Set(["pythSolUsdAccount"]);
const FEED_KEYS = new Set(["pythFeedId"]);
const ALL = [...BOOL_KEYS, ...U8_KEYS, ...U16_KEYS, ...U32_KEYS, ...U64_KEYS, ...PUBKEY_KEYS, ...FEED_KEYS];

function usage(): never {
   console.error(`usage: set-config.ts key=value [key=value ...]\nkeys: ${ALL.join(", ")}`);
   process.exit(1);
}

run(async () => {
   const pairs = process.argv.slice(2);
   if (pairs.length === 0) usage();
   const args: Record<string, unknown> = emptySetConfigArgs();
   for (const pair of pairs) {
      const [key, value] = pair.split("=");
      if (!key || value === undefined || !ALL.includes(key)) usage();
      if (BOOL_KEYS.has(key)) {
         if (!["true", "false", "1", "0"].includes(value)) usage();
         args[key] = value === "true" || value === "1";
      } else if (U8_KEYS.has(key) || U16_KEYS.has(key) || U32_KEYS.has(key)) args[key] = Number(value);
      else if (U64_KEYS.has(key)) args[key] = new BN(value);
      else if (PUBKEY_KEYS.has(key)) args[key] = new PublicKey(value);
      else if (FEED_KEYS.has(key)) args[key] = feedIdBytes(value);
   }

   const ctx = setup();
   section("Set config");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("admin (CLI wallet)", ctx.wallet.publicKey);
   for (const pair of pairs) log("set", pair);

   const before = await ctx.program.account.config.fetch(configPda());
   if (!before.admin.equals(ctx.wallet.publicKey)) {
      throw new Error(`CLI wallet is not the admin (${before.admin.toBase58()}).`);
   }
   const sig = await ctx.program.methods
      .setConfig(args as any)
      .accountsStrict({ admin: ctx.wallet.publicKey, config: configPda() })
      .preInstructions(computeBudgetIxs(50_000))
      .rpc();
   log("tx", explorerTx(sig, ctx.cluster));
   const after = await ctx.program.account.config.fetch(configPda());
   log("buysPaused / redeemsPaused", `${after.buysPaused} / ${after.redeemsPaused}`);
   log("priceMode / solUsdPriceE6", `${after.priceMode} / ${after.solUsdPriceE6.toString()}`);
   log("maxPriceAgeSecs / adminPriceMaxAgeSecs", `${after.maxPriceAgeSecs} / ${after.adminPriceMaxAgeSecs}`);
   log("feeBps", after.feeBps);
   log("launchCooldownSecs", after.launchCooldownSecs);
   log("spend cap", after.maxSpendPerPeriodLamports.isZero() ? "off" : `${fmtSol(after.maxSpendPerPeriodLamports)} / 30 days`);
   log("proposalTtlSecs", after.proposalTtlSecs);
});
