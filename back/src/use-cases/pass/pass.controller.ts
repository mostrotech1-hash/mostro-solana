import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from "@nestjs/common";
import type { BuildPurchaseResponse, DevnetTopupResponse, PassOwnershipResponse, PassQuote, PurchaseResultResponse } from "@mostro/shared/api";
import { z } from "zod";
import { AuthGuard } from "../../common/auth.guard";
import { ChainEnabledGuard } from "../../common/chain-enabled.guard";
import { CurrentIdentity, parseBody } from "../../common/http";
import type { OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { BuildSponsoredPurchaseUseCase } from "./build-sponsored-purchase.use-case";
import { GetPassOwnershipUseCase } from "./get-pass-ownership.use-case";
import { GetPassQuoteUseCase } from "./get-pass-quote.use-case";
import { GetPurchaseResultUseCase } from "./get-purchase-result.use-case";
import { TopupDevnetUseCase } from "./topup-devnet.use-case";

const wallet = z.string().min(32).max(44);
const buildSchema = z.object({ walletAddress: wallet, approvedMaxLamportsIn: z.string().regex(/^\d{1,20}$/, "Invalid approved amount.") });
const resultSchema = z.object({ walletAddress: wallet, signature: z.string().min(64).max(90) });
const topupSchema = z.object({ walletAddress: wallet });

@Controller("pass")
@UseGuards(AuthGuard, ChainEnabledGuard)
export class PassController {
   constructor(
      @Inject(GetPassQuoteUseCase) private readonly getQuote: GetPassQuoteUseCase,
      @Inject(GetPassOwnershipUseCase) private readonly getOwnership: GetPassOwnershipUseCase,
      @Inject(BuildSponsoredPurchaseUseCase) private readonly buildPurchase: BuildSponsoredPurchaseUseCase,
      @Inject(GetPurchaseResultUseCase) private readonly getResult: GetPurchaseResultUseCase,
      @Inject(TopupDevnetUseCase) private readonly topup: TopupDevnetUseCase,
   ) {}

   @Get("quote")
   quote(): Promise<PassQuote> {
      return this.getQuote.execute();
   }

   @Get("ownership")
   ownership(@CurrentIdentity() identity: OpenfortIdentity, @Query() query: unknown): Promise<PassOwnershipResponse> {
      return this.getOwnership.execute(identity, parseBody(topupSchema, query).walletAddress);
   }

   @Post("purchase/build")
   @HttpCode(200)
   build(@CurrentIdentity() identity: OpenfortIdentity, @Body() body: unknown): Promise<BuildPurchaseResponse> {
      return this.buildPurchase.execute(identity, parseBody(buildSchema, body));
   }

   @Post("purchase/result")
   @HttpCode(200)
   result(@CurrentIdentity() identity: OpenfortIdentity, @Body() body: unknown): Promise<PurchaseResultResponse> {
      return this.getResult.execute(identity, parseBody(resultSchema, body));
   }

   @Post("devnet-topup")
   @HttpCode(200)
   devnetTopup(@CurrentIdentity() identity: OpenfortIdentity, @Body() body: unknown): Promise<DevnetTopupResponse> {
      return this.topup.execute(identity, parseBody(topupSchema, body));
   }
}
