import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import type { PrepareMoonpayResponse } from "@mostro/shared/api";
import { ENV, type Env } from "../../config/env";
import { requireConfigured } from "../../common/http";

export interface BuyWidgetParams {
   walletAddress: string;
   amountSol: number;
   externalCustomerId: string;
   /** The buyer's IP as this API saw it. */
   clientIp?: string | null;
}

/** True only for a routable public IP: loopback, private and link-local addresses mean the API is being called from the same machine. */
export function isPublicIp(ip: string): boolean {
   const addr = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
   if (!isIP(addr)) return false;
   if (addr === "::1" || addr === "::" || /^(fc|fd|fe80)/i.test(addr)) return false;
   const parts = addr.split(".");
   if (parts.length !== 4) return true;
   const [a, b] = parts.map(Number) as [number, number];
   if (a === 0 || a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return false;
   return true;
}

/**
 * Settings and signing for the MoonPay Web SDK. The secret key stays here: the browser gets the public widget
 * params, then sends the SDK's URL back to be signed (MoonPay requires a signature when the URL carries a wallet address).
 */
@Injectable()
export class MoonpayUrlService {
   private readonly logger = new Logger(MoonpayUrlService.name);

   constructor(@Inject(ENV) private readonly env: Env) {}

   prepare(params: BuyWidgetParams, callerId: string): PrepareMoonpayResponse {
      const apiKey = requireConfigured(this.env.MOONPAY_API_KEY, "MoonPay");
      const secret = requireConfigured(this.env.MOONPAY_SECRET_KEY, "MoonPay");

      const widgetParams: Record<string, string> = {
         apiKey,
         currencyCode: "sol",
         baseCurrencyCode: this.env.MOONPAY_BASE_CURRENCY,
         walletAddress: params.walletAddress,
         quoteCurrencyAmount: String(params.amountSol),
         externalCustomerId: params.externalCustomerId,
         theme: "dark",
      };

      // MoonPay IP matching: the URL must carry HMAC(secret, buyer IP). Locally this API only sees localhost,
      // so MOONPAY_DEV_CLIENT_IP (your public IP) stands in.
      const observed = params.clientIp && isPublicIp(params.clientIp) ? params.clientIp : null;
      const devIp = this.env.MOONPAY_DEV_CLIENT_IP && isPublicIp(this.env.MOONPAY_DEV_CLIENT_IP) ? this.env.MOONPAY_DEV_CLIENT_IP : null;
      const buyerIp = observed ?? devIp;
      if (buyerIp) widgetParams.allowedIpAddress = createHmac("sha256", secret).update(buyerIp).digest("base64");
      else this.logger.warn("No public buyer IP: set MOONPAY_DEV_CLIENT_IP in back/.env or MoonPay will answer 5_PARTNERS_IP_MISSING.");

      const payload = Buffer.from(JSON.stringify({ callerId, expiresAt: Date.now() + 10 * 60 * 1000, params: widgetParams })).toString("base64url");
      const proof = createHmac("sha256", secret).update(`moonpay-preparation:${payload}`).digest("base64url");
      return { environment: apiKey.startsWith("pk_live") ? "production" : "sandbox", params: widgetParams, preparationToken: `${payload}.${proof}` };
   }

   /** Signs only the caller's unexpired, server-prepared purchase, including its IP constraint. */
   sign(urlForSignature: string, preparationToken: string, callerId: string): string {
      const apiKey = requireConfigured(this.env.MOONPAY_API_KEY, "MoonPay");
      const secret = requireConfigured(this.env.MOONPAY_SECRET_KEY, "MoonPay");

      let url: URL;
      let prepared: { callerId: string; expiresAt: number; params: Record<string, string> };
      try {
         const [payload, proof, extra] = preparationToken.split(".");
         if (!payload || !proof || extra !== undefined) throw new Error();
         const expected = createHmac("sha256", secret).update(`moonpay-preparation:${payload}`).digest("base64url");
         if (proof.length !== expected.length || !timingSafeEqual(Buffer.from(proof), Buffer.from(expected))) throw new Error();
         prepared = JSON.parse(Buffer.from(payload, "base64url").toString());
         if (prepared.callerId !== callerId || !Number.isFinite(prepared.expiresAt) || prepared.expiresAt <= Date.now()) throw new Error();
         url = new URL(urlForSignature);
      } catch {
         throw new BadRequestException("Invalid or expired prepared widget URL.");
      }
      const base = new URL(this.env.MOONPAY_WIDGET_BASE_URL);
      if (
         url.protocol !== "https:" ||
         url.origin !== base.origin ||
         !/(^|\.)moonpay\.com$/.test(url.hostname) ||
         url.pathname !== base.pathname ||
         url.username ||
         url.password ||
         url.hash ||
         url.searchParams.get("apiKey") !== apiKey
      )
         throw new BadRequestException("This URL cannot be signed.");
      for (const [key, value] of Object.entries(prepared.params)) {
         const values = url.searchParams.getAll(key);
         if (values.length !== 1 || values[0] !== value) throw new BadRequestException("Widget parameters do not match the prepared purchase.");
      }
      // SDK presentation/telemetry only. No additional purchase, wallet or redirect parameters are accepted.
      const sdkParams = new Set(["mpSdk"]);
      for (const key of url.searchParams.keys()) {
         if (url.searchParams.getAll(key).length !== 1 || (!Object.hasOwn(prepared.params, key) && !sdkParams.has(key)))
            throw new BadRequestException("Unexpected widget parameter.");
      }

      return createHmac("sha256", secret).update(url.search).digest("base64");
   }
}
