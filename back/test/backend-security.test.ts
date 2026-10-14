import "reflect-metadata";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import express from "express";
import { Keypair } from "@solana/web3.js";
import { loadEnv } from "../src/config/env";
import { MoonpayUrlService } from "../src/modules/moonpay/moonpay-url.service";
import { OpenfortService } from "../src/modules/openfort/openfort.service";
import { AvatarStorageService } from "../src/modules/storage/avatar-storage.service";
import { PrepareWidgetUseCase } from "../src/use-cases/moonpay/prepare-widget.use-case";
import type { UserRepository } from "../src/use-cases/users/user.repository";

const env = loadEnv({ DATABASE_URL: "unused", MOONPAY_API_KEY: "pk_test_security", MOONPAY_SECRET_KEY: "test-secret" });
const identity = { openfortId: "usr_test", email: null, imageUrl: null };

test("MoonPay signing is bound to the caller, expiry and exact prepared parameters", () => {
   const service = new MoonpayUrlService(env);
   const prepared = service.prepare(
      { walletAddress: Keypair.generate().publicKey.toBase58(), amountSol: 0.15, externalCustomerId: "customer", clientIp: "8.8.8.8" },
      identity.openfortId,
   );
   const url = new URL(env.MOONPAY_WIDGET_BASE_URL);
   for (const [key, value] of Object.entries(prepared.params)) url.searchParams.set(key, value);
   url.searchParams.set("mpSdk", JSON.stringify({ flow: "buy", variant: "embedded", platform: "web" }));
   const sign = (target = url, token = prepared.preparationToken, caller = identity.openfortId) => service.sign(target.href, token, caller);
   assert.equal(sign(), createHmac("sha256", env.MOONPAY_SECRET_KEY!).update(url.search).digest("base64"));
   assert.throws(() => sign(url, prepared.preparationToken, "another-user"));
   assert.throws(() => sign(url, prepared.preparationToken + "x"));
   for (const key of Object.keys(prepared.params)) {
      const changed = new URL(url);
      changed.searchParams.set(key, "attacker");
      assert.throws(() => sign(changed), key);
      const missing = new URL(url);
      missing.searchParams.delete(key);
      assert.throws(() => sign(missing), key);
      const duplicate = new URL(url);
      duplicate.searchParams.append(key, prepared.params[key]!);
      assert.throws(() => sign(duplicate), key);
   }
   for (const target of ["http://buy-sandbox.moonpay.com", "https://evil.moonpay.com", "https://buy-sandbox.moonpay.com/swaps"]) {
      const changed = new URL(target);
      changed.search = url.search;
      assert.throws(() => sign(changed));
   }
   const extra = new URL(url);
   extra.searchParams.set("walletAddresses", "attacker");
   assert.throws(() => sign(extra));
   const withoutIp = service.prepare({ walletAddress: "wallet", amountSol: 1, externalCustomerId: "customer" }, identity.openfortId);
   const addedIp = new URL(env.MOONPAY_WIDGET_BASE_URL);
   for (const [key, value] of Object.entries(withoutIp.params)) addedIp.searchParams.set(key, value);
   addedIp.searchParams.set("allowedIpAddress", "attacker");
   assert.throws(() => sign(addedIp, withoutIp.preparationToken));
   const realNow = Date.now;
   try {
      Date.now = () => realNow() + 11 * 60 * 1000;
      assert.throws(() => sign());
   } finally {
      Date.now = realNow;
   }
});

test("MoonPay preparation rejects a wallet the caller does not own", async () => {
   const openfort = { ownsSolanaWallet: async () => false } as unknown as OpenfortService;
   const users = { findByOpenfortId: async () => ({ id: "customer" }) } as unknown as UserRepository;
   const useCase = new PrepareWidgetUseCase(new MoonpayUrlService(env), users, openfort);
   await assert.rejects(useCase.execute(identity, { walletAddress: Keypair.generate().publicKey.toBase58(), amountSol: 1 }, null), /does not belong/);
});

test("authentication verifies each token without fetching linked accounts", async () => {
   const service = new OpenfortService(env);
   let sessions = 0;
   let profiles = 0;
   Object.assign(service, {
      client: {
         iam: {
            getSession: async () => {
               sessions++;
               return { user: { id: identity.openfortId } };
            },
            users: {
               get: async () => {
                  profiles++;
                  return { linkedAccounts: [{ provider: "google", updatedAt: 1 }] };
               },
            },
         },
      },
   });
   const configured = new OpenfortService({ ...env, OPENFORT_SECRET_KEY: "secret", OPENFORT_PUBLISHABLE_KEY: "public" });
   Object.assign(configured, { client: (service as unknown as { client: unknown }).client });
   await configured.verifyAccessToken("one");
   await configured.verifyAccessToken("two");
   assert.equal(sessions, 2);
   assert.equal(profiles, 0);
   assert.equal(await configured.loginTypeOf(identity.openfortId), "google");
   assert.equal(profiles, 1);
});

test("Express ignores forwarded IPs unless the immediate proxy is trusted", async () => {
   const app = express();
   app.get("/", (req, res) => res.json({ ip: req.ip }));
   const server = createServer(app);
   await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
   const address = server.address() as { port: number };
   try {
      const readIp = async () => ((await (await fetch(`http://127.0.0.1:${address.port}`, { headers: { "x-forwarded-for": "1.1.1.1, 8.8.8.8" } })).json()) as { ip: string }).ip;
      assert.equal(await readIp(), "127.0.0.1");
      app.set("trust proxy", ["10.0.0.0/8"]);
      assert.equal(await readIp(), "127.0.0.1");
      app.set("trust proxy", ["loopback"]);
      assert.equal(await readIp(), "8.8.8.8");
   } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
   }
});

test("avatar downloads reject advertised and streamed oversize bodies before saving", async () => {
   const service = new AvatarStorageService(env);
   const originalFetch = globalThis.fetch;
   const saved: Buffer[] = [];
   service.save = async (_id, bytes) => {
      saved.push(bytes);
      return "saved";
   };
   try {
      let cancelled = false;
      globalThis.fetch = async () =>
         new Response(
            new ReadableStream({
               cancel() {
                  cancelled = true;
               },
            }),
            { headers: { "content-length": String(2 * 1024 * 1024 + 1) } },
         );
      assert.equal(await service.saveFromUrl("user", "https://provider.test/avatar"), null);
      assert.equal(cancelled, true);
      for (const headers of [new Headers(), new Headers({ "content-length": "1" })]) {
         cancelled = false;
         globalThis.fetch = async () =>
            new Response(
               new ReadableStream({
                  pull(controller) {
                     controller.enqueue(new Uint8Array(1024 * 1024));
                  },
                  cancel() {
                     cancelled = true;
                  },
               }),
               { headers },
            );
         assert.equal(await service.saveFromUrl("user", "https://provider.test/avatar"), null);
         assert.equal(cancelled, true);
      }
      assert.equal(saved.length, 0);
      globalThis.fetch = async () => new Response(new Uint8Array(2 * 1024 * 1024));
      assert.equal(await service.saveFromUrl("user", "https://provider.test/avatar"), "saved");
      assert.equal(saved[0]!.length, 2 * 1024 * 1024);
      globalThis.fetch = async () => {
         throw new Error("download timed out");
      };
      assert.equal(await service.saveFromUrl("user", "https://provider.test/avatar"), null);
   } finally {
      globalThis.fetch = originalFetch;
   }
});
