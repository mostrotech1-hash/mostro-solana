import "dotenv/config";
import { join } from "node:path";
import { z } from "zod";

/** Keys the user fills later (Openfort, Shield, MoonPay) stay optional so the API boots without them; the feature that needs one fails with a clear 503. */
const schema = z.object({
   PORT: z.coerce.number().default(3100),
   FRONTEND_ORIGIN: z.string().default("http://localhost:4200"),
   PUBLIC_API_URL: z.string().default("http://localhost:3100"),
   DATABASE_URL: z.string().min(1),
   OPENFORT_PUBLISHABLE_KEY: z.string().optional(),
   OPENFORT_SECRET_KEY: z.string().optional(),
   SHIELD_API_KEY: z.string().optional(),
   SHIELD_API_SECRET: z.string().optional(),
   SHIELD_ENCRYPTION_SHARE: z.string().optional(),
   MOONPAY_API_KEY: z.string().optional(),
   MOONPAY_SECRET_KEY: z.string().optional(),
   MOONPAY_WIDGET_BASE_URL: z.string().default("https://buy-sandbox.moonpay.com"),
   MOONPAY_BASE_CURRENCY: z.string().default("usd"),
   /** Your own public IP, for local development only: MoonPay checks the buyer IP and this API only sees localhost. */
   MOONPAY_DEV_CLIENT_IP: z.string().optional(),
   /** Sponsor keypair (JSON array) that pays the fees and is the `payer` of the pass purchase. Server-only. */
   SPONSOR_SECRET_KEY: z.string().optional(),
   /** The demo runs on Solana devnet only: any other value is refused at startup. */
   SOLANA_CLUSTER: z.literal("devnet").default("devnet"),
   SOLANA_RPC_URL: z.string().default("https://api.devnet.solana.com"),
   /** Devnet only: when the buyer's wallet is short of SOL, the sponsor tops it up (MoonPay test mode delivers 1/100 of the amount). */
   DEVNET_TOPUP_ENABLED: z.enum(["true", "false"]).default("true"),
   /** Devnet only: the SOL one top-up sends. 0.15 SOL = the minimum MoonPay sells, so the demo wallet looks like a real card purchase. */
   DEVNET_TOPUP_LAMPORTS: z.coerce.number().int().min(1).max(1_000_000_000).default(150_000_000),
   /** When "true", a wallet that already owns the demo pass cannot buy a second one. Off by default so the demo can be repeated. */
   ENFORCE_ONE_PASS_PER_WALLET: z.enum(["true", "false"]).default("false"),
   AVATARS_DIR: z.string().default(join(process.cwd(), "storage", "avatars")),
});

export type Env = z.infer<typeof schema>;

/** Treats `KEY=` (empty) the same as unset. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
   const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
   return schema.parse(cleaned);
}

export const ENV = Symbol("ENV");
