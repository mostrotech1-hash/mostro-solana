/**
 * Safety tests for the sponsored "buy $MOST" transaction. Fully offline: the instructions are built from the SDK (PDAs only)
 * and the inspector is pure, so this runs without devnet and spends nothing.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { buildBuyTokensSol, buildBuyTokensExactOutSol, createReadonlyProgram } from "@mostro/shared";
import type { HttpException } from "@nestjs/common";
import type { Env } from "../src/config/env";
import type { OpenfortIdentity, OpenfortService } from "../src/modules/openfort/openfort.service";
import type { SolanaService } from "../src/modules/solana/solana.service";
import { inspectTokenPurchaseTransaction, type TokenPurchaseBuilder } from "../src/modules/solana/token-purchase.builder";
import { BuildTokenPurchaseUseCase } from "../src/use-cases/tokens/tokens.use-cases";
import type { UserRepository } from "../src/use-cases/users/user.repository";

const program = createReadonlyProgram(new Connection("http://127.0.0.1:1"));
const sponsor = Keypair.generate();
const buyer = Keypair.generate();
const TOKENS_OUT = 500_000_000n; // 500 $MOST
const MAX_IN = 123_456_789n;
const expected = { sponsor: sponsor.publicKey, buyer: buyer.publicKey, tokensOut: TOKENS_OUT, maxLamportsIn: MAX_IN };

async function good(overrides: { tokensOut?: bigint; maxLamportsIn?: bigint; payer?: Keypair; buyer?: Keypair } = {}): Promise<Transaction> {
   const ix = await buildBuyTokensExactOutSol(program, {
      buyer: (overrides.buyer ?? buyer).publicKey,
      payer: (overrides.payer ?? sponsor).publicKey,
      curveIndex: 0,
      tokensOut: new BN((overrides.tokensOut ?? TOKENS_OUT).toString()),
      maxLamportsIn: new BN((overrides.maxLamportsIn ?? MAX_IN).toString()),
   });
   const tx = new Transaction({ feePayer: sponsor.publicKey, blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 });
   tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ix.instruction);
   return tx;
}

describe("sponsored buy-$MOST transaction (offline)", () => {
   it("accepts exactly the quoted purchase", async () => {
      inspectTokenPurchaseTransaction(program, await good(), expected);
   });

   it("accepts a limit below the approved ceiling but never above it", async () => {
      inspectTokenPurchaseTransaction(program, await good({ maxLamportsIn: MAX_IN - 1n }), expected);
      await assert.rejects(async () => inspectTokenPurchaseTransaction(program, await good({ maxLamportsIn: MAX_IN + 1n }), expected), /above the approved limit/);
   });

   it("rejects a different fee payer", async () => {
      const tx = await good();
      tx.feePayer = buyer.publicKey;
      assert.throws(() => inspectTokenPurchaseTransaction(program, tx, expected), /fee payer/);
   });

   it("rejects an extra instruction that could spend the sponsor's SOL", async () => {
      const tx = await good();
      tx.add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: buyer.publicKey, lamports: 1_000_000 }));
      assert.throws(() => inspectTokenPurchaseTransaction(program, tx, expected), /unexpected program/);
   });

   it("rejects a second Mostro instruction", async () => {
      const tx = await good();
      const again = await buildBuyTokensExactOutSol(program, { buyer: buyer.publicKey, payer: sponsor.publicKey, curveIndex: 0, tokensOut: 1, maxLamportsIn: 1 });
      tx.add(again.instruction);
      assert.throws(() => inspectTokenPurchaseTransaction(program, tx, expected), /exactly one Mostro instruction/);
   });

   it("rejects a different Mostro instruction (buy_tokens_sol)", async () => {
      const other = await buildBuyTokensSol(program, { buyer: buyer.publicKey, payer: sponsor.publicKey, curveIndex: 0, lamportsIn: MAX_IN, minTokensOut: 1 });
      const tx = new Transaction({ feePayer: sponsor.publicKey, blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 });
      tx.add(other.instruction);
      assert.throws(() => inspectTokenPurchaseTransaction(program, tx, expected), /buy_tokens_exact_out_sol/);
   });

   it("rejects an amount of $MOST that is not the quoted amount", async () => {
      await assert.rejects(async () => inspectTokenPurchaseTransaction(program, await good({ tokensOut: TOKENS_OUT + 1n }), expected), /exactly the quoted amount/);
   });

   it("rejects a transaction signed for a different buyer", async () => {
      await assert.rejects(async () => inspectTokenPurchaseTransaction(program, await good(), { ...expected, buyer: Keypair.generate().publicKey }), /signers are not/);
   });

   it("rejects an instruction whose rent payer is not the sponsor", async () => {
      const tx = await good({ payer: buyer });
      tx.feePayer = sponsor.publicKey;
      assert.throws(() => inspectTokenPurchaseTransaction(program, tx, expected));
   });
});

describe("buying $MOST needs an approved identity check", () => {
   const identity = { openfortId: "usr_buy", loginType: "email", email: null, imageUrl: null } as OpenfortIdentity;
   const untouched = (name: string) => new Proxy({}, { get: () => () => assert.fail(`${name} was used before the KYC check`) });

   it("refuses an unverified user with KYC_REQUIRED before the chain or the signer is touched", async () => {
      const users = { findByOpenfortId: async () => ({ id: "u", kycStatus: "pending" }) } as unknown as UserRepository;
      const useCase = new BuildTokenPurchaseUseCase(
         { KYC_REQUIRED_FOR_PURCHASE: "true" } as Env,
         untouched("openfort") as unknown as OpenfortService,
         users,
         untouched("solana") as unknown as SolanaService,
         untouched("builder") as unknown as TokenPurchaseBuilder,
      );
      await assert.rejects(useCase.execute(identity, { walletAddress: "x", tokens: 10, approvedMaxLamportsIn: "1" }), (error: HttpException) => {
         assert.equal(error.getStatus(), 403);
         assert.equal((error.getResponse() as { code?: string }).code, "KYC_REQUIRED");
         return true;
      });
   });
});
