/**
 * Idempotent devnet seed. Safe to re-run: every step checks the chain first and skips what exists.
 *
 *   npx ts-node scripts/seed-devnet.ts
 *
 * 1. `initialize_config` (admin = CLI wallet, fee 100 bps, admin price $112, Pyth SOL/USD wired in,
 *    split floors min_burn_bps = 0 / min_rewards_bps = 0; the perks below still use 8000 / 2000).
 * 2. `create_curve` #0 "Mostro" / "MOST" with demo params "set B", then `set_curve_metadata` (Token Metadata
 *    for the mint so wallets show "MOST") when the metadata account does not exist yet.
 * 3. `create_artist` #0 "MoOG" (authority = CLI wallet).
 * 4. Five perks on artist #0: Pass Standard, Pass VIP, Music, Event (early access demo), Merch (numbered, 100).
 *    Pass perks are admin-only on-chain; the CLI wallet is both the admin and the artist authority, so one
 *    signer creates all five. Every collection uses `collection_salt = COLLECTION_SALT` (1); the salt is
 *    recorded in the address map, and `perk.collection` on-chain stays the source of truth.
 * 5. Writes `shared/addresses/<cluster>.json` with the full address map for the frontends.
 */
import * as fs from "fs";
import * as path from "path";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
   COLLECTION_SALT,
   CU_LIMIT,
   Ctx,
   MPL_CORE_PROGRAM_ID,
   PROGRAM_ID,
   PROGRAM_VERSION,
   PYTH_SOL_USD_ACCOUNT,
   PYTH_SOL_USD_FEED_ID_HEX,
   PerkKindName,
   REPO_ROOT,
   TIER_STANDARD,
   TIER_VIP,
   TOKEN_METADATA_PROGRAM_ID,
   USDC_MINT_DEVNET,
   accountExists,
   artistPda,
   artistVaultPda,
   collectionPda,
   computeBudgetIxs,
   configPda,
   curvePda,
   curveUsdcAta,
   explorerTx,
   feedIdBytes,
   fmtMost,
   log,
   metadataPda,
   mintPda,
   most,
   nowTs,
   perkKindArg,
   perkKindName,
   perkPda,
   programDataPda,
   rewardsVaultPda,
   run,
   section,
   setup,
   solVaultPda,
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
   // Protocol floors for every perk split. 0 / 0 on devnet so artists can experiment; raise with set_config.
   minBurnBps: 0,
   minRewardsBps: 0,
   adminPriceMaxAgeSecs: 86_400,
};

/** Curve demo params "set B": 30 SOL virtual, 1,000,000 tokens virtual, cap 800,000 tokens. */
const CURVE_SET_B = {
   name: "Mostro",
   symbol: "MOST",
   uri: "https://mostro.app/metadata/most.json",
   virtualSolReserves: new BN("30000000000"),
   virtualTokenReserves: new BN("1000000000000"),
   supplyCap: new BN("800000000000"),
   saleStartTs: new BN(0),
};

const ARTIST = {
   name: "MoOG",
   uri: "https://mostro.app/metadata/artists/moog.json",
};

interface PerkSpec {
   kind: PerkKindName;
   tier: number;
   priceMost: number;
   burnBps: number;
   rewardsBps: number;
   maxSupply: number;
   publicStartTs: () => BN;
   vipOnly: boolean;
   discountEligible: boolean;
   name: string;
   uri: string;
}

const THREE_DAYS = 3 * 24 * 60 * 60;

const PERKS: PerkSpec[] = [
   {
      kind: "pass",
      tier: TIER_STANDARD,
      priceMost: 1_200,
      burnBps: 8_000,
      rewardsBps: 2_000,
      maxSupply: 0,
      publicStartTs: () => new BN(0),
      vipOnly: false,
      discountEligible: false,
      name: "MoOG Pass Standard",
      uri: "https://mostro.app/metadata/perks/pass-standard.json",
   },
   {
      kind: "pass",
      tier: TIER_VIP,
      priceMost: 3_750,
      burnBps: 8_000,
      rewardsBps: 2_000,
      maxSupply: 0,
      publicStartTs: () => new BN(0),
      vipOnly: false,
      discountEligible: false,
      name: "MoOG Pass VIP",
      uri: "https://mostro.app/metadata/perks/pass-vip.json",
   },
   {
      kind: "music",
      tier: 0,
      priceMost: 50,
      burnBps: 8_000,
      rewardsBps: 2_000,
      maxSupply: 0,
      publicStartTs: () => new BN(0),
      vipOnly: false,
      discountEligible: true,
      name: "Unreleased track",
      uri: "https://mostro.app/metadata/perks/unreleased-track.json",
   },
   {
      kind: "event",
      tier: 0,
      priceMost: 900,
      burnBps: 8_000,
      rewardsBps: 2_000,
      maxSupply: 0,
      // Public in 3 days: Standard pass holders get in 24 h early, VIP 72 h early (right away).
      publicStartTs: () => new BN(nowTs() + THREE_DAYS),
      vipOnly: false,
      discountEligible: false,
      name: "Listening session",
      uri: "https://mostro.app/metadata/perks/listening-session.json",
   },
   {
      kind: "merch",
      tier: 0,
      priceMost: 1_500,
      burnBps: 8_000,
      rewardsBps: 2_000,
      maxSupply: 100,
      publicStartTs: () => new BN(0),
      vipOnly: false,
      discountEligible: true,
      name: "Numbered tee",
      uri: "https://mostro.app/metadata/perks/numbered-tee.json",
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
      log("split floors", `burn >= ${c.minBurnBps} bps, rewards >= ${c.minRewardsBps} bps`);
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
         minBurnBps: CONFIG_ARGS.minBurnBps,
         minRewardsBps: CONFIG_ARGS.minRewardsBps,
         adminPriceMaxAgeSecs: CONFIG_ARGS.adminPriceMaxAgeSecs,
      })
      .accountsStrict({
         payer: ctx.wallet.publicKey,
         config,
         treasury: treasuryPda(),
         usdcMint,
         treasuryUsdc: treasuryUsdcAta(usdcMint),
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

async function ensureCurve(ctx: Ctx, index: number, usdcMint: PublicKey): Promise<void> {
   section(`Curve #${index}`);
   const curve = curvePda(index);
   const mint = mintPda(index);
   log("curve", curve);
   log("mint", mint);
   log("sol vault", solVaultPda(curve));
   log("rewards vault", rewardsVaultPda(curve));
   log("usdc vault", curveUsdcAta(curve, usdcMint));
   if (await accountExists(ctx.connection, curve)) {
      const c = await ctx.program.account.curve.fetch(curve);
      log("exists", `${c.name} (${c.symbol}), sold ${fmtMost(c.tokensSold)}, complete=${c.complete}`);
      await ensureCurveMetadata(ctx, index);
      return;
   }
   const config = await ctx.program.account.config.fetch(configPda());
   if (config.curveCount !== index) throw new Error(`Cannot create curve #${index}: config.curve_count is ${config.curveCount}`);
   const sig = await ctx.program.methods
      .createCurve({
         name: CURVE_SET_B.name,
         symbol: CURVE_SET_B.symbol,
         uri: CURVE_SET_B.uri,
         virtualSolReserves: CURVE_SET_B.virtualSolReserves,
         virtualTokenReserves: CURVE_SET_B.virtualTokenReserves,
         supplyCap: CURVE_SET_B.supplyCap,
         saleStartTs: CURVE_SET_B.saleStartTs,
      })
      .accountsStrict({
         admin: ctx.wallet.publicKey,
         config: configPda(),
         curve,
         mint,
         solVault: solVaultPda(curve),
         rewardsVault: rewardsVaultPda(curve),
         usdcMint,
         usdcVault: curveUsdcAta(curve, usdcMint),
         tokenProgram: TOKEN_PROGRAM_ID,
         usdcTokenProgram: TOKEN_PROGRAM_ID,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudgetIxs())
      .rpc();
   log("create_curve", explorerTx(sig, ctx.cluster));
   await ensureCurveMetadata(ctx, index);
}

/** Token Metadata for the curve mint. Idempotent: skipped when the metadata account already exists (it can only be created once). */
async function ensureCurveMetadata(ctx: Ctx, index: number): Promise<void> {
   const curve = curvePda(index);
   const mint = mintPda(index);
   const metadata = metadataPda(mint);
   log("token metadata", metadata);
   if (await accountExists(ctx.connection, metadata)) {
      log("metadata exists", "skipping set_curve_metadata");
      return;
   }
   const sig = await ctx.program.methods
      .setCurveMetadata()
      .accountsStrict({
         admin: ctx.wallet.publicKey,
         config: configPda(),
         curve,
         mint,
         metadata,
         tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
         rent: SYSVAR_RENT_PUBKEY,
      })
      .preInstructions(computeBudgetIxs())
      .rpc();
   log("set_curve_metadata", explorerTx(sig, ctx.cluster));
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
      .accountsStrict({
         admin: ctx.wallet.publicKey,
         config: configPda(),
         artist,
         systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudgetIxs())
      .rpc();
   log("create_artist", explorerTx(sig, ctx.cluster));
}

async function ensurePerks(ctx: Ctx, artistIndex: number, curveIndex: number): Promise<void> {
   const artist = artistPda(artistIndex);
   const curve = curvePda(curveIndex);
   const mint = mintPda(curveIndex);
   section(`Perks on artist #${artistIndex}`);
   log("artist vault", artistVaultPda(artist, mint));
   for (let i = 0; i < PERKS.length; i++) {
      const spec = PERKS[i];
      const perk = perkPda(artist, i);
      const collection = collectionPda(perk, COLLECTION_SALT);
      log(`perk #${i}`, `${perk.toBase58()} (${spec.kind}${spec.kind === "pass" ? ` tier ${spec.tier}` : ""}, ${spec.name})`);
      log(`collection #${i}`, `${collection.toBase58()} (salt ${COLLECTION_SALT})`);
      if (await accountExists(ctx.connection, perk)) {
         const p = await ctx.program.account.perk.fetch(perk);
         if (!p.collection.equals(collection)) log(`collection #${i}`, `on-chain ${p.collection.toBase58()} (created with another salt; using it)`);
         const onChainKind = perkKindName(p.kind);
         if (onChainKind !== spec.kind || p.tier !== spec.tier) {
            warn(`perk #${i} exists as ${onChainKind} tier ${p.tier}, expected ${spec.kind} tier ${spec.tier}; leaving it untouched.`);
         } else {
            log(`exists #${i}`, `${p.name}, ${fmtMost(p.price)}, sold ${p.sold}`);
         }
         continue;
      }
      const a = await ctx.program.account.artist.fetch(artist);
      if (a.perkCount !== i) throw new Error(`Cannot create perk #${i}: artist.perk_count is ${a.perkCount}`);
      const config = await ctx.program.account.config.fetch(configPda());
      if (spec.kind === "pass" && !config.admin.equals(ctx.wallet.publicKey)) {
         throw new Error(`Cannot create perk #${i}: Pass perks are admin-only and the CLI wallet is not config.admin (${config.admin.toBase58()}).`);
      }
      if (spec.burnBps < config.minBurnBps || spec.rewardsBps < config.minRewardsBps) {
         throw new Error(`Cannot create perk #${i}: split ${spec.burnBps}/${spec.rewardsBps} is below the config floors ${config.minBurnBps}/${config.minRewardsBps}.`);
      }
      const sig = await ctx.program.methods
         .createPerk({
            kind: perkKindArg(spec.kind),
            tier: spec.tier,
            price: most(spec.priceMost),
            burnBps: spec.burnBps,
            rewardsBps: spec.rewardsBps,
            maxSupply: spec.maxSupply,
            publicStartTs: spec.publicStartTs(),
            vipOnly: spec.vipOnly,
            discountEligible: spec.discountEligible,
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
            artistVault: artistVaultPda(artist, mint),
            mplCoreProgram: MPL_CORE_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
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
   /** Price in $MOST base units (6 decimals), as a decimal string. */
   price: string;
   priceUi: number;
   maxSupply: number;
   publicStartTs: number;
   vipOnly: boolean;
   discountEligible: boolean;
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
   curves: { index: number; curve: string; mint: string; solVault: string; rewardsVault: string; usdcVault: string; name: string; symbol: string; decimals: number }[];
   artists: { index: number; artist: string; authority: string; name: string; vault: string; perks: PerkEntry[] }[];
   passBenefits: { standardDiscountBps: number; vipDiscountBps: number; standardEarlySecs: number; vipEarlySecs: number };
   /** Protocol floors every perk split must meet (`create_perk` / `set_perk` fail with `InvalidBps` below them). */
   splitFloors: { minBurnBps: number; minRewardsBps: number };
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
         curve: curve.toBase58(),
         mint: c.mint.toBase58(),
         solVault: solVaultPda(curve).toBase58(),
         rewardsVault: rewardsVaultPda(curve).toBase58(),
         usdcVault: curveUsdcAta(curve, usdcMint).toBase58(),
         name: c.name,
         symbol: c.symbol,
         decimals: 6,
      });
   }
   const artists: AddressMap["artists"] = [];
   for (let i = 0; i < config.artistCount; i++) {
      const artist = artistPda(i);
      const a = await ctx.program.account.artist.fetch(artist);
      const perks: PerkEntry[] = [];
      let vaultMint: PublicKey | null = null;
      for (let j = 0; j < a.perkCount; j++) {
         const perk = perkPda(artist, j);
         const p = await ctx.program.account.perk.fetch(perk);
         vaultMint = vaultMint ?? p.mint;
         perks.push({
            index: j,
            perk: perk.toBase58(),
            collection: p.collection.toBase58(),
            collectionSalt: COLLECTION_SALT,
            kind: perkKindName(p.kind),
            tier: p.tier,
            name: p.name,
            price: p.price.toString(),
            priceUi: Number(p.price.toString()) / 1e6,
            maxSupply: p.maxSupply,
            publicStartTs: p.publicStartTs.toNumber(),
            vipOnly: p.vipOnly,
            discountEligible: p.discountEligible,
         });
      }
      const mintForVault = vaultMint ?? (curves[0] ? new PublicKey(curves[0].mint) : mintPda(0));
      artists.push({
         index: i,
         artist: artist.toBase58(),
         authority: a.authority.toBase58(),
         name: a.name,
         vault: artistVaultPda(artist, mintForVault).toBase58(),
         perks,
      });
   }
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
      curves,
      artists,
      passBenefits: {
         standardDiscountBps: config.standardDiscountBps,
         vipDiscountBps: config.vipDiscountBps,
         standardEarlySecs: config.standardEarlySecs,
         vipEarlySecs: config.vipEarlySecs,
      },
      splitFloors: { minBurnBps: config.minBurnBps, minRewardsBps: config.minRewardsBps },
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
   if (balance < 0.2e9) warn("Less than 0.2 SOL; seeding needs rent for ~10 accounts plus 5 Core collections.");
   if (!(await accountExists(ctx.connection, PROGRAM_ID))) throw new Error(`Program ${PROGRAM_ID.toBase58()} is not deployed on ${ctx.cluster.name}.`);

   const usdcMint = USDC_MINT_DEVNET;
   if (ctx.cluster.name !== "devnet") warn(`Using the devnet USDC mint ${usdcMint.toBase58()} on ${ctx.cluster.name}; override common.ts if that is wrong.`);

   await ensureConfig(ctx, usdcMint);
   await ensureCurve(ctx, 0, usdcMint);
   await ensureArtist(ctx, 0);
   await ensurePerks(ctx, 0, 0);

   section("Address map");
   const map = await buildAddressMap(ctx, usdcMint);
   const file = writeAddressMap(ctx, map);
   log("written", path.relative(REPO_ROOT, file));
});
