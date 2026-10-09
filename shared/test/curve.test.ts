import { expect } from "chai";
import BN from "bn.js";
import {
   quoteBuyExactIn,
   quoteBuyExactOut,
   quoteSell,
   spotPriceE9,
   quoteToComplete,
   splitRedeem,
   applyDiscount,
   minOut,
   maxIn,
   marketCap,
   progressToGraduationBps,
   quoteRemainingToComplete,
   CurveMathError,
   U64_MAX,
} from "../src/curve";
import { scaleToE6, usdE6ToLamports, lamportsToUsdE6, decodePriceUpdateV2, solUsdFromConfig, PriceError } from "../src/price";
import { assetPda, receiptPda, u64Le, u32Le, configPda, curvePda, mintPda } from "../src/pda";
import { MOSTRO_ERRORS_BY_CODE, parseMostroError, MostroErrorCode } from "../src/errors";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, PYTH_SOL_USD_FEED_ID } from "../src/constants";

// Demo "set B": 30 SOL virtual quote, 1,000,000 tokens (6 dp) virtual, cap 800,000.
const VQ0 = new BN("30000000000");
const VT0 = new BN("1000000000000");
const CAP = new BN("800000000000");
const FEE = 100;

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

describe("curve.ts mirrors curve.rs", () => {
   it("genesis buy matches the pump-sdk formula (0.1 SOL)", () => {
      const q = quoteBuyExactIn(VQ0, VT0, 100_000_000, FEE);
      expect(q.netIn.toString()).to.equal("99009900");
      expect(q.fee.toString()).to.equal("990100");
      const expected = new BN("99009900").mul(VT0).div(VQ0.add(new BN("99009900")));
      expect(q.tokensOut.eq(expected)).to.equal(true);
      expect(q.tokensOut.gt(new BN("3289000000"))).to.equal(true);
      expect(q.tokensOut.lt(new BN("3291000000"))).to.equal(true);
      expect(q.totalIn.toString()).to.equal("100000000");
   });

   it("exact-out costs at least exact-in for the same tokens", () => {
      const q = quoteBuyExactIn(VQ0, VT0, 1_000_000_000, FEE);
      const eo = quoteBuyExactOut(VQ0, VT0, q.tokensOut, FEE);
      expect(eo.totalIn.gte(q.netIn)).to.equal(true);
      expect(eo.totalIn.lte(q.netIn.add(q.fee).addn(2))).to.equal(true);
      expect(eo.tokensOut.eq(q.tokensOut)).to.equal(true);
   });

   it("buy then sell never profits and reserves return to genesis", () => {
      let vq = VQ0;
      let vt = VT0;
      for (const lamports of [10_000_000, 500_000_000, 5_000_000_000]) {
         const b = quoteBuyExactIn(vq, vt, lamports, FEE);
         vq = vq.add(b.netIn);
         vt = vt.sub(b.tokensOut);
         const s = quoteSell(vq, vt, b.tokensOut, FEE);
         expect(s.netOut.lt(new BN(lamports))).to.equal(true);
         vq = vq.sub(s.grossOut);
         vt = vt.add(b.tokensOut);
      }
      expect(vq.lte(VQ0.addn(3))).to.equal(true);
      expect(vt.eq(VT0)).to.equal(true);
   });

   it("price is monotonic", () => {
      let vq = VQ0;
      let vt = VT0;
      let last = new BN(0);
      for (let i = 0; i < 20; i++) {
         const b = quoteBuyExactIn(vq, vt, 1_000_000_000, FEE);
         vq = vq.add(b.netIn);
         vt = vt.sub(b.tokensOut);
         const p = spotPriceE9(vq, vt);
         expect(p.gt(last)).to.equal(true);
         last = p;
      }
   });

   it("graduation is derived: 120 SOL for set B", () => {
      expect(quoteToComplete(VQ0, VT0, CAP).toString()).to.equal("120000000000");
      expectCurveError(() => quoteToComplete(VQ0, VT0, VT0), "InvalidCurveParams");
      const fromGenesis = quoteRemainingToComplete({ virtualSolReserves: VQ0, virtualTokenReserves: VT0, supplyCap: CAP, tokensSold: 0 });
      // exact-out adds +1 lamport on top of the closed form
      expect(fromGenesis.sub(new BN("120000000000")).abs().lten(1)).to.equal(true);
   });

   it("exact-out rejects zero and >= virtual", () => {
      expectCurveError(() => quoteBuyExactOut(VQ0, VT0, VT0, FEE), "CurveSoldOut");
      expectCurveError(() => quoteBuyExactOut(VQ0, VT0, 0, FEE), "InvalidAmount");
   });

   it("overflow is an error, not a crash; u64::MAX inputs behave like Rust", () => {
      expect(() => quoteBuyExactIn(U64_MAX, U64_MAX, U64_MAX, FEE)).to.not.throw();
      expect(() => spotPriceE9(U64_MAX, 1)).to.not.throw();
      expect(() => quoteSell(U64_MAX, U64_MAX, U64_MAX, 0)).to.not.throw();
      // A result that does not fit u64 is MathOverflow: cost = 1 * (2^64-1) / 1 + 1 = 2^64.
      expectCurveError(() => quoteBuyExactOut(U64_MAX, 2, 1, 0), "MathOverflow");
   });

   it("split and discount", () => {
      const s = splitRedeem(1_200_000_000, 8000, 2000);
      expect(s.burn.toString()).to.equal("960000000");
      expect(s.rewards.toString()).to.equal("240000000");
      expect(s.artist.toString()).to.equal("0");
      const s2 = splitRedeem(1_000, 5000, 2500);
      expect([s2.burn.toNumber(), s2.rewards.toNumber(), s2.artist.toNumber()]).to.deep.equal([500, 250, 250]);
      expectCurveError(() => splitRedeem(1_000, 8000, 3000), "InvalidBps");
      expect(applyDiscount(1_000_000, 500).toString()).to.equal("950000");
      expect(applyDiscount(1_000_000, 1500).toString()).to.equal("850000");
      expect(applyDiscount(1_000_000, 0).toString()).to.equal("1000000");
      expectCurveError(() => applyDiscount(1_000_000, 10_001), "InvalidBps");
      // Product prices: Standard 1,200 $MOST, VIP 3,750 $MOST; 5% / 15% pass discounts.
      expect(applyDiscount(1_200_000_000, 500).toString()).to.equal("1140000000");
      expect(applyDiscount(3_750_000_000, 1500).toString()).to.equal("3187500000");
   });

   it("small amounts fail cleanly", () => {
      expectCurveError(() => quoteBuyExactIn(VQ0, VT0, 1, FEE), "InvalidAmount");
      expectCurveError(() => quoteBuyExactIn(VQ0, VT0, 0, FEE), "InvalidAmount");
      expectCurveError(() => quoteSell(VQ0, VT0, 0, FEE), "InvalidAmount");
   });

   it("fees round up, tokens round down", () => {
      // 1 SOL buy at genesis: fee ceil(cost * 100 / 10000)
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
      const curve = { virtualSolReserves: VQ0, virtualTokenReserves: VT0, supplyCap: CAP, tokensSold: new BN("400000000000") };
      expect(progressToGraduationBps(curve)).to.equal(5000);
      // spot = 30e9 * 1e9 / 1e12 = 30_000_000 lamports per 1e9 base units => mcap for 400k tokens = 12 SOL
      expect(marketCap(curve, "400000000000").toString()).to.equal("12000000000");
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
      expect(() => solUsdFromConfig(cfg, undefined, now))
         .to.throw(PriceError)
         .with.property("code", "InvalidPriceAccount");

      // Pyth confidence wider than 2% of the price -> PriceUncertain (program MAX_CONF_BPS = 200).
      const wide = Buffer.from(buf);
      wide.writeBigUInt64LE(BigInt("300000000"), 81); // 2.67% of 11217309341
      expect(() => solUsdFromConfig(cfg, wide, now))
         .to.throw(PriceError)
         .with.property("code", "PriceUncertain");
      const edge = Buffer.from(buf);
      edge.writeBigUInt64LE(BigInt("224346186"), 81); // exactly 2.00%: still accepted
      expect(solUsdFromConfig(cfg, edge, now).priceE6.toString()).to.equal("112173093");

      const admin = { priceMode: 0, solUsdPriceE6: new BN(150_000_000), pythFeedId: [], maxPriceAgeSecs: 0 };
      expect(solUsdFromConfig(admin).priceE6.toString()).to.equal("150000000");
      expect(() => solUsdFromConfig({ ...admin, solUsdPriceE6: 0 }))
         .to.throw(PriceError)
         .with.property("code", "PriceNotSet");
      // Admin mode also enforces max_price_age_secs against config.price_updated_ts.
      const aged = { ...admin, maxPriceAgeSecs: 300, priceUpdatedTs: new BN(now - 100) };
      expect(solUsdFromConfig(aged, undefined, now).publishTime).to.equal(now - 100);
      expect(() => solUsdFromConfig({ ...aged, priceUpdatedTs: new BN(now - 301) }, undefined, now))
         .to.throw(PriceError)
         .with.property("code", "PriceTooOld");

      buf[40] = 0;
      expect(() => decodePriceUpdateV2(buf)).to.throw(PriceError);
      expect(() => decodePriceUpdateV2(Buffer.alloc(10))).to.throw(PriceError);
   });
});

describe("pda.ts", () => {
   it("encodes little-endian seeds", () => {
      expect(u32Le(1).toString("hex")).to.equal("01000000");
      expect(u64Le(new BN("18446744073709551615")).toString("hex")).to.equal("ffffffffffffffff");
      expect(() => u64Le(new BN("18446744073709551616"))).to.throw(RangeError);
   });

   it("derives deterministic addresses under the program id", () => {
      const [config] = configPda();
      const [curve] = curvePda(0);
      const [mint] = mintPda(0);
      expect(PublicKey.isOnCurve(config.toBytes())).to.equal(false);
      expect(curve.equals(PublicKey.findProgramAddressSync([Buffer.from("curve"), u32Le(0)], PROGRAM_ID)[0])).to.equal(true);
      expect(mint.equals(curve)).to.equal(false);
      const perk = PublicKey.unique();
      const nonce = new BN("123456789012345");
      const [asset] = assetPda(perk, nonce);
      const [receipt] = receiptPda(asset);
      expect(asset.equals(PublicKey.findProgramAddressSync([Buffer.from("asset"), perk.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0])).to.equal(true);
      expect(receipt.equals(PublicKey.findProgramAddressSync([Buffer.from("receipt"), asset.toBuffer()], PROGRAM_ID)[0])).to.equal(true);
   });
});

describe("errors.ts", () => {
   it("loads the error table from the IDL", () => {
      expect(MOSTRO_ERRORS_BY_CODE.get(6000)?.name).to.equal("Paused");
      expect(MostroErrorCode.SlippageExceeded).to.equal(6005);
      expect(MOSTRO_ERRORS_BY_CODE.get(6005)?.copy).to.be.a("string").and.not.empty;
   });

   it("parses Anchor errors, raw custom errors and wallet rejections", () => {
      expect(parseMostroError({ error: { errorCode: { code: "VipOnly", number: 6025 } } })?.name).to.equal("VipOnly");
      expect(parseMostroError({ code: 6024, msg: "KYC approval required" })?.name).to.equal("KycRequired");
      expect(parseMostroError(new Error("Transaction simulation failed: custom program error: 0x1775"))?.name).to.equal("SlippageExceeded");
      expect(
         parseMostroError({ message: "failed", logs: ["Program log: AnchorError occurred. Error Code: PerkSoldOut. Error Number: 6004. Error Message: Perk is sold out."] })?.code,
      ).to.equal(6004);
      expect(parseMostroError(new Error("User rejected the request."))?.name).to.equal("UserRejected");
      expect(parseMostroError(new Error("something else"))).to.equal(null);
   });
});
