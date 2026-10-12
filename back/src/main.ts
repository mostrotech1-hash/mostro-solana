import "reflect-metadata";
import { mkdir } from "node:fs/promises";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { ENV, type Env } from "./config/env";

async function bootstrap(): Promise<void> {
   const app = await NestFactory.create<NestExpressApplication>(AppModule);
   const env = app.get<Env>(ENV);

   app.enableCors({ origin: env.FRONTEND_ORIGIN, methods: ["GET", "POST", "PATCH"], allowedHeaders: ["Authorization", "Content-Type"] });

   // Avatars are plain files, served read-only. The folder is git-ignored and created on boot.
   await mkdir(env.AVATARS_DIR, { recursive: true });
   app.useStaticAssets(env.AVATARS_DIR, { prefix: "/avatars/", setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin") });

   await app.listen(env.PORT);
   new Logger("Bootstrap").log(`Mostro API on http://localhost:${env.PORT}`);
}

void bootstrap();
