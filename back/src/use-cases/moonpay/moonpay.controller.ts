import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { PrepareMoonpayResponse, SignMoonpayUrlResponse } from "@mostro/shared/api";
import { z } from "zod";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentIdentity, parseBody } from "../../common/http";
import type { OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { PrepareWidgetUseCase } from "./prepare-widget.use-case";
import { SignWidgetUrlUseCase } from "./sign-widget-url.use-case";

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const prepareSchema = z.object({
   walletAddress: z.string().regex(BASE58_ADDRESS, "Invalid Solana wallet address."),
   amountSol: z.number().positive().max(100),
});
const signSchema = z.object({ urlForSignature: z.string().min(1).max(4000) });

@Controller("moonpay")
@UseGuards(AuthGuard)
export class MoonpayController {
   constructor(
      @Inject(PrepareWidgetUseCase) private readonly prepareWidget: PrepareWidgetUseCase,
      @Inject(SignWidgetUrlUseCase) private readonly signWidgetUrl: SignWidgetUrlUseCase,
   ) {}

   @Post("prepare")
   @HttpCode(200)
   prepare(@CurrentIdentity() identity: OpenfortIdentity, @Body() body: unknown, @Req() req: Request): Promise<PrepareMoonpayResponse> {
      // Behind a proxy the buyer is the first address of x-forwarded-for.
      const forwarded = req.headers["x-forwarded-for"];
      const clientIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0])?.trim() || req.socket.remoteAddress || null;
      return this.prepareWidget.execute(identity, parseBody(prepareSchema, body), clientIp);
   }

   @Post("sign-url")
   @HttpCode(200)
   signUrl(@Body() body: unknown): SignMoonpayUrlResponse {
      return this.signWidgetUrl.execute(parseBody(signSchema, body));
   }
}
