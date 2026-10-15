import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { KycStatus } from "@mostro/shared/api";
import { SumsubService } from "../src/modules/sumsub/sumsub.service";
import { HandleSumsubWebhookUseCase } from "../src/use-cases/kyc/kyc.use-cases";
import type { UserRepository } from "../src/use-cases/users/user.repository";

const SECRET = "whsec";
const USER = "11111111-2222-4333-8444-555555555555";

function setup(initial: KycStatus = "none") {
   const row = { status: initial, applicantId: null as string | null, writes: 0 };
   const users = {
      findById: async (id: string) => (id === USER ? { id, kycStatus: row.status } : null),
      setKyc: async (id: string, status: KycStatus, applicantId: string | null) => {
         if (id !== USER) return false;
         row.status = status;
         row.applicantId = applicantId ?? row.applicantId;
         row.writes += 1;
         return true;
      },
   } as unknown as UserRepository;
   const sumsub = new SumsubService({ SUMSUB_WEBHOOK_SECRET: SECRET } as never);
   return { row, useCase: new HandleSumsubWebhookUseCase(users, sumsub) };
}

const deliver = (useCase: HandleSumsubWebhookUseCase, event: object, secret = SECRET) => {
   const body = Buffer.from(JSON.stringify(event));
   return useCase.execute(body, createHmac("sha256", secret).update(body).digest("hex"), "HMAC_SHA256_HEX");
};

test("a wrong signature is refused and changes nothing", async () => {
   const { row, useCase } = setup();
   await assert.rejects(deliver(useCase, { type: "applicantReviewed", externalUserId: USER, reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" } }, "other"));
   assert.equal(row.status, "none");
});

test("pending, then green: the user ends approved; the same event twice is harmless", async () => {
   const { row, useCase } = setup();
   await deliver(useCase, { type: "applicantPending", externalUserId: USER, applicantId: "app1", reviewStatus: "pending" });
   assert.equal(row.status, "pending");
   const green = { type: "applicantReviewed", externalUserId: USER, applicantId: "app1", reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" } };
   await deliver(useCase, green);
   await deliver(useCase, green);
   assert.equal(row.status, "approved");
   assert.equal(row.applicantId, "app1");
});

test("a red review rejects", async () => {
   const { row, useCase } = setup("pending");
   await deliver(useCase, { type: "applicantReviewed", externalUserId: USER, reviewStatus: "completed", reviewResult: { reviewAnswer: "RED", reviewRejectType: "RETRY" } });
   assert.equal(row.status, "rejected");
});

test("applicantCreated only links the applicant: it never resets a status", async () => {
   const { row, useCase } = setup("approved");
   await deliver(useCase, { type: "applicantCreated", externalUserId: USER, applicantId: "app2", reviewStatus: "init" });
   assert.equal(row.status, "approved");
   assert.equal(row.applicantId, "app2");
});

test("unknown events and ids that are not ours are ignored", async () => {
   const { row, useCase } = setup();
   await deliver(useCase, { type: "applicantLevelChanged", externalUserId: USER, reviewStatus: "pending" });
   await deliver(useCase, { type: "applicantReviewed", externalUserId: "not-a-uuid", reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" } });
   assert.equal(row.writes, 0);
});
