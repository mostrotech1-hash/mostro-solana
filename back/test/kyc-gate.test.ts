import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import type { KycStatus } from "@mostro/shared/api";
import type { Env } from "../src/config/env";
import type { OpenfortIdentity, OpenfortService } from "../src/modules/openfort/openfort.service";
import type { PurchaseTransactionBuilder } from "../src/modules/solana/purchase-transaction.builder";
import type { SolanaService } from "../src/modules/solana/solana.service";
import { assertKycApproved } from "../src/use-cases/kyc/require-kyc";
import { PrepareWidgetUseCase } from "../src/use-cases/moonpay/prepare-widget.use-case";
import { BuildSponsoredPurchaseUseCase } from "../src/use-cases/pass/build-sponsored-purchase.use-case";
import { TopupDevnetUseCase } from "../src/use-cases/pass/topup-devnet.use-case";
import type { UserRepository } from "../src/use-cases/users/user.repository";

const on = { KYC_REQUIRED_FOR_PURCHASE: "true" } as Env;
const off = { KYC_REQUIRED_FOR_PURCHASE: "false" } as Env;
const identity = { openfortId: "usr_gate", loginType: "email", email: null, imageUrl: null } as OpenfortIdentity;
const usersWith = (kycStatus: KycStatus) => ({ findByOpenfortId: async () => ({ id: "u1", kycStatus }) }) as unknown as UserRepository;

/** Any use of these means the gate did not stop the request in time. */
const mustNotBeTouched = (name: string) =>
   new Proxy({}, { get: () => () => assert.fail(`${name} was used before the KYC check`) });

async function code(promise: Promise<unknown>): Promise<string | undefined> {
   try {
      await promise;
   } catch (error) {
      return (error as HttpException).getResponse?.() && ((error as HttpException).getResponse() as { code?: string }).code;
   }
   return undefined;
}

test("only an approved check passes the gate; switching the gate off lets everyone through", () => {
   for (const status of ["none", "pending", "rejected"] as const) {
      assert.throws(() => assertKycApproved(on, { kycStatus: status }), (e: HttpException) => e.getStatus() === 403);
      assert.doesNotThrow(() => assertKycApproved(off, { kycStatus: status }));
   }
   assert.doesNotThrow(() => assertKycApproved(on, { kycStatus: "approved" }));
});

test("building the pass purchase is refused with KYC_REQUIRED before the chain or the signer is touched", async () => {
   const useCase = new BuildSponsoredPurchaseUseCase(
      on,
      mustNotBeTouched("openfort") as unknown as OpenfortService,
      usersWith("none"),
      mustNotBeTouched("solana") as unknown as SolanaService,
      mustNotBeTouched("builder") as unknown as PurchaseTransactionBuilder,
   );
   assert.equal(await code(useCase.execute(identity, { walletAddress: "x", approvedMaxLamportsIn: "1" })), "KYC_REQUIRED");
});

test("the devnet top-up does not pay out to a user who is not verified", async () => {
   const useCase = new TopupDevnetUseCase(
      { ...on, DEVNET_TOPUP_ENABLED: "true" } as Env,
      mustNotBeTouched("openfort") as unknown as OpenfortService,
      usersWith("pending"),
      mustNotBeTouched("solana") as unknown as SolanaService,
   );
   assert.equal(await code(useCase.execute(identity, { walletAddress: "x" })), "KYC_REQUIRED");
});

test("MoonPay is not prepared for a user who is not verified", async () => {
   const useCase = new PrepareWidgetUseCase(on, mustNotBeTouched("moonpay") as never, usersWith("rejected"), mustNotBeTouched("openfort") as unknown as OpenfortService);
   assert.equal(await code(useCase.execute(identity, { walletAddress: "x", amountSol: 1 }, null)), "KYC_REQUIRED");
});
