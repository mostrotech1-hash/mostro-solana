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
      const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) throw apiError(429, "RATE_LIMITED", "Too many requests. Wait a moment and try again.");
      recent.push(now);
      this.hits.set(key, recent);
   }
}
