import { mkdir } from "node:fs/promises";
import { Logger } from "@nestjs/common";
import { createApp } from "./app";

async function bootstrap(): Promise<void> {
   const { app, env } = await createApp();

   // Without Vercel Blob, avatars are plain files served read-only. The folder is git-ignored and created on boot.
   await mkdir(env.AVATARS_DIR, { recursive: true });
   app.useStaticAssets(env.AVATARS_DIR, { prefix: "/avatars/", setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin") });

   await app.listen(env.PORT);
   new Logger("Bootstrap").log(`Mostro API on http://localhost:${env.PORT}`);
}

void bootstrap();
