import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ENV, type Env } from "../../config/env";

const MAX_BYTES = 2 * 1024 * 1024;

/** Detects the real image type from the first bytes: the browser-sent mime type is not trusted. */
function sniff(bytes: Buffer): { ext: string } | null {
   if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png" };
   if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg" };
   if (bytes.length > 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return { ext: "webp" };
   return null;
}

/**
 * Avatars live on disk, outside git: `<AVATARS_DIR>/<userId>/<file>`. The database keeps only the
 * relative path `<userId>/<file>`; the API turns it into a URL served from `/avatars/...`.
 */
@Injectable()
export class AvatarStorageService {
   private readonly logger = new Logger(AvatarStorageService.name);

   constructor(@Inject(ENV) private readonly env: Env) {}

   get rootDir(): string {
      return this.env.AVATARS_DIR;
   }

   urlFor(relativePath: string | null): string | null {
      return relativePath ? `${this.env.PUBLIC_API_URL.replace(/\/$/, "")}/avatars/${relativePath}` : null;
   }

   /** Replaces the user's avatar with `bytes`. Returns the relative path to store in the database. */
   async save(userId: string, bytes: Buffer): Promise<string> {
      if (bytes.length > MAX_BYTES) throw new BadRequestException("The picture must be 2 MB or smaller.");
      const type = sniff(bytes);
      if (!type) throw new BadRequestException("The picture must be a PNG, JPEG or WebP image.");

      const dir = join(this.rootDir, userId);
      await mkdir(dir, { recursive: true });
      const fileName = `avatar-${Date.now()}.${type.ext}`;
      await writeFile(join(dir, fileName), bytes);
      for (const old of await readdir(dir)) if (old !== fileName) await rm(join(dir, old), { force: true });
      return `${userId}/${fileName}`;
   }

   /** Downloads a provider picture (Google, X...). Never throws: a missing avatar must not break sign-in. */
   async saveFromUrl(userId: string, url: string): Promise<string | null> {
      try {
         if (!url.startsWith("https://")) return null;
         const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
         if (!response.ok) return null;
         return await this.save(userId, Buffer.from(await response.arrayBuffer()));
      } catch (err) {
         this.logger.warn(`Could not store the provider picture for ${userId}: ${(err as Error).message}`);
         return null;
      }
   }
}
