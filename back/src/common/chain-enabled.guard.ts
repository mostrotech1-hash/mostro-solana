import { Inject, Injectable, type CanActivate } from "@nestjs/common";
import { ENV, type Env } from "../config/env";
import { apiError } from "./api-error";

/** Closes every route that touches the Solana program while `CHAIN_FEATURES_ENABLED` is not "true": a clear 503 instead of a crash. */
@Injectable()
export class ChainEnabledGuard implements CanActivate {
   constructor(@Inject(ENV) private readonly env: Env) {}

   canActivate(): boolean {
      if (this.env.CHAIN_FEATURES_ENABLED !== "true") throw apiError(503, "CHAIN_UNAVAILABLE", "Buying opens soon.");
      return true;
   }
}
