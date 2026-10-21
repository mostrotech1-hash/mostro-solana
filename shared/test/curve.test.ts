import { expect } from "chai";
import BN from "bn.js";
import {
   quoteBuyExactIn,
   quoteBuyExactOut,
   spotPriceE9,
   quoteToComplete,
   splitRedeem,
   hybridHalves,
   quoteHybridPerk,
   minOut,
   maxIn,
   marketCap,
   progressToGraduationBps,
   quoteRemainingToComplete,
   remainingSupply,
   applyBuy,
   CurveMathError,
   U64_MAX,
} from "../src/curve";
import { scaleToE6, usdE6ToLamports, lamportsToUsdE6, decodePriceUpdateV2, solUsdFromConfig, PriceError } from "../src/price";
import { assetPda, receiptPda, u64Le, u32Le, configPda, curvePda, mintPda, blacklistPda, memberPda, proposalPda, approvalPda, spendPda, deriveCurveAddresses } from "../src/pda";
import { MOSTRO_ERRORS_BY_CODE, parseMostroError, MostroErrorCode, ERROR_COPY } from "../src/errors";
import { PublicKey } from "@solana/web3.js";
import { ARTIST_ALLOCATION, CURVE_ALLOCATION, DEMO_CURVE_PARAMS, DEX_ALLOCATION, MOSTRO_ALLOCATION, PROGRAM_ID, PYTH_SOL_USD_FEED_ID, TOTAL_SUPPLY } from "../src/constants";
import { meetsThreshold, weightNeeded, remainingSpend, proposalStatus, redeemEligibility, curveEligibility, checkPerkPrice, perkPayment } from "../src/accounts";

// Demo params: 30 SOL virtual quote, 379,000,000 tokens virtual, cap = the fixed 280M curve allocation.
const VQ0 = new BN(DEMO_CURVE_PARAMS.virtualSolReserves);
const VT0 = new BN(DEMO_CURVE_PARAMS.virtualTokenReserves);
const CAP = new BN(CURVE_ALLOCATION);
const FEE = DEMO_CURVE_PARAMS.feeBps;

function expectCurveError(fn: () => unknown, code: string) {
   try {
      fn();
   } catch (e) {
      expect(e).to.be.instanceOf(CurveMathError);
      expect((e as CurveMathError).code).to.equal(code);
      return;
   }
   expect.fail(`expected CurveMathError ${code}`);
}

describe("constants mirror state.rs", () => {
   it("allocations add up to the fixed supply", () => {
      const sum = new BN(CURVE_ALLOCATION).add(new BN(DEX_ALLOCATION)).add(new BN(MOSTRO_ALLOCATION)).add(new BN(ARTIST_ALLOCATION));
      expect(sum.toString()).to.equal(TOTAL_SUPPLY);
      expect(TOTAL_SUPPLY).to.equal("1000000000000000");
   });
});

describe("curve.ts mirrors curve.rs", () => {
   it("genesis buy matches the pump-sdk formula (0.1 SOL)", () => {
      const q = quoteBuyExactIn(VQ0, VT0, 100_000_000, FEE);
      expect(q.netIn.toString()).to.equal("99009900");
      expect(q.fee.toString()).to.equal("990100");
      const expected = new BN("99009900").mul(VT0).div(VQ0.add(new BN("99009900")));
      expect(q.tokensOut.eq(expected)).to.equal(true);
      // ~1,246,217 whole tokens
      expect(q.tokensOut.gt(new BN("1246000000000"))).to.equal(true);
      expect(q.tokensOut.lt(new BN("1247000000000"))).to.equal(true);
      expect(q.totalIn.toString()).to.equal("100000000");
   });

   it("exact-out costs at least exact-in for the same tokens", () => {
      const q = quoteBuyExactIn(VQ0, VT0, 1_000_000_000, FEE);
      const eo = quoteBuyExactOut(VQ0, VT0, q.tokensOut, FEE);
      expect(eo.totalIn.gte(q.netIn)).to.equal(true);
      expect(eo.totalIn.lte(q.netIn.add(q.fee).addn(2))).to.equal(true);
      expect(eo.tokensOut.eq(q.tokensOut)).to.equal(true);
   });

   it("price is monotonic and the curve state applies like on-chain", () => {
      let curve = { virtualSolReserves: VQ0, virtualTokenReserves: VT0, supplyCap: CAP, tokensSold: new BN(0), realSolReserves: new BN(0) };
      let last = new BN(0);
      for (let i = 0; i < 20; i++) {
         const b = quoteBuyExactIn(curve.virtualSolReserves, curve.virtualTokenReserves, 1_000_000_000, FEE);
         curve = applyBuy(curve, b);
         const p = spotPriceE9(curve.virtualSolReserves, curve.virtualTokenReserves);
         expect(p.gt(last)).to.equal(true);
         last = p;
      }
      expect(curve.realSolReserves.eq(curve.virtualSolReserves.sub(VQ0))).to.equal(true);
      expect(remainingSupply(curve).eq(CAP.sub(curve.tokensSold))).to.equal(true);
   });

   it("graduation is derived: ~84.85 SOL for the demo params", () => {
      const needed = quoteToComplete(VQ0, VT0, CAP);
      // 30 * 379 / 99 - 30 SOL
      expect(needed.gt(new BN("84000000000")) && needed.lt(new BN("85000000000"))).to.equal(true);
      expectCurveError(() => quoteToComplete(VQ0, VT0, VT0), "InvalidCurveParams");
      const fromGenesis = quoteRemainingToComplete({ virtualSolReserves: VQ0, virtualTokenReserves: VT0, supplyCap: CAP, tokensSold: 0 });
      // exact-out adds +1 lamport on top of the closed form
      expect(fromGenesis.sub(needed).abs().lten(1)).to.equal(true);
   });

   it("exact-out rejects zero and >= virtual", () => {
      expectCurveError(() => quoteBuyExactOut(VQ0, VT0, VT0, FEE), "CurveSoldOut");
      expectCurveError(() => quoteBuyExactOut(VQ0, VT0, 0, FEE), "InvalidAmount");
   });

   it("overflow is an error, not a crash; u64::MAX inputs behave like Rust", () => {
      expect(() => quoteBuyExactIn(U64_MAX, U64_MAX, U64_MAX, FEE)).to.not.throw();
      expect(() => spotPriceE9(U64_MAX, 1)).to.not.throw();
      // A result that does not fit u64 is MathOverflow: cost = 1 * (2^64-1) / 1 + 1 = 2^64.
      expectCurveError(() => quoteBuyExactOut(U64_MAX, 2, 1, 0), "MathOverflow");
   });

   it("the redeem split is fixed at 80 / 20 and always adds up", () => {
      const s = splitRedeem(1_000_000_000);
      expect(s.burn.toString()).to.equal("800000000");
      expect(s.rewards.toString()).to.equal("200000000");
      expect(splitRedeem(1).burn.toNumber()).to.equal(0);
      expect(splitRedeem(1).rewards.toNumber()).to.equal(1);
      const big = splitRedeem(U64_MAX);
      expect(big.burn.add(big.rewards).eq(U64_MAX)).to.equal(true);
   });

   it("hybrid perk: half curve, half artist, tokens from both vaults burned 80/20", () => {
      expect(hybridHalves(2_000_000_000)).to.deep.equal({ curveHalf: new BN(1_000_000_000), artistHalf: new BN(1_000_000_000) });
      expect(hybridHalves(3).artistHalf.toNumber()).to.equal(2);
      const q = quoteHybridPerk({ virtualSolReserves: VQ0, virtualTokenReserves: VT0 }, 200_000_000, FEE);
      const leg = quoteBuyExactIn(VQ0, VT0, 100_000_000, FEE);
      expect(q.curveHalf.toNumber()).to.equal(100_000_000);
      expect(q.artistHalf.toNumber()).to.equal(100_000_000);
      expect(q.curveLeg.netIn.eq(leg.netIn)).to.equal(true);
      expect(q.tokensFromCurve.eq(leg.tokensOut)).to.equal(true);
      expect(q.tokensFromArtist.eq(leg.tokensOut)).to.equal(true);
      const per = splitRedeem(leg.tokensOut);
      expect(q.burned.eq(per.burn.muln(2))).to.equal(true);
      expect(q.toRewards.eq(per.rewards.muln(2))).to.equal(true);
      expect(q.burned.add(q.toRewards).eq(leg.tokensOut.muln(2))).to.equal(true);
   });

   it("small amounts fail cleanly", () => {
      expectCurveError(() => quoteBuyExactIn(VQ0, VT0, 1, FEE), "InvalidAmount");
      expectCurveError(() => quoteBuyExactIn(VQ0, VT0, 0, FEE), "InvalidAmount");
   });

   it("fees round up, tokens round down", () => {
      const eo = quoteBuyExactOut(VQ0, VT0, 1_000_000, FEE);
      const expectedCost = new BN(1_000_000)
         .mul(VQ0)
         .div(VT0.sub(new BN(1_000_000)))
         .addn(1);
      expect(eo.netIn.eq(expectedCost)).to.equal(true);
      const feeNum = expectedCost.muln(FEE);
      const ceil = feeNum.add(new BN(9_999)).div(new BN(10_000));
      expect(eo.fee.eq(ceil)).to.equal(true);
   });

   it("slippage helpers", () => {
      expect(minOut(1_000_000, 100).toString()).to.equal("990000");
      expect(maxIn(1_000_000, 100).toString()).to.equal("1010000");
      expect(maxIn(999, 100).toString()).to.equal("1009"); // ceil(1008.99)
   });

   it("market cap and graduation progress", () => {
      const curve = { virtualSolReserves: VQ0, virtualTokenReserves: VT0, supplyCap: CAP, tokensSold: CAP.divn(2) };
      expect(progressToGraduationBps(curve)).to.equal(5000);
      // spotPriceE9 floors to 79,155 (lamports per base unit, e9); times the full 1B supply / 1e9 = 79,155,000,000 lamports
      expect(marketCap(curve, TOTAL_SUPPLY).toString()).to.equal("79155000000");
   });
});

describe("price.ts mirrors pricing.rs", () => {
   it("pyth scaling", () => {
      expect(scaleToE6(new BN("11217309341"), -8).toString()).to.equal("112173093");
      expect(scaleToE6(112, 0).toString()).to.equal("112000000");
      expect(scaleToE6(1, -6).toString()).to.equal("1");
   });

   it("usd <-> lamports roundtrip", () => {
      const price = 112_173_093;
      const lamports = usdE6ToLamports(1_000_000, price);
      expect(lamports.toString()).to.equal("8914793");
      const back = lamportsToUsdE6(lamports, price);
      expect(back.gten(999_999) && back.lten(1_000_000)).to.equal(true);
      expect(() => usdE6ToLamports(1, 0)).to.throw(PriceError);
   });

   it("decodes a synthetic PriceUpdateV2 and resolves config modes", () => {
      const buf = Buffer.alloc(134);
      buf[40] = 1;
      Buffer.from(PYTH_SOL_USD_FEED_ID).copy(buf, 41);
      buf.writeBigInt64LE(BigInt("11217309341"), 73);
      buf.writeBigUInt64LE(BigInt(5_000_000), 81);
      buf.writeInt32LE(-8, 89);
      const now = 1_750_000_000;
      buf.writeBigInt64LE(BigInt(now - 10), 93);
      const u = decodePriceUpdateV2(buf);
      expect(u.price.toString()).to.equal("11217309341");
      expect(u.expo).to.equal(-8);
      expect(u.publishTime.toNumber()).to.equal(now - 10);
      expect(u.feedIdHex).to.equal(Buffer.from(PYTH_SOL_USD_FEED_ID).toString("hex"));

      const cfg = { priceMode: 1, solUsdPriceE6: new BN(0), pythFeedId: Array.from(PYTH_SOL_USD_FEED_ID), maxPriceAgeSecs: 60 };
      expect(solUsdFromConfig(cfg, buf, now).priceE6.toString()).to.equal("112173093");
      expect(() => solUsdFromConfig(cfg, buf, now + 1000))
         .to.throw(PriceError)
         .with.property("code", "PriceTooOld");
      expect(() => solUsdFromConfig({ ...cfg, pythFeedId: new Array(32).fill(0) }, buf, now))
         .to.throw(PriceError)
         .with.property("code", "PriceFeedMismatch");
      const admin = { priceMode: 0, solUsdPriceE6: new BN(112_000_000), pythFeedId: Array.from(PYTH_SOL_USD_FEED_ID), maxPriceAgeSecs: 60 };
      expect(solUsdFromConfig(admin, undefined, now).priceE6.toString()).to.equal("112000000");
   });
});

describe("pda.ts", () => {
   it("derives every seed exactly like the program", () => {
      const perk = PublicKey.unique();
      const nonce = new BN("18446744073709551615");
      expect(
         assetPda(perk, nonce)[0].equals(PublicKey.findProgramAddressSync([Buffer.from("asset"), perk.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0]),
      ).to.equal(true);
      expect(receiptPda(perk)[0].equals(PublicKey.findProgramAddressSync([Buffer.from("receipt"), perk.toBuffer()], PROGRAM_ID)[0])).to.equal(true);
      expect(u64Le(1).toString("hex")).to.equal("0100000000000000");
      expect(u32Le(258).toString("hex")).to.equal("02010000");
      expect(() => u64Le(new BN(2).pow(new BN(64)))).to.throw(RangeError);
      expect(configPda()[0].toBase58()).to.equal("DkvJHPjVai7sSTyU4v2WPM5roYWNguDMw4mmHGmWkUun");
      expect(curvePda(0)[0].toBase58()).to.equal("EBes4GAtgZf9zHy2hwG8AmN8AQE9UmgtMyGQct21tpKR");
      expect(mintPda(0)[0].toBase58()).to.equal("Cv1BGNwGaGGoBsqb2WoYEPiaSN38XBJhY92xvteF4wmW");
      const wallet = PublicKey.unique();
      expect(blacklistPda(wallet)[0].equals(PublicKey.findProgramAddressSync([Buffer.from("blacklist"), wallet.toBuffer()], PROGRAM_ID)[0])).to.equal(true);
      expect(memberPda(wallet)[0].equals(PublicKey.findProgramAddressSync([Buffer.from("member"), wallet.toBuffer()], PROGRAM_ID)[0])).to.equal(true);
      const proposal = proposalPda(3)[0];
      expect(proposal.equals(PublicKey.findProgramAddressSync([Buffer.from("proposal"), u64Le(3)], PROGRAM_ID)[0])).to.equal(true);
      expect(approvalPda(proposal, wallet)[0].equals(PublicKey.findProgramAddressSync([Buffer.from("approval"), proposal.toBuffer(), wallet.toBuffer()], PROGRAM_ID)[0])).to.equal(
         true,
      );
      const curve = curvePda(0)[0];
      expect(spendPda(curve, wallet)[0].equals(PublicKey.findProgramAddressSync([Buffer.from("spend"), curve.toBuffer(), wallet.toBuffer()], PROGRAM_ID)[0])).to.equal(true);
      const a = deriveCurveAddresses(0);
      for (const [seed, key] of [
         ["curve_vault", a.curveVault],
         ["artist_reserve", a.artistReserve],
         ["mostro_reserve", a.mostroReserve],
         ["dex_reserve", a.dexReserve],
         ["sol_vault", a.solVault],
         ["rewards", a.rewardsVault],
      ] as const) {
         expect(key.equals(PublicKey.findProgramAddressSync([Buffer.from(seed), curve.toBuffer()], PROGRAM_ID)[0]), seed).to.equal(true);
      }
   });
});

describe("errors.ts", () => {
   it("loads the table from the IDL and parses Anchor / raw / log errors", () => {
      expect(MOSTRO_ERRORS_BY_CODE.get(6000)?.name).to.equal("BuysPaused");
      expect(MostroErrorCode.SlippageExceeded).to.equal(6006);
      expect(MostroErrorCode.Blacklisted).to.equal(6028);
      expect(MostroErrorCode.ThresholdNotMet).to.equal(6040);
      // every program error has UI copy
      for (const e of MOSTRO_ERRORS_BY_CODE.values()) expect(ERROR_COPY[e.name], e.name).to.be.a("string");
      const anchorErr = { error: { errorCode: { code: "SlippageExceeded", number: 6006 } } };
      expect(parseMostroError(anchorErr)?.name).to.equal("SlippageExceeded");
      const raw = { message: "failed: custom program error: 0x177c" }; // 6012
      expect(parseMostroError(raw)?.name).to.equal("InvalidBps");
      const logs = { logs: ["Program log: AnchorError occurred. Error Code: Blacklisted. Error Number: 6028. Error Message: Wallet is blacklisted."] };
      expect(parseMostroError(logs)?.code).to.equal(6028);
      expect(parseMostroError({ message: "User rejected the request" })?.name).to.equal("UserRejected");
      expect(parseMostroError(null)).to.equal(null);
   });
});

describe("accounts.ts helpers", () => {
   it("threshold is strictly above 51 % of the live weight", () => {
      expect(meetsThreshold(7, 15)).to.equal(false);
      expect(meetsThreshold(8, 15)).to.equal(true);
      expect(meetsThreshold(2, 2)).to.equal(true);
      expect(meetsThreshold(2, 3)).to.equal(true);
      expect(meetsThreshold(1, 3)).to.equal(false);
      expect(meetsThreshold(2, 4)).to.equal(false);
      expect(meetsThreshold(51, 100)).to.equal(false);
      expect(weightNeeded(15)).to.equal(8);
      expect(weightNeeded(4)).to.equal(3);
      expect(weightNeeded(2)).to.equal(2);
   });

   it("spend cap, proposal status, eligibility, perk payment", () => {
      const now = 1_750_000_000;
      const period = Math.floor(now / (30 * 86_400));
      expect(remainingSpend({ maxSpendPerPeriodLamports: new BN(0) }, null, now)).to.equal(null);
      expect(remainingSpend({ maxSpendPerPeriodLamports: new BN(10) }, null, now)?.toNumber()).to.equal(10);
      expect(remainingSpend({ maxSpendPerPeriodLamports: new BN(10) }, { period: new BN(period), spentLamports: new BN(4) }, now)?.toNumber()).to.equal(6);
      expect(remainingSpend({ maxSpendPerPeriodLamports: new BN(10) }, { period: new BN(period - 1), spentLamports: new BN(9) }, now)?.toNumber()).to.equal(10);
      expect(remainingSpend({ maxSpendPerPeriodLamports: new BN(10) }, { period: new BN(period), spentLamports: new BN(12) }, now)?.toNumber()).to.equal(0);

      const open = { executed: false, cancelled: false, expiresTs: new BN(now + 10) };
      expect(proposalStatus(open, now)).to.equal("open");
      expect(proposalStatus({ ...open, executed: true }, now)).to.equal("executed");
      expect(proposalStatus({ ...open, cancelled: true }, now)).to.equal("cancelled");
      expect(proposalStatus(open, now + 11)).to.equal("expired");

      expect(checkPerkPrice(1, 0)).to.equal(true);
      expect(checkPerkPrice(0, 1)).to.equal(true);
      expect(checkPerkPrice(1, 1)).to.equal(false);
      expect(checkPerkPrice(0, 0)).to.equal(false);
      expect(perkPayment({ priceTokens: new BN(1), priceLamports: new BN(0) })).to.equal("tokens");
      expect(perkPayment({ priceTokens: new BN(0), priceLamports: new BN(1) })).to.equal("sol");

      const config = { redeemsPaused: false, buysPaused: false };
      const perk = { active: true, maxSupply: 0, sold: 0, publicStartTs: new BN(now - 1), priceTokens: new BN(1), priceLamports: new BN(0) };
      expect(redeemEligibility(config, perk, true, false, null, now).ok).to.equal(true);
      expect(redeemEligibility({ ...config, redeemsPaused: true }, perk, true, false, null, now).reason).to.equal("RedeemsPaused");
      expect(redeemEligibility(config, perk, true, true, null, now).reason).to.equal("Blacklisted");
      expect(redeemEligibility(config, { ...perk, maxSupply: 1, sold: 1 }, true, false, null, now).reason).to.equal("PerkSoldOut");
      expect(redeemEligibility(config, { ...perk, publicStartTs: new BN(now + 5) }, true, false, null, now).reason).to.equal("SaleNotStarted");
      const hybrid = { ...perk, priceTokens: new BN(0), priceLamports: new BN(1) };
      expect(redeemEligibility({ ...config, buysPaused: true }, hybrid, true, false, null, now).reason).to.equal("BuysPaused");
      const curve = { complete: false, saleStartTs: new BN(now + 100) };
      expect(redeemEligibility(config, hybrid, true, false, curve, now).reason).to.equal("SaleNotStarted");
      expect(redeemEligibility(config, perk, true, false, curve, now).ok).to.equal(true); // token perks ignore the curve
      expect(curveEligibility(config, { ...curve, saleStartTs: new BN(0) }, false, now).ok).to.equal(true);
      expect(curveEligibility(config, { complete: true, saleStartTs: new BN(0) }, false, now).reason).to.equal("CurveComplete");
   });
});
