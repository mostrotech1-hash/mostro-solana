import { Controller, Get, Inject } from "@nestjs/common";
import type { FeaturesResponse } from "@mostro/shared/api";
import { ENV, type Env } from "../../config/env";

/** Public: lets the fronts know what is open before they ask for anything else. */
@Controller("features")
export class FeaturesController {
   constructor(@Inject(ENV) private readonly env: Env) {}

   @Get()
   features(): FeaturesResponse {
      return { chainEnabled: this.env.CHAIN_FEATURES_ENABLED === "true" };
   }
}
