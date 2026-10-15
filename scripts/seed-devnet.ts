/**
 * Idempotent devnet seed. Safe to re-run: every step checks the chain first and skips what exists.
 *
 *   npx ts-node scripts/seed-devnet.ts
 *
 * 1. `initialize_config` (admin = CLI wallet, also the founding super-admin of the multisig; fee 100 bps;
 *    admin price $112 with Pyth SOL/USD wired in; 24 h launch cool-down unless `LAUNCH_COOLDOWN_SECS` is set;
 *    anti-whale cap from `MAX_SPEND_SOL_PER_MONTH` (default off); 7-day proposal TTL).
 * 2. `create_artist` #0 "MoOG" (authority = CLI wallet).
 * 3. `create_curve` #0 for artist #0: mints the fixed 1B supply into the four vaults, attaches Token Metadata
 *    and revokes the mint authority. The curve opens after the cool-down.
 * 4. Six perks on artist #0: Pass Classic, Pass VIP (admin-only), Music, Event (starts in 3 days), Merch
 *    (numbered, 100) priced in tokens, and a hybrid "Exclusive drop" priced in SOL (0.2 SOL, 100 copies).
 *    Every collection uses `collection_salt = COLLECTION_SALT` (1); the salt is recorded in the address map
 *    and `perk.collection` on-chain stays the source of truth.
 * 5. Writes `shared/addresses/<cluster>.json` with the full address map for the frontends.
 */
import * as fs from "fs";
import * as path from "path";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
   ARTIST_ALLOCATION,
   COLLECTION_SALT,
   CURVE_ALLOCATION,
   CU_LIMIT,
   Ctx,
   DEX_ALLOCATION,
   MOSTRO_ALLOCATION,
   MPL_CORE_PROGRAM_ID,
   PROGRAM_ID,
   PROGRAM_VERSION,
   PYTH_SOL_USD_ACCOUNT,
   PYTH_SOL_USD_FEED_ID_HEX,
   PerkKindName,
   REPO_ROOT,
   TIER_CLASSIC,
   TIER_VIP,
   TOKEN_METADATA_PROGRAM_ID,
   TOTAL_SUPPLY,
   USDC_MINT_DEVNET,
   accountExists,
   artistPda,
   artistReservePda,
   collectionPda,
   computeBudgetIxs,
   configPda,
   curvePda,
   curveUsdcAta,
   curveVaultPda,
   dexReservePda,
   explorerTx,
   feedIdBytes,
   fmtSol,
   fmtTokens,
   log,
   memberPda,
   metadataPda,
   mintPda,
   mostroReservePda,
   nowTs,
   perkKindArg,
   perkKindName,
   perkPda,
   programDataPda,
   rewardsVaultPda,
   run,
   section,
   setup,
   sol,
   solVaultPda,
   toBaseUnits,
   tokens,
   treasuryPda,
   treasuryUsdcAta,
   warn,
} from "./common";

// ---- Demo parameters ----------------------------------------------------------------------------

const CONFIG_ARGS = {
   feeBps: 100,
   solUsdPriceE6: new BN(112_000_000), // $112.00
   maxPriceAgeSecs: 300,
   adminCooloffSecs: 172_800, // 48 h
   adminPriceMaxAgeSecs: 86_400,
   /** Product value 24 h. Override with LAUNCH_COOLDOWN_SECS=60 for a demo that opens right away. */
   launchCooldownSecs: Number(process.env.LAUNCH_COOLDOWN_SECS ?? 86_400),
   /** Anti-whale cap in SOL per wallet per curve per 30 days; 0 = off. Override with MAX_SPEND_SOL_PER_MONTH. */
   maxSpendPerPeriodLamports: new BN(toBaseUnits(process.env.MAX_SPEND_SOL_PER_MONTH ?? "0", 9).toString()),
   proposalTtlSecs: 7 * 86_400,
};

/** Curve demo params: 30 SOL virtual, 379,000,000 tokens virtual; the cap is the fixed 280M allocation. */
const CURVE = {
   name: "MoOG Token",
   symbol: "MOOG",
   uri: "https://mostro.app/metadata/moog.json",
   virtualSolReserves: new BN("30000000000"),
   virtualTokenReserves: new BN("379000000000000"),
   saleStartTs: new BN(0),
};

const ARTIST = {
   name: "MoOG",
   uri: "https://mostro.app/metadata/artists/moog.json",
};

interface PerkSpec {
   kind: PerkKindName;
   tier: number;
   /** Whole tokens; 0 for a hybrid perk. */
   priceTokens: number;
   /** Whole SOL; 0 for a token-priced perk. */
   priceSol: number;
   maxSupply: number;
   publicStartTs: () => BN;
   name: string;
   uri: string;
}

const THREE_DAYS = 3 * 24 * 60 * 60;

const PERKS: PerkSpec[] = [
   {
      kind: "pass",
      tier: TIER_CLASSIC,
      priceTokens: 100_000,
      priceSol: 0,
      maxSupply: 0,
      publicStartTs: () => new BN(0),
      name: "Mostro Pass Classic",
      uri: "https://mostro.app/metadata/perks/pass-classic.json",
   },
   {
      kind: "pass",
      tier: TIER_VIP,
      priceTokens: 300_000,
      priceSol: 0,
      maxSupply: 0,
      publicStartTs: () => new BN(0),
      name: "Mostro Pass VIP",
      uri: "https://mostro.app/metadata/perks/pass-vip.json",
   },
   {
      kind: "music",
      tier: 0,
      priceTokens: 10_000,
      priceSol: 0,
      maxSupply: 0,
      publicStartTs: () => new BN(0),
      name: "Unreleased track",
      uri: "https://mostro.app/metadata/perks/unreleased-track.json",
   },
   {
      kind: "event",
      tier: 0,
      priceTokens: 50_000,
      priceSol: 0,
      maxSupply: 0,
      publicStartTs: () => new BN(nowTs() + THREE_DAYS),
      name: "Listening session",
      uri: "https://mostro.app/metadata/perks/listening-session.json",
   },
   {
      kind: "merch",
      tier: 0,
      priceTokens: 20_000,
      priceSol: 0,
      maxSupply: 100,
      publicStartTs: () => new BN(0),
      name: "Numbered tee",
      uri: "https://mostro.app/metadata/perks/numbered-tee.json",
   },
   {
      kind: "music",
      tier: 0,
      priceTokens: 0,
      priceSol: 0.2,
      maxSupply: 100,
      publicStartTs: () => new BN(0),
      name: "Exclusive drop",
      uri: "https://mostro.app/metadata/perks/exclusive-drop.json",
   },
];

// ---- Steps ---------------------------------------------------------------------------------------

async function ensureConfig(ctx: Ctx, usdcMint: PublicKey): Promise<void> {
   section("Config");
   const config = configPda();
   log("config", config);
   log("treasury", treasuryPda());
   log("treasury USDC ATA", treasuryUsdcAta(usdcMint));
   if (await accountExists(ctx.connection, config)) {
      const c = await ctx.program.account.config.fetch(config);
      log("exists, admin", c.admin);
      log("fee bps", c.feeBps);
      log("price mode", c.priceMode);
      log("launch cool-down", `${c.launchCooldownSecs}s`);
      log("spend cap", c.maxSpendPerPeriodLamports.isZero() ? "off" : `${fmtSol(c.maxSpendPerPeriodLamports)} / 30 days`);
      log("members / weight", `${c.memberCount} / ${c.totalWeight}`);
      log("curves / artists", `${c.curveCount} / ${c.artistCount}`);
      if (!c.admin.equals(ctx.wallet.publicKey)) warn(`CLI wallet ${ctx.wallet.publicKey.toBase58()} is not the admin; later steps will fail.`);
      return;
   }
   const sig = await ctx.program.methods
      .initializeConfig({
         admin: ctx.wallet.publicKey,
         feeBps: CONFIG_ARGS.feeBps,
         solUsdPriceE6: CONFIG_ARGS.solUsdPriceE6,
         maxPriceAgeSecs: CONFIG_ARGS.maxPriceAgeSecs,
         pythSolUsdAccount: PYTH_SOL_USD_ACCOUNT,
         pythFeedId: feedIdBytes(PYTH_SOL_USD_FEED_ID_HEX),
         adminCooloffSecs: CONFIG_ARGS.adminCooloffSecs,
         adminPriceMaxAgeSecs: CONFIG_ARGS.adminPriceMaxAgeSecs,
         launchCooldownSecs: CONFIG_ARGS.launchCooldownSecs,
         maxSpendPerPeriodLamports: CONFIG_ARGS.maxSpendPerPeriodLamports,
         proposalTtlSecs: CONFIG_ARGS.proposalTtlSecs,
      })
      .accountsStrict({
         payer: ctx.wallet.publicKey,
         config,
         treasury: treasuryPda(),
         usdcMint,
         treasuryUsdc: treasuryUsdcAta(usdcMint),
         adminMember: memberPda(ctx.wallet.publicKey),
         program: PROGRAM_ID,
         programData: programDataPda(),
         usdcTokenProgram: TOKEN_PROGRAM_ID,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudgetIxs())
      .rpc();
   log("initialize_config", explorerTx(sig, ctx.cluster));
}

async function ensureArtist(ctx: Ctx, index: number): Promise<void> {
   section(`Artist #${index}`);
   const artist = artistPda(index);
   log("artist", artist);
   if (await accountExists(ctx.connection, artist)) {
      const a = await ctx.program.account.artist.fetch(artist);
      log("exists", `${a.name}, authority ${a.authority.toBase58()}, perks ${a.perkCount}`);
      return;
   }
   const config = await ctx.program.account.config.fetch(configPda());
   if (config.artistCount !== index) throw new Error(`Cannot create artist #${index}: config.artist_count is ${config.artistCount}`);
   const sig = await ctx.program.methods
      .createArtist(ctx.wallet.publicKey, ARTIST.name, ARTIST.uri)
      .accountsStrict({ admin: ctx.wallet.publicKey, config: configPda(), artist, systemProgram: SystemProgram.programId })
      .preInstructions(computeBudgetIxs())
      .rpc();
   log("create_artist", explorerTx(sig, ctx.cluster));
}

async function ensureCurve(ctx: Ctx, index: number, artistIndex: number, usdcMint: PublicKey): Promise<void> {
   section(`Curve #${index} (artist #${artistIndex})`);
   const curve = curvePda(index);
   const mint = mintPda(index);
   const artist = artistPda(artistIndex);
   log("curve", curve);
   log("mint", mint);
   log("curve vault (hot)", curveVaultPda(curve));
   log("artist reserve (cold)", artistReservePda(curve));
   log("mostro reserve (cold)", mostroReservePda(curve));
   log("dex reserve (cold)", dexReservePda(curve));
   log("rewards vault", rewardsVaultPda(curve));
   log("sol vault", solVaultPda(curve));
   log("usdc vault", curveUsdcAta(curve, usdcMint));
   log("token metadata", metadataPda(mint));
   if (await accountExists(ctx.connection, curve)) {
      const c = await ctx.program.account.curve.fetch(curve);
      log("exists", `${c.name} (${c.symbol}), sold ${fmtTokens(c.tokensSold, c.symbol)}, opens ${new Date(c.saleStartTs.toNumber() * 1000).toISOString()}, complete=${c.complete}`);
      return;
   }
   const config = await ctx.program.account.config.fetch(configPda());
   if (config.curveCount !== index) throw new Error(`Cannot create curve #${index}: config.curve_count is ${config.curveCount}`);
   const a = await ctx.program.account.artist.fetch(artist);
   if (!a.curve.equals(PublicKey.default)) throw new Error(`Artist #${artistIndex} already has token ${a.curve.toBase58()}`);
   const sig = await ctx.program.methods
      .createCurve(CURVE)
      .accountsStrict({
         admin: ctx.wallet.publicKey,
         config: configPda(),
         artist,
         curve,
         mint,
         curveVault: curveVaultPda(curve),
         artistReserve: artistReservePda(curve),
         mostroReserve: mostroReservePda(curve),
         dexReserve: dexReservePda(curve),
         rewardsVault: rewardsVaultPda(curve),
         solVault: solVaultPda(curve),
         usdcMint,
         usdcVault: curveUsdcAta(curve, usdcMint),
         metadata: metadataPda(mint),
         tokenProgram: TOKEN_PROGRAM_ID,
         usdcTokenProgram: TOKEN_PROGRAM_ID,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
         rent: SYSVAR_RENT_PUBKEY,
      })
      .preInstructions(computeBudgetIxs(CU_LIMIT))
      .rpc();
   log("create_curve", explorerTx(sig, ctx.cluster));
   const c = await ctx.program.account.curve.fetch(curve);
   log("opens", new Date(c.saleStartTs.toNumber() * 1000).toISOString());
   log(
      "supply",
      `${fmtTokens(TOTAL_SUPPLY, c.symbol)}: curve ${fmtTokens(CURVE_ALLOCATION)}, artist ${fmtTokens(ARTIST_ALLOCATION)}, mostro ${fmtTokens(MOSTRO_ALLOCATION)}, dex ${fmtTokens(DEX_ALLOCATION)}`,
   );
}

async function ensurePerks(ctx: Ctx, artistIndex: number, curveIndex: number): Promise<void> {
   const artist = artistPda(artistIndex);
   const curve = curvePda(curveIndex);
   const mint = mintPda(curveIndex);
   section(`Perks on artist #${artistIndex}`);
   for (let i = 0; i < PERKS.length; i++) {
      const spec = PERKS[i];
      const perk = perkPda(artist, i);
      const collection = collectionPda(perk, COLLECTION_SALT);
      const priceLabel = spec.priceSol > 0 ? `${spec.priceSol} SOL (hybrid)` : `${spec.priceTokens.toLocaleString("en-US")} tokens`;
      log(`perk #${i}`, `${perk.toBase58()} (${spec.kind}${spec.kind === "pass" ? ` tier ${spec.tier}` : ""}, ${spec.name}, ${priceLabel})`);
      log(`collection #${i}`, `${collection.toBase58()} (salt ${COLLECTION_SALT})`);
      if (await accountExists(ctx.connection, perk)) {
         const p = await ctx.program.account.perk.fetch(perk);
         if (!p.collection.equals(collection)) log(`collection #${i}`, `on-chain ${p.collection.toBase58()} (created with another salt; using it)`);
         const onChainKind = perkKindName(p.kind);
         if (onChainKind !== spec.kind || p.tier !== spec.tier) {
            warn(`perk #${i} exists as ${onChainKind} tier ${p.tier}, expected ${spec.kind} tier ${spec.tier}; leaving it untouched.`);
         } else {
            log(`exists #${i}`, `${p.name}, sold ${p.sold}`);
         }
         continue;
      }
      const a = await ctx.program.account.artist.fetch(artist);
      if (a.perkCount !== i) throw new Error(`Cannot create perk #${i}: artist.perk_count is ${a.perkCount}`);
      const config = await ctx.program.account.config.fetch(configPda());
      if (spec.kind === "pass" && !config.admin.equals(ctx.wallet.publicKey)) {
         throw new Error(`Cannot create perk #${i}: Pass perks are admin-only and the CLI wallet is not config.admin (${config.admin.toBase58()}).`);
      }
      const sig = await ctx.program.methods
         .createPerk({
            kind: perkKindArg(spec.kind),
            tier: spec.tier,
            priceTokens: tokens(spec.priceTokens),
            priceLamports: sol(spec.priceSol),
            maxSupply: spec.maxSupply,
            publicStartTs: spec.publicStartTs(),
            name: spec.name,
            uri: spec.uri,
            collectionSalt: new BN(COLLECTION_SALT),
         })
         .accountsStrict({
            signer: ctx.wallet.publicKey,
            config: configPda(),
            artist,
            curve,
            mint,
            perk,
            collection,
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
         })
         .preInstructions(computeBudgetIxs(CU_LIMIT))
         .rpc();
      log(`create_perk #${i}`, explorerTx(sig, ctx.cluster));
   }
}

// ---- Address map ---------------------------------------------------------------------------------

interface PerkEntry {
   index: number;
   perk: string;
   /** `perk.collection` as stored on-chain. */
   collection: string;
   /** Salt the seed passed to `create_perk` (`["collection", perk, salt]`); informational, the address above is authoritative. */
   collectionSalt: number;
   kind: PerkKindName;
   tier: number;
   name: string;
   /** `"tokens"` -> `redeem_perk`, `"sol"` -> `buy_perk_sol`. */
   payment: "tokens" | "sol";
   /** Price in token base units (6 decimals), as a decimal string; "0" for hybrid perks. */
   priceTokens: string;
   /** Price in lamports, as a decimal string; "0" for token-priced perks. */
   priceLamports: string;
   priceUi: number;
   maxSupply: number;
   publicStartTs: number;
}

interface AddressMap {
   programId: string;
   cluster: string;
   rpc: string;
   mplCore: string;
   usdcMint: string;
   pythSolUsd: string;
   pythFeedId: string;
   config: string;
   treasury: string;
   treasuryUsdc: string;
   admin: string;
   /** Fixed supply split, in base units. */
   allocations: { totalSupply: string; curve: string; artistReserve: string; mostroReserve: string; dexReserve: string };
   /** Governance snapshot at seed time. */
   governance: { totalWeight: number; memberCount: number; proposalTtlSecs: number; members: { wallet: string; role: number }[] };
   launchCooldownSecs: number;
   maxSpendPerPeriodLamports: string;
   curves: {
      index: number;
      artist: string;
      curve: string;
      mint: string;
      curveVault: string;
      artistReserve: string;
      mostroReserve: string;
      dexReserve: string;
      solVault: string;
      rewardsVault: string;
      usdcVault: string;
      metadata: string;
      name: string;
      symbol: string;
      decimals: number;
      saleStartTs: number;
   }[];
   artists: { index: number; artist: string; authority: string; curve: string; name: string; perks: PerkEntry[] }[];
   deployedAt: string;
   programVersion: string;
}

async function buildAddressMap(ctx: Ctx, usdcMint: PublicKey): Promise<AddressMap> {
   const config = await ctx.program.account.config.fetch(configPda());
   const curves: AddressMap["curves"] = [];
   for (let i = 0; i < config.curveCount; i++) {
      const curve = curvePda(i);
      const c = await ctx.program.account.curve.fetch(curve);
      curves.push({
         index: i,
         artist: c.artist.toBase58(),
         curve: curve.toBase58(),
         mint: c.mint.toBase58(),
         curveVault: curveVaultPda(curve).toBase58(),
         artistReserve: artistReservePda(curve).toBase58(),
         mostroReserve: mostroReservePda(curve).toBase58(),
         dexReserve: dexReservePda(curve).toBase58(),
         solVault: solVaultPda(curve).toBase58(),
         rewardsVault: rewardsVaultPda(curve).toBase58(),
         usdcVault: curveUsdcAta(curve, usdcMint).toBase58(),
         metadata: metadataPda(c.mint).toBase58(),
         name: c.name,
         symbol: c.symbol,
         decimals: 6,
         saleStartTs: c.saleStartTs.toNumber(),
      });
   }
   const artists: AddressMap["artists"] = [];
   for (let i = 0; i < config.artistCount; i++) {
      const artist = artistPda(i);
      const a = await ctx.program.account.artist.fetch(artist);
      const perks: PerkEntry[] = [];
      for (let j = 0; j < a.perkCount; j++) {
         const perk = perkPda(artist, j);
         const p = await ctx.program.account.perk.fetch(perk);
         const hybrid = !p.priceLamports.isZero();
         perks.push({
            index: j,
            perk: perk.toBase58(),
            collection: p.collection.toBase58(),
            collectionSalt: COLLECTION_SALT,
            kind: perkKindName(p.kind),
            tier: p.tier,
            name: p.name,
            payment: hybrid ? "sol" : "tokens",
            priceTokens: p.priceTokens.toString(),
            priceLamports: p.priceLamports.toString(),
            priceUi: hybrid ? Number(p.priceLamports.toString()) / 1e9 : Number(p.priceTokens.toString()) / 1e6,
            maxSupply: p.maxSupply,
            publicStartTs: p.publicStartTs.toNumber(),
         });
      }
      artists.push({ index: i, artist: artist.toBase58(), authority: a.authority.toBase58(), curve: a.curve.toBase58(), name: a.name, perks });
   }
   const members = (await ctx.program.account.member.all()).filter((m) => m.account.role !== 0).map((m) => ({ wallet: m.account.wallet.toBase58(), role: m.account.role }));
   return {
      programId: PROGRAM_ID.toBase58(),
      cluster: ctx.cluster.name,
      rpc: ctx.cluster.rpc,
      mplCore: MPL_CORE_PROGRAM_ID.toBase58(),
      usdcMint: usdcMint.toBase58(),
      pythSolUsd: config.pythSolUsdAccount.toBase58(),
      pythFeedId: Buffer.from(config.pythFeedId).toString("hex"),
      config: configPda().toBase58(),
      treasury: treasuryPda().toBase58(),
      treasuryUsdc: treasuryUsdcAta(usdcMint).toBase58(),
      admin: config.admin.toBase58(),
      allocations: {
         totalSupply: TOTAL_SUPPLY.toString(),
         curve: CURVE_ALLOCATION.toString(),
         artistReserve: ARTIST_ALLOCATION.toString(),
         mostroReserve: MOSTRO_ALLOCATION.toString(),
         dexReserve: DEX_ALLOCATION.toString(),
      },
      governance: { totalWeight: config.totalWeight, memberCount: config.memberCount, proposalTtlSecs: config.proposalTtlSecs, members },
      launchCooldownSecs: config.launchCooldownSecs,
      maxSpendPerPeriodLamports: config.maxSpendPerPeriodLamports.toString(),
      curves,
      artists,
      deployedAt: new Date().toISOString(),
      programVersion: PROGRAM_VERSION,
   };
}

function writeAddressMap(ctx: Ctx, map: AddressMap): string {
   const dir = path.join(REPO_ROOT, "shared", "addresses");
   fs.mkdirSync(dir, { recursive: true });
   const file = path.join(dir, `${ctx.cluster.name}.json`);
   fs.writeFileSync(file, JSON.stringify(map, null, 3) + "\n");
   return file;
}

// ---- Main ----------------------------------------------------------------------------------------

run(async () => {
   const ctx = setup();
   section("Environment");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("wallet", ctx.wallet.publicKey);
   log("program", PROGRAM_ID);
   log("program version", PROGRAM_VERSION);
   const balance = await ctx.connection.getBalance(ctx.wallet.publicKey);
   log("wallet balance", `${balance / 1e9} SOL`);
   if (balance < 0.3e9) warn("Less than 0.3 SOL; seeding needs rent for ~15 accounts plus 6 Core collections.");
   if (!(await accountExists(ctx.connection, PROGRAM_ID))) throw new Error(`Program ${PROGRAM_ID.toBase58()} is not deployed on ${ctx.cluster.name}.`);

   const usdcMint = USDC_MINT_DEVNET;
   if (ctx.cluster.name !== "devnet") warn(`Using the devnet USDC mint ${usdcMint.toBase58()} on ${ctx.cluster.name}; override common.ts if that is wrong.`);

   await ensureConfig(ctx, usdcMint);
   await ensureArtist(ctx, 0);
   await ensureCurve(ctx, 0, 0, usdcMint);
   await ensurePerks(ctx, 0, 0);

   section("Address map");
   const map = await buildAddressMap(ctx, usdcMint);
   const file = writeAddressMap(ctx, map);
   log("written", path.relative(REPO_ROOT, file));
});
