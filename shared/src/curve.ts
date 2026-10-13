/**
 * BN.js mirror of `programs/mostro/src/curve.rs`.
 *
 * Constant-product bonding curve on virtual reserves (pump.fun style). Every formula and every
 * rounding step is the same as on-chain, so a quote computed here equals what the program will
 * mint or pay out to the unit:
 *   - tokens out: floor
 *   - exact-out cost: floor + 1
 *   - fees: ceil
 * Intermediates are checked against u128 and results against u64 exactly like the Rust code.
 */
import BN from "bn.js";

export type BNLike = BN | number | string | bigint;

export const BPS = new BN(10_000);
export const U64_MAX = new BN("18446744073709551615");
export const U128_MAX = new BN("340282366920938463463374607431768211455");
const E9 = new BN(1_000_000_000);

export type CurveErrorCode = "MathOverflow" | "InvalidAmount" | "CurveSoldOut" | "InvalidCurveParams" | "InvalidBps" | "InvalidDiscount";

/** Thrown with the same error name the program would return. */
export class CurveMathError extends Error {
   constructor(
      public readonly code: CurveErrorCode,
      message?: string,
   ) {
      super(message ?? code);
      this.name = "CurveMathError";
   }
}

export function bn(v: BNLike): BN {
   if (BN.isBN(v)) return v;
   if (typeof v === "bigint") return new BN(v.toString());
   if (typeof v === "number") {
      if (!Number.isSafeInteger(v)) throw new CurveMathError("InvalidAmount", `not a safe integer: ${v}`);
      return new BN(v);
   }
   return new BN(v);
}

function u128(v: BN): BN {
   if (v.isNeg() || v.gt(U128_MAX)) throw new CurveMathError("MathOverflow");
   return v;
}

function u64(v: BN): BN {
   if (v.isNeg() || v.gt(U64_MAX)) throw new CurveMathError("MathOverflow");
   return v;
}

function mul(a: BN, b: BN): BN {
   return u128(a.mul(b));
}

function add(a: BN, b: BN): BN {
   return u128(a.add(b));
}

function div(a: BN, b: BN): BN {
   if (b.isZero()) throw new CurveMathError("MathOverflow");
   return a.div(b);
}

function ceilDiv(a: BN, b: BN): BN {
   if (b.lte(new BN(0))) throw new CurveMathError("MathOverflow");
   return div(add(a, b.subn(1)), b);
}

export interface BuyQuote {
   /** Quote that goes into the reserves (after fee). */
   netIn: BN;
   /** Fee paid to the treasury. */
   fee: BN;
   tokensOut: BN;
   /** `netIn + fee`: what the buyer actually pays. */
   totalIn: BN;
}

export interface SellQuote {
   /** Gross quote leaving the reserves. */
   grossOut: BN;
   fee: BN;
   /** What the seller receives. */
   netOut: BN;
}

/** Spot price in quote-per-token scaled by 1e9. Informational only. */
export function spotPriceE9(virtualQuote: BNLike, virtualTokens: BNLike): BN {
   return div(mul(bn(virtualQuote), E9), bn(virtualTokens));
}

/**
 * Buy with an exact quote amount (`buy_tokens_sol`, `buy_tokens_usdc` after USD->lamports).
 * `net = (q - 1) * 10000 / (10000 + fee_bps)`, `out = net * VT / (VQ + net)`.
 */
export function quoteBuyExactIn(virtualQuote: BNLike, virtualTokens: BNLike, quoteIn: BNLike, feeBps: number): BuyQuote {
   const q = bn(quoteIn);
   if (q.lte(new BN(1))) throw new CurveMathError("InvalidAmount", "quote_in must be > 1");
   const net = div(mul(q.subn(1), BPS), BPS.addn(feeBps));
   if (net.isZero()) throw new CurveMathError("InvalidAmount", "net amount rounds to zero");
   const vq = bn(virtualQuote);
   const vt = bn(virtualTokens);
   const out = div(mul(net, vt), add(vq, net));
   const netIn = u64(net);
   const fee = u64(q.sub(net));
   return { netIn, fee, tokensOut: u64(out), totalIn: netIn.add(fee) };
}

/**
 * Buy an exact token amount (`buy_tokens_exact_out_sol`).
 * `cost = t * VQ / (VT - t) + 1`, `fee = ceil(cost * fee_bps / 10000)`.
 */
export function quoteBuyExactOut(virtualQuote: BNLike, virtualTokens: BNLike, tokensOut: BNLike, feeBps: number): BuyQuote {
   const t = bn(tokensOut);
   const vt = bn(virtualTokens);
   if (t.isZero() || t.isNeg()) throw new CurveMathError("InvalidAmount", "tokens_out must be > 0");
   if (t.gte(vt)) throw new CurveMathError("CurveSoldOut", "tokens_out must be < virtual token reserves");
   const vq = bn(virtualQuote);
   const cost = add(div(mul(t, vq), vt.sub(t)), new BN(1));
   const fee = ceilDiv(mul(cost, new BN(feeBps)), BPS);
   const netIn = u64(cost);
   const feeU = u64(fee);
   return { netIn, fee: feeU, tokensOut: u64(t), totalIn: u64(netIn.add(feeU)) };
}

/**
 * Sell an exact token amount (`sell_tokens`).
 * `out = t * VQ / (VT + t)`, `fee = ceil(out * fee_bps / 10000)`.
 */
export function quoteSell(virtualQuote: BNLike, virtualTokens: BNLike, tokensIn: BNLike, feeBps: number): SellQuote {
   const t = bn(tokensIn);
   if (t.isZero() || t.isNeg()) throw new CurveMathError("InvalidAmount", "tokens_in must be > 0");
   const vq = bn(virtualQuote);
   const vt = bn(virtualTokens);
   const out = div(mul(t, vq), add(vt, t));
   const fee = ceilDiv(mul(out, new BN(feeBps)), BPS);
   if (out.lt(fee)) throw new CurveMathError("InvalidAmount", "payout smaller than fee");
   return { grossOut: u64(out), fee: u64(fee), netOut: u64(out.sub(fee)) };
}

/** Quote needed (before fees) to sell out the curve from genesis. Derived, never stored. */
export function quoteToComplete(virtualQuote0: BNLike, virtualTokens0: BNLike, supplyCap: BNLike): BN {
   const vq0 = bn(virtualQuote0);
   const vt0 = bn(virtualTokens0);
   const cap = bn(supplyCap);
   if (cap.gte(vt0)) throw new CurveMathError("InvalidCurveParams", "supply_cap must be < virtual token reserves");
   const v = div(mul(vq0, vt0), vt0.sub(cap)).sub(vq0);
   if (v.isNeg()) throw new CurveMathError("MathOverflow");
   return u64(v);
}

export interface RedeemSplit {
   burn: BN;
   rewards: BN;
   artist: BN;
}

/** Split a redeemed amount into burn / rewards / artist shares. Remainder goes to the artist. */
export function splitRedeem(amount: BNLike, burnBps: number, rewardsBps: number): RedeemSplit {
   if (burnBps < 0 || rewardsBps < 0 || burnBps + rewardsBps > 10_000) throw new CurveMathError("InvalidBps");
   const a = bn(amount);
   const burn = u64(div(a.mul(new BN(burnBps)), BPS));
   const rewards = u64(div(a.mul(new BN(rewardsBps)), BPS));
   const artist = a.sub(burn).sub(rewards);
   if (artist.isNeg()) throw new CurveMathError("MathOverflow");
   return { burn, rewards, artist };
}

/** Apply a basis-point discount, rounding the discount down. */
export function applyDiscount(price: BNLike, discountBps: number): BN {
   if (discountBps < 0 || discountBps > 10_000) throw new CurveMathError("InvalidBps");
   const p = bn(price);
   const d = u64(div(p.mul(new BN(discountBps)), BPS));
   const r = p.sub(d);
   if (r.isNeg()) throw new CurveMathError("InvalidDiscount");
   return r;
}

// ---- convenience on top of a `Curve` account ------------------------------------------------

/** The subset of the on-chain `Curve` account the math needs (camelCase, as Anchor decodes it). */
export interface CurveLike {
   virtualSolReserves: BNLike;
   virtualTokenReserves: BNLike;
   supplyCap: BNLike;
   tokensSold: BNLike;
   realSolReserves?: BNLike;
}

/** Lamports per whole token (1e6 base units) at the current spot. */
export function spotPrice(curve: CurveLike, decimals = 6): BN {
   // spotPriceE9 is lamports per base unit scaled by 1e9; a whole token is 10^decimals base units.
   return spotPriceE9(curve.virtualSolReserves, curve.virtualTokenReserves)
      .mul(new BN(10).pow(new BN(decimals)))
      .div(E9);
}

/** Spot price as a JS number of SOL per whole token (display only). */
export function spotPriceSol(curve: CurveLike, decimals = 6): number {
   const vq = bn(curve.virtualSolReserves);
   const vt = bn(curve.virtualTokenReserves);
   return (Number(vq.toString()) / 1e9) * (Math.pow(10, decimals) / Number(vt.toString()));
}

/**
 * Market cap in lamports = spot price * live mint supply. Pass the live `mint.supply` so burns are
 * reflected; falls back to `tokensSold` when no supply is given.
 */
export function marketCap(curve: CurveLike, mintSupply?: BNLike): BN {
   const supply = mintSupply === undefined ? bn(curve.tokensSold) : bn(mintSupply);
   return spotPriceE9(curve.virtualSolReserves, curve.virtualTokenReserves).mul(supply).div(E9);
}

/** Progress to graduation in basis points (0..10000) based on tokens sold vs. supply cap. */
export function progressToGraduationBps(curve: CurveLike): number {
   const cap = bn(curve.supplyCap);
   if (cap.isZero()) return 0;
   return Math.min(10_000, bn(curve.tokensSold).mul(BPS).div(cap).toNumber());
}

/** Lamports (before fees) still needed to reach the supply cap from the current state. */
export function quoteRemainingToComplete(curve: CurveLike): BN {
   const remaining = bn(curve.supplyCap).sub(bn(curve.tokensSold));
   if (remaining.lte(new BN(0))) return new BN(0);
   return quoteBuyExactOut(curve.virtualSolReserves, curve.virtualTokenReserves, remaining, 0).netIn;
}

/** Tokens the curve can still mint. */
export function remainingSupply(curve: CurveLike): BN {
   const r = bn(curve.supplyCap).sub(bn(curve.tokensSold));
   return r.isNeg() ? new BN(0) : r;
}

// ---- slippage helpers -------------------------------------------------------------------------

/** `amount * (10000 - slippageBps) / 10000`, floored. Use for `min_tokens_out` / `min_lamports_out`. */
export function minOut(amount: BNLike, slippageBps = 100): BN {
   if (slippageBps < 0 || slippageBps > 10_000) throw new CurveMathError("InvalidBps");
   return bn(amount).mul(BPS.subn(slippageBps)).div(BPS);
}

/** `ceil(amount * (10000 + slippageBps) / 10000)`. Use for `max_lamports_in`. */
export function maxIn(amount: BNLike, slippageBps = 100): BN {
   if (slippageBps < 0) throw new CurveMathError("InvalidBps");
   return ceilDiv(bn(amount).mul(BPS.addn(slippageBps)), BPS);
}

/** Apply a buy to a copy of the curve state (for charting / previewing several steps). */
export function applyBuy<T extends CurveLike>(curve: T, q: BuyQuote): T {
   return {
      ...curve,
      virtualSolReserves: bn(curve.virtualSolReserves).add(q.netIn),
      virtualTokenReserves: bn(curve.virtualTokenReserves).sub(q.tokensOut),
      tokensSold: bn(curve.tokensSold).add(q.tokensOut),
      realSolReserves: curve.realSolReserves === undefined ? undefined : bn(curve.realSolReserves).add(q.netIn),
   };
}

/** Apply a sell to a copy of the curve state. */
export function applySell<T extends CurveLike>(curve: T, tokensIn: BNLike, q: SellQuote): T {
   return {
      ...curve,
      virtualSolReserves: bn(curve.virtualSolReserves).sub(q.grossOut),
      virtualTokenReserves: bn(curve.virtualTokenReserves).add(bn(tokensIn)),
      tokensSold: bn(curve.tokensSold).sub(bn(tokensIn)),
      realSolReserves: curve.realSolReserves === undefined ? undefined : bn(curve.realSolReserves).sub(q.grossOut),
   };
}
