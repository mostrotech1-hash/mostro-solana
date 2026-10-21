/**
 * Admin / artist switchboard for `set_perk`.
 *
 *   npx ts-node scripts/set-perk.ts <artistIndex> <perkIndex> key=value [key=value ...]
 *
 * Keys: priceTokens (whole tokens), priceLamports, active, maxSupply, publicStartTs (unix seconds), uri.
 * Unspecified keys are left untouched. The CLI wallet must be `config.admin` or the artist's authority.
 *
 * Examples:
 *   scripts/set-perk.ts 0 0 priceTokens=1200          # the Classic pass costs 1,200 tokens
 *   scripts/set-perk.ts 0 4 active=false              # take the merch perk off sale
 */
import { BN } from "@coral-xyz/anchor";
import { artistPda, computeBudgetIxs, configPda, explorerTx, log, perkPda, run, section, setup, tokens } from "./common";

const BOOL_KEYS = new Set(["active"]);
const U32_KEYS = new Set(["maxSupply"]);
const I64_KEYS = new Set(["publicStartTs"]);
const LAMPORT_KEYS = new Set(["priceLamports"]);
const TOKEN_KEYS = new Set(["priceTokens"]);
const STRING_KEYS = new Set(["uri"]);
const ALL = [...TOKEN_KEYS, ...LAMPORT_KEYS, ...BOOL_KEYS, ...U32_KEYS, ...I64_KEYS, ...STRING_KEYS];

function usage(): never {
   console.error(`usage: set-perk.ts <artistIndex> <perkIndex> key=value [key=value ...]\nkeys: ${ALL.join(", ")}`);
   process.exit(1);
}

run(async () => {
   const [artistArg, perkArg, ...pairs] = process.argv.slice(2);
   const artistIndex = Number(artistArg);
   const perkIndex = Number(perkArg);
   if (!Number.isInteger(artistIndex) || !Number.isInteger(perkIndex) || pairs.length === 0) usage();
   const args: Record<string, unknown> = { priceTokens: null, priceLamports: null, active: null, maxSupply: null, publicStartTs: null, uri: null };
   for (const pair of pairs) {
      const [key, value] = pair.split("=");
      if (!key || value === undefined || !ALL.includes(key)) usage();
      if (BOOL_KEYS.has(key)) {
         if (!["true", "false", "1", "0"].includes(value)) usage();
         args[key] = value === "true" || value === "1";
      } else if (U32_KEYS.has(key)) args[key] = Number(value);
      else if (I64_KEYS.has(key) || LAMPORT_KEYS.has(key)) args[key] = new BN(value);
      else if (TOKEN_KEYS.has(key)) args[key] = tokens(value);
      else if (STRING_KEYS.has(key)) args[key] = value;
   }

   const ctx = setup();
   const artist = artistPda(artistIndex);
   const perk = perkPda(artist, perkIndex);
   section("Set perk");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("signer (CLI wallet)", ctx.wallet.publicKey);
   log("perk", `${perk.toBase58()} (artist #${artistIndex}, perk #${perkIndex})`);
   for (const pair of pairs) log("set", pair);

   const sig = await ctx.program.methods
      .setPerk(args as any)
      .accountsStrict({ signer: ctx.wallet.publicKey, config: configPda(), artist, perk })
      .preInstructions(computeBudgetIxs(50_000))
      .rpc();
   log("tx", explorerTx(sig, ctx.cluster));
   const after = await ctx.program.account.perk.fetch(perk);
   log("name", after.name);
   log("priceTokens / priceLamports", `${after.priceTokens.toString()} / ${after.priceLamports.toString()}`);
   log("active / maxSupply / sold", `${after.active} / ${after.maxSupply} / ${after.sold}`);
   log("publicStartTs", after.publicStartTs.toString());
});
