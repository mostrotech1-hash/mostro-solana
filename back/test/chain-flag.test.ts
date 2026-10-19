import assert from "node:assert/strict";
import test from "node:test";
import type { HttpException } from "@nestjs/common";
import type { Env } from "../src/config/env";
import { loadEnv } from "../src/config/env";
import { ChainEnabledGuard } from "../src/common/chain-enabled.guard";
import { FeaturesController } from "../src/use-cases/features/features.controller";

test("the chain switch is off unless it is explicitly turned on", () => {
   assert.equal(loadEnv({ DATABASE_URL: "x" } as NodeJS.ProcessEnv).CHAIN_FEATURES_ENABLED, "false");
   assert.equal(loadEnv({ DATABASE_URL: "x", CHAIN_FEATURES_ENABLED: "true" } as NodeJS.ProcessEnv).CHAIN_FEATURES_ENABLED, "true");
});

test("while the switch is off, chain routes answer a clear 503 instead of crashing", () => {
   const guard = new ChainEnabledGuard({ CHAIN_FEATURES_ENABLED: "false" } as Env);
   assert.throws(
      () => guard.canActivate(),
      (error: HttpException) => error.getStatus() === 503 && (error.getResponse() as { code?: string }).code === "CHAIN_UNAVAILABLE",
   );
});

test("when it is on, the guard lets requests through and /features says so", () => {
   const on = { CHAIN_FEATURES_ENABLED: "true" } as Env;
   assert.equal(new ChainEnabledGuard(on).canActivate(), true);
   assert.deepEqual(new FeaturesController(on).features(), { chainEnabled: true });
   assert.deepEqual(new FeaturesController({ CHAIN_FEATURES_ENABLED: "false" } as Env).features(), { chainEnabled: false });
});
