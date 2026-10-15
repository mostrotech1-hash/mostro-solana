import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { isValidWebhookSignature, kycStatusFromReview } from "../src/modules/sumsub/sumsub.service";

const secret = "webhook-secret";
const body = Buffer.from(JSON.stringify({ type: "applicantReviewed", externalUserId: "x" }));
const sign = (bytes: Buffer, alg = "sha256") => createHmac(alg, secret).update(bytes).digest("hex");

test("webhook signature: accepts the exact bytes, rejects anything else", () => {
   assert.equal(isValidWebhookSignature(body, secret, sign(body), "HMAC_SHA256_HEX"), true);
   assert.equal(isValidWebhookSignature(body, secret, sign(body), undefined), true);
   assert.equal(isValidWebhookSignature(body, secret, sign(body, "sha512"), "HMAC_SHA512_HEX"), true);
   assert.equal(isValidWebhookSignature(Buffer.from(body.toString() + " "), secret, sign(body), "HMAC_SHA256_HEX"), false);
   assert.equal(isValidWebhookSignature(body, "other", sign(body), "HMAC_SHA256_HEX"), false);
   assert.equal(isValidWebhookSignature(body, secret, undefined, "HMAC_SHA256_HEX"), false);
   assert.equal(isValidWebhookSignature(body, secret, "not-hex!", "HMAC_SHA256_HEX"), false);
   assert.equal(isValidWebhookSignature(body, secret, "abcd", "HMAC_SHA256_HEX"), false);
   assert.equal(isValidWebhookSignature(body, secret, sign(body), "UNKNOWN"), false);
});

test("status mapping: only a completed review decides", () => {
   assert.equal(kycStatusFromReview({ reviewStatus: "init" }), "none");
   assert.equal(kycStatusFromReview({}), "none");
   assert.equal(kycStatusFromReview({ reviewStatus: "pending" }), "pending");
   assert.equal(kycStatusFromReview({ reviewStatus: "onHold" }), "pending");
   assert.equal(kycStatusFromReview({ reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" } }), "approved");
   assert.equal(kycStatusFromReview({ reviewStatus: "completed", reviewResult: { reviewAnswer: "RED", reviewRejectType: "RETRY" } }), "rejected");
   assert.equal(kycStatusFromReview({ reviewStatus: "completed" }), "pending");
});
