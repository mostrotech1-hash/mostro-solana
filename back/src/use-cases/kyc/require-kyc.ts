import { NotFoundException } from "@nestjs/common";
import type { Env } from "../../config/env";
import { apiError } from "../../common/api-error";
import type { OpenfortIdentity } from "../../modules/openfort/openfort.service";
import type { UserRecord, UserRepository } from "../users/user.repository";

/** What a buy needs before anything is built or signed: an approved Sumsub check (unless the gate is switched off). */
export function assertKycApproved(env: Pick<Env, "KYC_REQUIRED_FOR_PURCHASE">, user: Pick<UserRecord, "kycStatus">): void {
   if (env.KYC_REQUIRED_FOR_PURCHASE !== "true" || user.kycStatus === "approved") return;
   throw apiError(403, "KYC_REQUIRED", "Verify your identity before buying.");
}

/** Same, loading the user from the signed-in identity. */
export async function requireApprovedKyc(env: Pick<Env, "KYC_REQUIRED_FOR_PURCHASE">, users: Pick<UserRepository, "findByOpenfortId">, identity: OpenfortIdentity): Promise<UserRecord> {
   const user = await users.findByOpenfortId(identity.openfortId);
   if (!user) throw new NotFoundException("Unknown user. Sync the user first.");
   assertKycApproved(env, user);
   return user;
}
