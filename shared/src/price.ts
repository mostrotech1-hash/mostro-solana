/**
 * Mirror of `programs/mostro/src/pricing.rs`: SOL/USD from the admin-set price (mode 0) or a Pyth
 * `PriceUpdateV2` account decoded by hand (mode 1), plus USD(6dp) <-> lamports conversions.
 */
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { MAX_PRICE_CONF_BPS, PRICE_MODE_ADMIN, PRICE_MODE_PYTH } from "./constants";
import { bn, BNLike, U64_MAX, U128_MAX } from "./curve";

export type PriceErrorCode = "InvalidPriceAccount" | "PriceFeedMismatch" | "PriceTooOld" | "PriceNonPositive" | "PriceNotSet" | "PriceUncertain" | "MathOverflow";

export class PriceError extends Error {
   constructor(
      public readonly code: PriceErrorCode,
      message?: string,
   ) {
      super(message ?? code);
      this.name = "PriceError";
   }
}

/**
 * Layout of `PriceUpdateV2` (verification level `Full` only):
 *   @0 discriminator(8) @8 write_authority(32) @40 verification tag u8 (1 = Full)
 *   @41 feed_id[32] @73 price i64 @81 conf u64 @89 exponent i32 @93 publish_time i64
 */
export const PRICE_UPDATE_V2_OFFSETS = { tag: 40, feedId: 41, price: 73, conf: 81, expo: 89, publishTime: 93, minLen: 133 } as const;

export interface PriceUpdateV2 {
   writeAuthority: PublicKey;
   /** 1 = Full. Anything else is rejected by the program. */
   verificationLevel: number;
   /** 32 bytes. */
   feedId: Uint8Array;
   feedIdHex: string;
   price: BN;
   conf: BN;
   expo: number;
   publishTime: BN;
}

function readI64Le(b: Buffer, off: number): BN {
   return new BN(b.subarray(off, off + 8), "le").fromTwos(64);
}

/** Decode the fields the program reads from a Pyth `PriceUpdateV2` account. Throws `InvalidPriceAccount` on bad data. */
export function decodePriceUpdateV2(data: Buffer | Uint8Array): PriceUpdateV2 {
   const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
   const o = PRICE_UPDATE_V2_OFFSETS;
   if (b.length < o.minLen) throw new PriceError("InvalidPriceAccount", `account too short: ${b.length} < ${o.minLen}`);
   const verificationLevel = b[o.tag];
   if (verificationLevel !== 1) throw new PriceError("InvalidPriceAccount", `verification level ${verificationLevel} is not Full`);
   const feedId = Uint8Array.from(b.subarray(o.feedId, o.feedId + 32));
   return {
      writeAuthority: new PublicKey(b.subarray(8, 40)),
      verificationLevel,
      feedId,
      feedIdHex: Buffer.from(feedId).toString("hex"),
      price: readI64Le(b, o.price),
      conf: new BN(b.subarray(o.conf, o.conf + 8), "le"),
      expo: b.readInt32LE(o.expo),
      publishTime: readI64Le(b, o.publishTime),
   };
}

/** `price * 10^(6 + expo)` as u64, checked. Negative shifts floor. */
export function scaleToE6(price: BNLike, expo: number): BN {
   const p = bn(price);
   if (p.isNeg()) throw new PriceError("PriceNonPositive");
   const shift = 6 + expo;
   let v: BN;
   if (shift >= 0) {
      v = p.mul(new BN(10).pow(new BN(shift)));
      if (v.gt(U128_MAX)) throw new PriceError("MathOverflow");
   } else {
      v = p.div(new BN(10).pow(new BN(-shift)));
   }
   if (v.gt(U64_MAX)) throw new PriceError("MathOverflow");
   return v;
}

/** USD (6 dp) -> lamports at `priceE6` USD per SOL. `lamports = usd_e6 * 1e9 / price_e6`. */
export function usdE6ToLamports(usdE6: BNLike, priceE6: BNLike): BN {
   const p = bn(priceE6);
   if (p.lte(new BN(0))) throw new PriceError("PriceNotSet");
   const v = bn(usdE6).mul(new BN(1_000_000_000)).div(p);
   if (v.gt(U64_MAX)) throw new PriceError("MathOverflow");
   return v;
}

/** lamports -> USD (6 dp). `usd_e6 = lamports * price_e6 / 1e9`. */
export function lamportsToUsdE6(lamports: BNLike, priceE6: BNLike): BN {
   const v = bn(lamports).mul(bn(priceE6)).div(new BN(1_000_000_000));
   if (v.gt(U64_MAX)) throw new PriceError("MathOverflow");
   return v;
}

/** The subset of the on-chain `Config` account the pricing needs (camelCase, as Anchor decodes it). */
export interface PriceConfigLike {
   priceMode: number;
   solUsdPriceE6: BNLike;
   pythFeedId: number[] | Uint8Array;
   maxPriceAgeSecs: number;
   pythSolUsdAccount?: PublicKey;
   /** When set, admin mode (0) also enforces `now - priceUpdatedTs <= adminPriceMaxAgeSecs`, as the program does. */
   priceUpdatedTs?: BNLike;
   /** `Config.admin_price_max_age_secs`: max age of the admin price in mode 0 (86,400 s on devnet). Falls back to `maxPriceAgeSecs` when absent. */
   adminPriceMaxAgeSecs?: number;
}

export interface SolUsd {
   /** USD per SOL with 6 decimals. */
   priceE6: BN;
   /** 0 admin, 1 Pyth. */
   source: number;
   /** Unix seconds of the price used: Pyth publish time, or `config.priceUpdatedTs` in admin mode when it was given. */
   publishTime?: number;
}

/**
 * SOL/USD (6 decimals) exactly as `pricing::sol_usd` resolves it. In Pyth mode you must pass the raw
 * data of `config.pythSolUsdAccount`; `now` defaults to the local clock. In admin mode the price must have
 * been written within `adminPriceMaxAgeSecs` (checked when `config.priceUpdatedTs` is provided); Pyth mode uses
 * `maxPriceAgeSecs`. Pass the whole decoded `Config` account and both are picked up.
 */
export function solUsdFromConfig(config: PriceConfigLike, pythAccountData?: Buffer | Uint8Array, now: number = Math.floor(Date.now() / 1000)): SolUsd {
   if (config.priceMode === PRICE_MODE_ADMIN) {
      const p = bn(config.solUsdPriceE6);
      if (p.lte(new BN(0))) throw new PriceError("PriceNotSet");
      if (config.priceUpdatedTs !== undefined) {
         const age = now - bn(config.priceUpdatedTs).toNumber();
         const maxAge = config.adminPriceMaxAgeSecs ?? config.maxPriceAgeSecs;
         if (age > maxAge) throw new PriceError("PriceTooOld", `admin price is ${age}s old (max ${maxAge}s); run set_config`);
         return { priceE6: p, source: PRICE_MODE_ADMIN, publishTime: bn(config.priceUpdatedTs).toNumber() };
      }
      return { priceE6: p, source: PRICE_MODE_ADMIN };
   }
   if (config.priceMode === PRICE_MODE_PYTH) {
      if (!pythAccountData) throw new PriceError("InvalidPriceAccount", "Pyth account data is required in price mode 1");
      const u = decodePriceUpdateV2(pythAccountData);
      const expected = Buffer.from(config.pythFeedId).toString("hex");
      if (u.feedIdHex !== expected) throw new PriceError("PriceFeedMismatch", `feed ${u.feedIdHex} != ${expected}`);
      if (u.price.lte(new BN(0))) throw new PriceError("PriceNonPositive");
      const age = now - u.publishTime.toNumber();
      if (age > config.maxPriceAgeSecs) throw new PriceError("PriceTooOld", `price is ${age}s old (max ${config.maxPriceAgeSecs}s)`);
      // conf * 10_000 <= price * MAX_PRICE_CONF_BPS, else the program refuses the quote.
      if (u.conf.muln(10_000).gt(u.price.muln(MAX_PRICE_CONF_BPS)))
         throw new PriceError("PriceUncertain", `conf ${u.conf.toString()} > ${MAX_PRICE_CONF_BPS} bps of ${u.price.toString()}`);
      return { priceE6: scaleToE6(u.price, u.expo), source: PRICE_MODE_PYTH, publishTime: u.publishTime.toNumber() };
   }
   throw new PriceError("InvalidPriceAccount", `unknown price mode ${config.priceMode}`);
}

/** How many USDC base units (6 dp) buy the same curve input as `lamports` at `priceE6`. Rounds up so the quote is never short. */
export function lamportsToUsdcCeil(lamports: BNLike, priceE6: BNLike): BN {
   const num = bn(lamports).mul(bn(priceE6));
   const den = new BN(1_000_000_000);
   return num.add(den.subn(1)).div(den);
}

/** Display helpers. */
export function usdE6ToNumber(usdE6: BNLike): number {
   return Number(bn(usdE6).toString()) / 1e6;
}

export function lamportsToSolNumber(lamports: BNLike): number {
   return Number(bn(lamports).toString()) / 1e9;
}
