import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { ENV, type Env } from "./config/env";

/** Builds the Nest app with CORS set. Shared by the local server (main.ts) and the Vercel function (vercel.ts). */
export async function createApp(): Promise<{ app: NestExpressApplication; env: Env }> {
   const app = await NestFactory.create<NestExpressApplication>(AppModule);
   const env = app.get<Env>(ENV);
   app.set(
      "trust proxy",
      env.TRUSTED_PROXIES?.split(",")
         .map((proxy) => proxy.trim())
         .filter(Boolean) ?? false,
   );
   app.enableCors({ origin: env.FRONTEND_ORIGIN, methods: ["GET", "POST", "PATCH"], allowedHeaders: ["Authorization", "Content-Type"] });
   return { app, env };
}
