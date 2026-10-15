import { Controller, Get, Headers, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { KycAccessTokenResponse, KycStatusResponse } from "@mostro/shared/api";
import type { Request } from "express";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentIdentity } from "../../common/http";
import type { OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { CreateKycAccessTokenUseCase, GetKycStatusUseCase, HandleSumsubWebhookUseCase } from "./kyc.use-cases";

@Controller("kyc")
export class KycController {
   constructor(
      @Inject(CreateKycAccessTokenUseCase) private readonly createToken: CreateKycAccessTokenUseCase,
      @Inject(GetKycStatusUseCase) private readonly getStatus: GetKycStatusUseCase,
      @Inject(HandleSumsubWebhookUseCase) private readonly webhook: HandleSumsubWebhookUseCase,
   ) {}

   @Post("access-token")
   @HttpCode(200)
   @UseGuards(AuthGuard)
   accessToken(@CurrentIdentity() identity: OpenfortIdentity): Promise<KycAccessTokenResponse> {
      return this.createToken.execute(identity);
   }

   @Get("status")
   @UseGuards(AuthGuard)
   status(@CurrentIdentity() identity: OpenfortIdentity): Promise<KycStatusResponse> {
      return this.getStatus.execute(identity);
   }

   /** Called by Sumsub, not by a browser: no Openfort token, the digest header authenticates it. */
   @Post("webhook")
   @HttpCode(200)
   async receive(
      @Req() request: RawBodyRequest<Request>,
      @Headers("x-payload-digest") digest: string | undefined,
      @Headers("x-payload-digest-alg") algorithm: string | undefined,
   ): Promise<{ ok: true }> {
      await this.webhook.execute(request.rawBody, digest, algorithm);
      return { ok: true };
   }
}
