import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { KycAccessTokenResponse, KycStatusResponse } from "@mostro/shared/api";
import { RateLimiter } from "../../common/api-error";
import type { OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { SumsubService, isValidWebhookSignature, kycStatusFromReview, type SumsubReview } from "../../modules/sumsub/sumsub.service";
import { UserRepository, type UserRecord } from "../users/user.repository";

async function requireUser(users: UserRepository, identity: OpenfortIdentity): Promise<UserRecord> {
   const user = await users.findByOpenfortId(identity.openfortId);
   if (!user) throw new NotFoundException("Unknown user. Sync the user first.");
   return user;
}

/** Token for the Sumsub widget, only for the signed-in user (their Mostro id is the Sumsub external user id). */
@Injectable()
export class CreateKycAccessTokenUseCase {
   private readonly limiter = new RateLimiter();

   constructor(
      @Inject(UserRepository) private readonly users: UserRepository,
      @Inject(SumsubService) private readonly sumsub: SumsubService,
   ) {}

   async execute(identity: OpenfortIdentity): Promise<KycAccessTokenResponse> {
      this.limiter.check(`${identity.openfortId}:kyc-token`, 10, 60 * 60_000);
      const user = await requireUser(this.users, identity);
      return this.sumsub.createAccessToken(user.id);
   }
}

/** The stored status. While it is not final, asks Sumsub once as a safety net in case a webhook was missed. */
@Injectable()
export class GetKycStatusUseCase {
   private readonly limiter = new RateLimiter();

   constructor(
      @Inject(UserRepository) private readonly users: UserRepository,
      @Inject(SumsubService) private readonly sumsub: SumsubService,
   ) {}

   async execute(identity: OpenfortIdentity): Promise<KycStatusResponse> {
      this.limiter.check(`${identity.openfortId}:kyc-status`, 30, 60_000);
      const user = await requireUser(this.users, identity);
      if (user.kycStatus === "approved" || user.kycStatus === "rejected") return { status: user.kycStatus };

      let review: SumsubReview | null = null;
      try {
         review = await this.sumsub.getApplicant(user.id);
      } catch {
         // Sumsub unreachable or not configured: the stored status is still the answer.
         return { status: user.kycStatus };
      }
      if (!review) return { status: user.kycStatus };
      const status = kycStatusFromReview(review);
      await this.users.setKyc(user.id, status, review.applicantId ?? null);
      return { status };
   }
}

const HANDLED_EVENTS = new Set(["applicantCreated", "applicantPending", "applicantPrechecked", "applicantOnHold", "applicantReviewed", "applicantWorkflowCompleted"]);

/** Sumsub calls this. The signature over the raw bytes is the only authentication, so it is checked before anything else. */
@Injectable()
export class HandleSumsubWebhookUseCase {
   constructor(
      @Inject(UserRepository) private readonly users: UserRepository,
      @Inject(SumsubService) private readonly sumsub: SumsubService,
   ) {}

   async execute(rawBody: Buffer | undefined, digest: string | undefined, algorithm: string | undefined): Promise<void> {
      const secret = this.sumsub.webhookSecret();
      if (!rawBody || !isValidWebhookSignature(rawBody, secret, digest, algorithm)) throw new UnauthorizedException("Invalid signature.");

      let event: SumsubReview & { type?: string };
      try {
         event = JSON.parse(rawBody.toString("utf8")) as SumsubReview & { type?: string };
      } catch {
         return;
      }
      if (!event.type || !HANDLED_EVENTS.has(event.type) || !event.externalUserId || !/^[0-9a-f-]{36}$/i.test(event.externalUserId)) return;

      const status = event.type === "applicantCreated" ? "none" : kycStatusFromReview(event);
      // `applicantCreated` only links the applicant; it must never reset a status that is already further along.
      if (status === "none") {
         const user = await this.users.findById(event.externalUserId);
         if (user) await this.users.setKyc(user.id, user.kycStatus, event.applicantId ?? null);
         return;
      }
      await this.users.setKyc(event.externalUserId, status, event.applicantId ?? null);
   }
}
