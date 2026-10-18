import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from "@nestjs/common";
import { TOKEN_PURCHASE_LIMITS, type BuildTokenPurchaseResponse, type TokenQuote } from "@mostro/shared/api";
import { z } from "zod";
import { AuthGuard } from "../../common/auth.guard";
import { ChainEnabledGuard } from "../../common/chain-enabled.guard";
import { CurrentIdentity, parseBody } from "../../common/http";
import type { OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { BuildTokenPurchaseUseCase, GetTokenQuoteUseCase } from "./tokens.use-cases";

const tokens = z.coerce.number().int("Choose a whole number of tokens.").min(TOKEN_PURCHASE_LIMITS.minTokens).max(TOKEN_PURCHASE_LIMITS.maxTokens, `You can buy up to ${TOKEN_PURCHASE_LIMITS.maxTokens} at a time.`);
const quoteSchema = z.object({ tokens });
const buildSchema = z.object({
   walletAddress: z.string().min(32).max(44),
   tokens,
   approvedMaxLamportsIn: z.string().regex(/^\d{1,20}$/, "Invalid approved amount."),
});

@Controller("tokens")
@UseGuards(AuthGuard, ChainEnabledGuard)
export class TokensController {
   constructor(
      @Inject(GetTokenQuoteUseCase) private readonly getQuote: GetTokenQuoteUseCase,
      @Inject(BuildTokenPurchaseUseCase) private readonly buildPurchase: BuildTokenPurchaseUseCase,
   ) {}

   @Get("quote")
   quote(@Query() query: unknown): Promise<TokenQuote> {
      return this.getQuote.execute(parseBody(quoteSchema, query).tokens);
   }

   @Post("buy/build")
   @HttpCode(200)
   build(@CurrentIdentity() identity: OpenfortIdentity, @Body() body: unknown): Promise<BuildTokenPurchaseResponse> {
      return this.buildPurchase.execute(identity, parseBody(buildSchema, body));
   }
}
