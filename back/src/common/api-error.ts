import { HttpException } from "@nestjs/common";
import type { ApiError, ApiErrorCode } from "@mostro/shared/api";

/** An API error with a machine-readable `code` (and optional extra fields) next to the human `message`. */
export function apiError(status: number, code: ApiErrorCode, message: string, extra: Partial<ApiError> = {}): HttpException {
   const body: ApiError = { statusCode: status, message, code, ...extra };
   return new HttpException(body, status);
}

/**
 * Tiny in-memory rate limiter (per process). It stops one user from hammering the endpoints that spend the
 * sponsor's SOL; it is not a replacement for a real gateway limit in production.
 */
export class RateLimiter {
   private readonly hits = new Map<string, number[]>();

   /** Throws 429 when `key` made `max` calls in the last `windowMs`. */
   check(key: string, max: number, windowMs: number): void {
      const now = Date.now();
      this.sweep(now, windowMs);
      const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) throw apiError(429, "RATE_LIMITED", "Too many requests. Wait a moment and try again.");
      recent.push(now);
      this.hits.set(key, recent);
   }

   private lastSweep = 0;

   /** Drops keys with no recent hit so the map cannot grow without bound (at most once a minute). */
   private sweep(now: number, windowMs: number): void {
      if (now - this.lastSweep < 60_000) return;
      this.lastSweep = now;
      for (const [key, times] of this.hits) if (times.every((t) => now - t >= Math.max(windowMs, 60 * 60_000))) this.hits.delete(key);
   }
}
