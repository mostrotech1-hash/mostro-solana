/**
 * Switches the SOL/USD price source and optionally sets the admin price. Admin only.
 *
 *   npx ts-node scripts/set-price.ts <mode 0|1> [priceUsd]
 *
 *   mode 0 = admin-set price (`sol_usd_price_e6`), used by `buy_tokens_usdc`.
 *   mode 1 = Pyth PriceUpdateV2 account configured in `config.pyth_sol_usd_account`.
 *
 * In mode 1 the script also reads the Pyth account and prints the live price and its age so a stale
 * feed (older than `max_price_age_secs`) is visible before a buyer hits `PriceTooOld`.
 *
 * In mode 0 the program checks `config.price_updated_ts` against its own limit, `admin_price_max_age_secs`
 * (86_400 s on devnet; Pyth keeps the separate `max_price_age_secs`). An admin price older than that blocks USDC
 * buys with `PriceTooOld`. Re-run this script with a price (or any `set_config` that sets `sol_usd_price_e6`)
 * to refresh the timestamp.
 */
import { BN } from "@coral-xyz/anchor";
import {
   PRICE_MODE_ADMIN,
   PRICE_MODE_PYTH,
   PYTH_RECEIVER_PROGRAM_ID,
   PYTH_SOL_USD_ACCOUNT,
   PYTH_SOL_USD_FEED_ID_HEX,
   computeBudgetIxs,
   configPda,
   decodePriceUpdateV2,
   explorerTx,
   feedIdBytes,
   fmtUnits,
   log,
   nowTs,
   run,
   section,
   setup,
   toBaseUnits,
   warn,
} from "./common";

function usage(): never {
   console.error("usage: npx ts-node scripts/set-price.ts <mode 0|1> [priceUsd]");
   process.exit(2);
}

run(async () => {
   const [modeArg, priceArg] = process.argv.slice(2);
   if (modeArg !== "0" && modeArg !== "1") usage();
   const mode = Number(modeArg);
   const priceE6 = priceArg !== undefined ? new BN(toBaseUnits(priceArg, 6).toString()) : null;
   if (priceE6 !== null && priceE6.isZero()) throw new Error("priceUsd must be > 0");

   const ctx = setup();
   section("Set price source");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("admin (CLI wallet)", ctx.wallet.publicKey);
   log("mode", mode === PRICE_MODE_ADMIN ? "0 (admin price)" : "1 (Pyth)");
   if (priceE6) log("admin price", `$${fmtUnits(priceE6, 6)}`);

   const config = await ctx.program.account.config.fetch(configPda());
   if (!config.admin.equals(ctx.wallet.publicKey)) {
      throw new Error(`CLI wallet is not the admin (${config.admin.toBase58()}).`);
   }
   log("current mode", config.priceMode);
   log("current admin price", `$${fmtUnits(config.solUsdPriceE6, 6)}`);
   const adminAge = nowTs() - config.priceUpdatedTs.toNumber();
   log("admin price age", `${adminAge}s${adminAge > config.adminPriceMaxAgeSecs ? " (STALE: USDC buys in mode 0 fail with PriceTooOld)" : ""}`);
   log("pyth account", config.pythSolUsdAccount);
   log("max price age", `${config.adminPriceMaxAgeSecs}s`);
   if (mode === PRICE_MODE_ADMIN && priceE6 === null && adminAge > config.adminPriceMaxAgeSecs) {
      warn(`mode 0 without a price keeps price_updated_ts at ${adminAge}s old; pass a priceUsd to refresh it.`);
   }

   // Make sure the Pyth wiring is in place before switching to mode 1 (it is set at init, but a
   // config initialized elsewhere may carry the default pubkey).
   const needsPythWiring = mode === PRICE_MODE_PYTH && !config.pythSolUsdAccount.equals(PYTH_SOL_USD_ACCOUNT);
   if (needsPythWiring) warn(`config.pyth_sol_usd_account is ${config.pythSolUsdAccount.toBase58()}; setting it to ${PYTH_SOL_USD_ACCOUNT.toBase58()}.`);

   if (mode === PRICE_MODE_PYTH) {
      const info = await ctx.connection.getAccountInfo(PYTH_SOL_USD_ACCOUNT, "confirmed");
      if (!info) throw new Error(`Pyth account ${PYTH_SOL_USD_ACCOUNT.toBase58()} not found on ${ctx.cluster.name}.`);
      if (!info.owner.equals(PYTH_RECEIVER_PROGRAM_ID)) warn(`Pyth account owner is ${info.owner.toBase58()}, expected ${PYTH_RECEIVER_PROGRAM_ID.toBase58()}.`);
      const p = decodePriceUpdateV2(info.data);
      const age = nowTs() - p.publishTime;
      section("Pyth SOL/USD");
      log("feed id", p.feedIdHex);
      log("verification", p.verificationFull ? "Full" : "NOT full (program will reject)");
      log("price", `${p.price.toString()} x 10^${p.exponent} = $${fmtUnits(p.priceE6, 6)}`);
      log("publish time", `${new Date(p.publishTime * 1000).toISOString()} (${age}s ago)`);
      if (p.feedIdHex !== PYTH_SOL_USD_FEED_ID_HEX) warn(`feed id differs from the expected SOL/USD feed ${PYTH_SOL_USD_FEED_ID_HEX}.`);
      if (age > config.maxPriceAgeSecs) warn(`feed is older than max_price_age_secs (${config.maxPriceAgeSecs}s); USDC buys will fail with PriceTooOld until it refreshes.`);
   }

   const sig = await ctx.program.methods
      .setConfig({
         paused: null,
         kycRequired: null,
         priceMode: mode,
         solUsdPriceE6: priceE6,
         pythSolUsdAccount: needsPythWiring ? PYTH_SOL_USD_ACCOUNT : null,
         pythFeedId: needsPythWiring ? feedIdBytes(PYTH_SOL_USD_FEED_ID_HEX) : null,
         maxPriceAgeSecs: null,
         feeBps: null,
         standardDiscountBps: null,
         vipDiscountBps: null,
         standardEarlySecs: null,
         vipEarlySecs: null,
         minBurnBps: null,
         minRewardsBps: null,
         adminPriceMaxAgeSecs: null,
      })
      .accountsStrict({
         admin: ctx.wallet.publicKey,
         config: configPda(),
      })
      .preInstructions(computeBudgetIxs(50_000))
      .rpc();
   log("set_config", explorerTx(sig, ctx.cluster));

   const after = await ctx.program.account.config.fetch(configPda());
   section("Config after");
   log("price mode", after.priceMode);
   log("admin price", `$${fmtUnits(after.solUsdPriceE6, 6)}`);
   log("price updated", `${new Date(after.priceUpdatedTs.toNumber() * 1000).toISOString()} (valid for ${after.adminPriceMaxAgeSecs}s in mode 0)`);
   log("pyth account", after.pythSolUsdAccount);
});
