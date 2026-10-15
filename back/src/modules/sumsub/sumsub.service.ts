import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { KycStatus } from "@mostro/shared/api";
import { ENV, type Env } from "../../config/env";
import { apiError } from "../../common/api-error";

/** The part of a Sumsub applicant / webhook payload this API reads. */
export interface SumsubReview {
   applicantId?: string;
   externalUserId?: string;
   reviewStatus?: string;
   reviewResult?: { reviewAnswer?: "GREEN" | "RED"; reviewRejectType?: "FINAL" | "RETRY" };
}

const DIGEST_ALGORITHMS: Record<string, string> = { HMAC_SHA1_HEX: "sha1", HMAC_SHA256_HEX: "sha256", HMAC_SHA512_HEX: "sha512" };

/** Maps what Sumsub says to the states the app cares about. `init` (applicant exists, nothing sent yet) stays `none`. */
export function kycStatusFromReview(review: SumsubReview): KycStatus {
   if (review.reviewStatus === "completed") {
      if (review.reviewResult?.reviewAnswer === "GREEN") return "approved";
      if (review.reviewResult?.reviewAnswer === "RED") return "rejected";
      return "pending";
   }
   if (review.reviewStatus && review.reviewStatus !== "init") return "pending";
   return "none";
}

/** `X-Payload-Digest` check over the exact bytes Sumsub sent. Never parse the body before this. */
export function isValidWebhookSignature(rawBody: Buffer, secret: string, digest: string | undefined, algorithm: string | undefined): boolean {
   const hmac = DIGEST_ALGORITHMS[algorithm ?? "HMAC_SHA256_HEX"];
   if (!hmac || !digest || !/^[0-9a-f]+$/i.test(digest)) return false;
   const expected = createHmac(hmac, secret).update(rawBody).digest();
   const received = Buffer.from(digest, "hex");
   return expected.length === received.length && timingSafeEqual(expected, received);
}

const UNAVAILABLE = "Identity verification is not available right now.";

/** Signed calls to the Sumsub API. The app token and secret only exist in `back/.env`. */
@Injectable()
export class SumsubService {
   constructor(@Inject(ENV) private readonly env: Env) {}

   private credentials(): { token: string; secret: string; levelName: string } {
      const { SUMSUB_APP_TOKEN: token, SUMSUB_SECRET_KEY: secret, SUMSUB_LEVEL_NAME: levelName } = this.env;
      if (!token || !secret || !levelName) throw apiError(503, "KYC_UNAVAILABLE", UNAVAILABLE);
      return { token, secret, levelName };
   }

   webhookSecret(): string {
      if (!this.env.SUMSUB_WEBHOOK_SECRET) throw apiError(503, "KYC_UNAVAILABLE", UNAVAILABLE);
      return this.env.SUMSUB_WEBHOOK_SECRET;
   }

   private call(method: "GET" | "POST", pathWithQuery: string): Promise<Response> {
      const { token, secret } = this.credentials();
      const ts = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac("sha256", secret).update(`${ts}${method}${pathWithQuery}`).digest("hex");
      return fetch(`${this.env.SUMSUB_API_BASE_URL}${pathWithQuery}`, {
         method,
         headers: { Accept: "application/json", "X-App-Token": token, "X-App-Access-Ts": ts, "X-App-Access-Sig": signature },
      });
   }

   /** Token for the web widget. `externalUserId` is the Mostro user id, so a webhook can find the user again. */
   async createAccessToken(externalUserId: string): Promise<{ token: string; expiresInSecs: number }> {
      const { levelName } = this.credentials();
      const ttl = this.env.SUMSUB_TOKEN_TTL_SECS;
      const query = `userId=${encodeURIComponent(externalUserId)}&levelName=${encodeURIComponent(levelName)}&ttlInSecs=${ttl}`;
      const response = await this.call("POST", `/resources/accessTokens?${query}`);
      const body = response.ok ? ((await response.json()) as { token?: string }) : {};
      if (!body.token) throw apiError(502, "KYC_UNAVAILABLE", "Identity verification could not be started. Try again in a moment.");
      return { token: body.token, expiresInSecs: ttl };
   }

   /** Current applicant, or `null` when the user never started. A fallback to the webhook, not a polling loop. */
   async getApplicant(externalUserId: string): Promise<SumsubReview | null> {
      const response = await this.call("GET", `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`);
      if (response.status === 404) return null;
      if (!response.ok) throw apiError(502, "KYC_UNAVAILABLE", "Identity verification status is not available right now.");
      const body = (await response.json()) as { id?: string; review?: { reviewStatus?: string; reviewResult?: SumsubReview["reviewResult"] } };
      return { applicantId: body.id, externalUserId, reviewStatus: body.review?.reviewStatus, reviewResult: body.review?.reviewResult };
   }
}
