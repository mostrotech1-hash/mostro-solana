/**
 * End-to-end demo from the CLI wallet, printing explorer links for every step:
 *
 *   1. buy 0.1 SOL worth of $MOST on curve #0 (`buy_tokens_sol`, 1 % slippage bound),
 *   2. redeem the MoOG Pass Standard (`redeem_perk` with no pass accounts -> passed as null),
 *   3. redeem the Music perk presenting the pass, so the receipt shows the 5 % Standard discount.
 *
 *   npx ts-node scripts/demo-buy.ts [solToBuy=0.1]
 *
 * Re-running is safe: an already-owned pass is reused instead of buying a second one, and
 * the balance is topped up with `buy_tokens_exact_out_sol` only if it does not cover both perks.
 */
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Mostro } from "../shared/types/mostro";
import {
   Ctx,
   MPL_CORE_PROGRAM_ID,
   TIER_STANDARD,
   applyDiscount,
   artistPda,
   artistVaultPda,
   assetPda,
   ataOf,
   computeBudgetIxs,
   configPda,
   curvePda,
   explorerAddress,
   explorerTx,
   fmtMost,
   fmtSol,
   log,
   optionalKyc,
   perkKindName,
   perkPda,
   quoteBuyExactIn,
   quoteBuyExactOut,
   randomNonce,
   receiptPda,
   rewardsVaultPda,
   run,
   section,
   setup,
   sol,
   solVaultPda,
   splitRedeem,
   toBigInt,
   tokenBalance,
   treasuryPda,
   warn,
   withSlippageDown,
   withSlippageUp,
} from "./common";

const SLIPPAGE_BPS = 100; // 1 %
const CURVE_INDEX = 0;
const ARTIST_INDEX = 0;

type PerkAccount = Awaited<ReturnType<Program<Mostro>["account"]["perk"]["fetch"]>>;

interface PerkRef {
   address: PublicKey;
   data: PerkAccount;
}

async function loadPerks(ctx: Ctx, artist: PublicKey): Promise<PerkRef[]> {
   const a = await ctx.program.account.artist.fetch(artist);
   const out: PerkRef[] = [];
   for (let i = 0; i < a.perkCount; i++) {
      const address = perkPda(artist, i);
      out.push({ address, data: await ctx.program.account.perk.fetch(address) });
   }
   return out;
}

async function buyExactIn(ctx: Ctx, lamportsIn: BN): Promise<bigint> {
   const curve = curvePda(CURVE_INDEX);
   const [config, c] = await Promise.all([ctx.program.account.config.fetch(configPda()), ctx.program.account.curve.fetch(curve)]);
   if (c.complete) throw new Error("Curve is complete (sold out); nothing to buy.");
   const q = quoteBuyExactIn(toBigInt(c.virtualSolReserves), toBigInt(c.virtualTokenReserves), toBigInt(lamportsIn), config.feeBps);
   const minOut = withSlippageDown(q.tokensOut, SLIPPAGE_BPS);
   log("quote", `${fmtSol(lamportsIn)} -> ~${fmtMost(q.tokensOut)} (fee ${fmtSol(q.fee)}), min out ${fmtMost(minOut)}`);
   const sig = await ctx.program.methods
      .buyTokensSol(lamportsIn, new BN(minOut.toString()))
      .accountsStrict({
         // payer == buyer: the wallet covers its own ATA rent. A sponsor (Openfort/Kora) would sign here instead.
         payer: ctx.wallet.publicKey,
         buyer: ctx.wallet.publicKey,
         config: configPda(),
         curve,
         mint: c.mint,
         solVault: solVaultPda(curve),
         treasury: treasuryPda(),
         buyerAta: ataOf(ctx.wallet.publicKey, c.mint),
         kyc: await optionalKyc(ctx.connection, ctx.wallet.publicKey),
         tokenProgram: TOKEN_PROGRAM_ID,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudgetIxs())
      .rpc();
   log("buy_tokens_sol", explorerTx(sig, ctx.cluster));
   return q.tokensOut;
}

async function buyExactOut(ctx: Ctx, tokensOut: bigint): Promise<void> {
   const curve = curvePda(CURVE_INDEX);
   const [config, c] = await Promise.all([ctx.program.account.config.fetch(configPda()), ctx.program.account.curve.fetch(curve)]);
   const q = quoteBuyExactOut(toBigInt(c.virtualSolReserves), toBigInt(c.virtualTokenReserves), tokensOut, config.feeBps);
   const maxIn = withSlippageUp(q.netIn + q.fee, SLIPPAGE_BPS);
   log("top-up quote", `${fmtMost(tokensOut)} for ~${fmtSol(q.netIn + q.fee)}, max in ${fmtSol(maxIn)}`);
   const sig = await ctx.program.methods
      .buyTokensExactOutSol(new BN(tokensOut.toString()), new BN(maxIn.toString()))
      .accountsStrict({
         payer: ctx.wallet.publicKey,
         buyer: ctx.wallet.publicKey,
         config: configPda(),
         curve,
         mint: c.mint,
         solVault: solVaultPda(curve),
         treasury: treasuryPda(),
         buyerAta: ataOf(ctx.wallet.publicKey, c.mint),
         kyc: await optionalKyc(ctx.connection, ctx.wallet.publicKey),
         tokenProgram: TOKEN_PROGRAM_ID,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudgetIxs())
      .rpc();
   log("buy_tokens_exact_out_sol", explorerTx(sig, ctx.cluster));
}

/** Finds a pass asset minted from `passPerk` that the buyer still owns, via this program's receipts. */
async function findOwnedPass(ctx: Ctx, buyer: PublicKey, passPerk: PublicKey): Promise<PublicKey | null> {
   // Receipt layout: 8 discriminator, bump u8, version u8, buyer @10, perk @42.
   const receipts = await ctx.program.account.receipt.all([{ memcmp: { offset: 10, bytes: buyer.toBase58() } }, { memcmp: { offset: 42, bytes: passPerk.toBase58() } }]);
   for (const r of receipts) {
      try {
         const asset = await ctx.program.account.baseAssetV1.fetch(r.account.asset);
         if (asset.owner.equals(buyer)) return r.account.asset;
      } catch {
         // Asset burned or not decodable; keep looking.
      }
   }
   return null;
}

interface RedeemResult {
   sig: string;
   asset: PublicKey;
   receipt: PublicKey;
}

/**
 * `expectedPaid` is the effective price after the pass discount; it goes in as `max_paid` so a `set_perk` price
 * bump between quote and confirmation fails with SlippageExceeded instead of overcharging. No margin: the price is deterministic.
 */
async function redeem(ctx: Ctx, artist: PublicKey, perk: PerkRef, pass: { asset: PublicKey; perk: PublicKey } | null, expectedPaid: bigint): Promise<RedeemResult> {
   const curve = curvePda(CURVE_INDEX);
   const mint = perk.data.mint;
   const nonce = randomNonce();
   const asset = assetPda(perk.address, nonce);
   const receipt = receiptPda(asset);
   const sig = await ctx.program.methods
      .redeemPerk(nonce, new BN(expectedPaid.toString()))
      .accountsStrict({
         // payer pays the receipt + asset rent and the Core protocol fee; here it is the buyer itself.
         payer: ctx.wallet.publicKey,
         buyer: ctx.wallet.publicKey,
         config: configPda(),
         artist,
         perk: perk.address,
         curve,
         mint,
         buyerAta: ataOf(ctx.wallet.publicKey, mint),
         rewardsVault: rewardsVaultPda(curve),
         artistVault: artistVaultPda(artist, mint),
         collection: perk.data.collection,
         asset,
         receipt,
         // Optional accounts: Anchor encodes `null` as the program id, which the program reads as `None`.
         passAsset: pass ? pass.asset : null,
         passPerk: pass ? pass.perk : null,
         mplCoreProgram: MPL_CORE_PROGRAM_ID,
         tokenProgram: TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudgetIxs())
      .rpc();
   return { sig, asset, receipt };
}

async function printReceipt(ctx: Ctx, r: RedeemResult): Promise<void> {
   const rec = await ctx.program.account.receipt.fetch(r.receipt);
   log("tx", explorerTx(r.sig, ctx.cluster));
   log("asset", explorerAddress(r.asset, ctx.cluster));
   log("receipt", r.receipt);
   log("edition", `#${rec.edition}`);
   log("paid", fmtMost(rec.paid));
   log("discount", `${rec.discountBps / 100} %`);
   log("burned", fmtMost(rec.burned));
   log("to rewards", fmtMost(rec.toRewards));
   log("to artist", fmtMost(rec.toArtist));
   log("pass used", rec.passUsed.equals(PublicKey.default) ? "none" : rec.passUsed.toBase58());
}

run(async () => {
   const [solArg = "0.1"] = process.argv.slice(2);
   const lamportsIn = sol(solArg);

   const ctx = setup();
   const buyer = ctx.wallet.publicKey;
   section("Environment");
   log("cluster", `${ctx.cluster.name} (${ctx.cluster.rpc})`);
   log("buyer (CLI wallet)", buyer);
   const balance = await ctx.connection.getBalance(buyer);
   log("SOL balance", fmtSol(balance));
   if (balance < toBigInt(lamportsIn) + 50_000_000n) warn("Low SOL: the demo needs the buy amount plus ~0.02 SOL of rent for the Core assets and receipts.");

   const config = await ctx.program.account.config.fetch(configPda());
   if (config.paused) throw new Error("Protocol is paused.");
   const curveAddr = curvePda(CURVE_INDEX);
   const curve = await ctx.program.account.curve.fetch(curveAddr);
   const mint = curve.mint;
   const buyerAta = ataOf(buyer, mint);
   log("curve", curveAddr);
   log("$MOST mint", mint);
   log("buyer ATA", buyerAta);

   const artist = artistPda(ARTIST_INDEX);
   const perks = await loadPerks(ctx, artist);
   const passPerk = perks.find((p) => perkKindName(p.data.kind) === "pass" && p.data.tier === TIER_STANDARD);
   const musicPerk = perks.find((p) => perkKindName(p.data.kind) === "music");
   if (!passPerk) throw new Error("No Standard pass perk on artist #0. Run scripts/seed-devnet.ts first.");
   if (!musicPerk) throw new Error("No Music perk on artist #0. Run scripts/seed-devnet.ts first.");
   log("pass perk", `${passPerk.address.toBase58()} (${passPerk.data.name}, ${fmtMost(passPerk.data.price)})`);
   log("music perk", `${musicPerk.address.toBase58()} (${musicPerk.data.name}, ${fmtMost(musicPerk.data.price)})`);

   // 1. Buy $MOST.
   section(`1. Buy ${fmtSol(lamportsIn)} of $MOST`);
   await buyExactIn(ctx, lamportsIn);
   let most = await tokenBalance(ctx.connection, buyerAta);
   log("$MOST balance", fmtMost(most));

   // 2. Pass: reuse one the wallet already owns, otherwise redeem it.
   section("2. MoOG Pass Standard");
   let passAsset = await findOwnedPass(ctx, buyer, passPerk.address);
   const passPrice = toBigInt(passPerk.data.price);
   const musicDiscounted = musicPerk.data.discountEligible ? applyDiscount(toBigInt(musicPerk.data.price), config.standardDiscountBps) : toBigInt(musicPerk.data.price);
   const needed = (passAsset ? 0n : passPrice) + musicDiscounted;
   if (most < needed) {
      warn(`Balance ${fmtMost(most)} does not cover ${fmtMost(needed)}; topping up.`);
      await buyExactOut(ctx, needed - most);
      most = await tokenBalance(ctx.connection, buyerAta);
      log("$MOST balance", fmtMost(most));
   }
   if (passAsset) {
      log("already owned", explorerAddress(passAsset, ctx.cluster));
   } else {
      const split = splitRedeem(passPrice, passPerk.data.burnBps, passPerk.data.rewardsBps);
      log("expected", `pay ${fmtMost(passPrice)}: burn ${fmtMost(split.burned)}, rewards ${fmtMost(split.toRewards)}, artist ${fmtMost(split.toArtist)}`);
      const res = await redeem(ctx, artist, passPerk, null, passPrice);
      await printReceipt(ctx, res);
      passAsset = res.asset;
   }

   // 3. Music perk with the pass -> discount.
   section(`3. ${musicPerk.data.name} with the pass`);
   const expectedDiscount = musicPerk.data.discountEligible ? config.standardDiscountBps : 0;
   log("expected", `${fmtMost(musicPerk.data.price)} - ${expectedDiscount / 100} % = ${fmtMost(musicDiscounted)}`);
   if (!passPerk.data.active) throw new Error("The Standard pass tier is inactive; the program would reject the pass (PerkInactive).");
   const res = await redeem(ctx, artist, musicPerk, { asset: passAsset, perk: passPerk.address }, musicDiscounted);
   await printReceipt(ctx, res);

   section("Done");
   log("$MOST balance", fmtMost(await tokenBalance(ctx.connection, buyerAta)));
   const after = await ctx.program.account.curve.fetch(curveAddr);
   log("curve sold", fmtMost(after.tokensSold));
   log("curve burned", fmtMost(after.totalBurned));
   log("rewards accrued", fmtMost(after.rewardsAccrued));
   log("pass asset", explorerAddress(passAsset, ctx.cluster));
   log("music asset", explorerAddress(res.asset, ctx.cluster));
});
