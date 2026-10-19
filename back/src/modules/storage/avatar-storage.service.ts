import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { put } from "@vercel/blob";
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
 * On Vercel (BLOB_READ_WRITE_TOKEN set) the disk is read-only, so avatars go to Vercel Blob and the
 * database keeps the full public https URL instead.
 */
@Injectable()
export class AvatarStorageService {
   private readonly logger = new Logger(AvatarStorageService.name);

   constructor(@Inject(ENV) private readonly env: Env) {}

   get rootDir(): string {
      return this.env.AVATARS_DIR;
   }

   urlFor(relativePath: string | null): string | null {
      if (relativePath?.startsWith("https://")) return relativePath;
      return relativePath ? `${this.env.PUBLIC_API_URL.replace(/\/$/, "")}/avatars/${relativePath}` : null;
   }

   /** Replaces the user's avatar with `bytes`. Returns the relative path to store in the database. */
   async save(userId: string, bytes: Buffer): Promise<string> {
      if (bytes.length > MAX_BYTES) throw new BadRequestException("The picture must be 2 MB or smaller.");
      const type = sniff(bytes);
      if (!type) throw new BadRequestException("The picture must be a PNG, JPEG or WebP image.");

      if (process.env.BLOB_READ_WRITE_TOKEN) {
         const blob = await put(`avatars/${userId}/avatar-${Date.now()}.${type.ext}`, bytes, { access: "public", addRandomSuffix: true });
         return blob.url;
      }

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
         // Redirects are refused: an https provider URL must not bounce the server to an internal address.
         const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
         if (!response.ok || Number(response.headers.get("content-length")) > MAX_BYTES) {
            await response.body?.cancel();
            return null;
         }
         if (!response.body) return null;
         const reader = response.body.getReader();
         const chunks: Buffer[] = [];
         let size = 0;
         try {
            while (true) {
               const { done, value } = await reader.read();
               if (done) break;
               size += value.byteLength;
               if (size > MAX_BYTES) {
                  await reader.cancel();
                  return null;
               }
               chunks.push(Buffer.from(value));
            }
         } finally {
            reader.releaseLock();
         }
         return await this.save(userId, Buffer.concat(chunks, size));
      } catch (err) {
         this.logger.warn(`Could not store the provider picture for ${userId}: ${(err as Error).message}`);
         return null;
      }
   }
}
