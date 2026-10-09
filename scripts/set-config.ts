/**
 * Generic admin switchboard for `set_config`.
 *
 *   yarn ts-node scripts/set-config.ts key=value [key=value ...]
 *
 * Keys (camelCase as in the IDL): paused, kycRequired, priceMode, solUsdPriceE6, pythSolUsdAccount,
 * pythFeedId (hex), maxPriceAgeSecs, feeBps, standardDiscountBps, vipDiscountBps, standardEarlySecs,
 * vipEarlySecs, minBurnBps, minRewardsBps, adminPriceMaxAgeSecs. Unspecified keys are left untouched.
 *
 * Examples:
 *   scripts/set-config.ts kycRequired=true adminPriceMaxAgeSecs=86400
 *   scripts/set-config.ts paused=true
 */
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { computeBudgetIxs, configPda, explorerTx, feedIdBytes, log, run, section, setup } from "./common";

const BOOL_KEYS = new Set(["paused", "kycRequired"]);
const U8_KEYS = new Set(["priceMode"]);
const U16_KEYS = new Set(["feeBps", "standardDiscountBps", "vipDiscountBps", "minBurnBps", "minRewardsBps"]);
const U32_KEYS = new Set(["maxPriceAgeSecs", "standardEarlySecs", "vipEarlySecs", "adminPriceMaxAgeSecs"]);
const U64_KEYS = new Set(["solUsdPriceE6"]);
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
   const args: Record<string, unknown> = Object.fromEntries(ALL.map((k) => [k, null]));
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
   log("paused / kycRequired", `${after.paused} / ${after.kycRequired}`);
   log("priceMode / solUsdPriceE6", `${after.priceMode} / ${after.solUsdPriceE6.toString()}`);
   log("maxPriceAgeSecs / adminPriceMaxAgeSecs", `${after.maxPriceAgeSecs} / ${after.adminPriceMaxAgeSecs}`);
   log("floors burn / rewards", `${after.minBurnBps} / ${after.minRewardsBps}`);
});
