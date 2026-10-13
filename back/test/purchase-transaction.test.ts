/**
 * Safety tests for the sponsored pass purchase. They read the LIVE devnet state (curve, perk, config) through the
 * public RPC but never send a transaction and spend nothing.  Run: `yarn workspace @mostro/back test`
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { buildBuyTokensUsdc, buildRedeemPerk, quoteBuyExactOut } from "@mostro/shared";
import devnet from "@mostro/shared/addresses/devnet";
import { loadEnv } from "../src/config/env";
import { PurchaseTransactionBuilder, inspectPurchaseTransaction, MAX_TRANSACTION_BYTES } from "../src/modules/solana/purchase-transaction.builder";
import { instructionCoder, normalizeName } from "../src/modules/solana/instruction-coder";
import { DEMO_PASS, SolanaService, type PassState } from "../src/modules/solana/solana.service";

const sponsor = Keypair.generate();
const buyer = Keypair.generate();
const env = loadEnv({ DATABASE_URL: "unused", SPONSOR_SECRET_KEY: JSON.stringify(Array.from(sponsor.secretKey)) } as NodeJS.ProcessEnv);

describe("sponsored pass purchase (live devnet state, nothing is sent)", () => {
   const solana = new SolanaService(env);
   const builder = new PurchaseTransactionBuilder(solana);
   let state: PassState;
   let maxLamportsIn: BN;

   before(async () => {
      state = await solana.loadPassState();
      maxLamportsIn = new BN(state.quote.maxLamportsIn);
   });

   it("is on Solana devnet with the program from shared/addresses/devnet.json", async () => {
      await solana.ensureDevnet();
      assert.equal(solana.program.programId.toBase58(), devnet.programId);
      assert.equal(solana.connection.rpcEndpoint, "https://api.devnet.solana.com");
   });

   it("selects artist #0, perk #0: MoOG Pass Standard, exactly 1,200 $MOST", () => {
      assert.equal(state.perkAddress.toBase58(), devnet.artists[0]!.perks[0]!.perk);
      assert.equal(state.perk.name, "MoOG Pass Standard");
      assert.equal(state.quote.pass.priceMost, "1200000000");
      assert.equal(state.quote.tokensOut, "1200000000");
      assert.equal(DEMO_PASS.perkIndex, 0);
   });

   it("quotes the SOL price from the live curve, not a fixed value", () => {
      const expected = quoteBuyExactOut(state.curve.virtualSolReserves, state.curve.virtualTokenReserves, new BN("1200000000"), state.config.feeBps);
      assert.equal(state.quote.lamportsTotal, expected.totalIn.toString());
      assert.notEqual(state.quote.lamportsTotal, "500000000", "must not be the old 0.5 SOL placeholder");
      // About 1% tolerance on top of the quote.
      const total = BigInt(state.quote.lamportsTotal);
      assert.equal(BigInt(state.quote.maxLamportsIn), (total * 10_100n + 9_999n) / 10_000n);
   });

   it("builds ONE sponsored transaction: compute budget, buy exact $MOST, redeem; sponsor pays", async () => {
      const built = await builder.build({ buyer: buyer.publicKey, state, maxLamportsIn, kyc: false });
      const tx = built.transaction;

      assert.ok(tx.feePayer?.equals(sponsor.publicKey), "sponsor is the fee payer");
      const message = tx.compileMessage();
      assert.equal(message.header.numRequiredSignatures, 2, "only the sponsor and the buyer sign");
      assert.ok(message.accountKeys[0]!.equals(sponsor.publicKey));
      assert.ok(message.accountKeys[1]!.equals(buyer.publicKey));
      assert.equal(built.buyerSignatureIndex, 1);

      assert.ok(tx.instructions[0]!.programId.equals(ComputeBudgetProgram.programId), "compute budget first");
      const programIxs = tx.instructions.filter((ix) => ix.programId.equals(solana.program.programId));
      assert.equal(programIxs.length, 2);
      const names = programIxs.map((ix) => normalizeName(instructionCoder.decode(ix.data)!.name));
      assert.deepEqual(names, ["buytokensexactoutsol", "redeemperk"], "buy then redeem, never the USDC instruction");
      for (const ix of programIxs) {
         assert.ok(ix.keys[0]!.pubkey.equals(sponsor.publicKey) && ix.keys[0]!.isSigner, "sponsor is payer");
         assert.ok(ix.keys[1]!.pubkey.equals(buyer.publicKey) && ix.keys[1]!.isSigner, "buyer is the user signer");
      }

      const limit = tx.instructions[0]!.data; // SetComputeUnitLimit: instruction 2 + u32 units
      assert.equal(limit.readUInt32LE(1), 250_000);

      assert.ok(built.serialized.length <= MAX_TRANSACTION_BYTES, `size ${built.serialized.length}`);
      // Sponsor signature present, buyer signature still missing (the Openfort wallet adds it).
      const rebuilt = Transaction.from(built.serialized);
      assert.ok(rebuilt.signatures[0]!.signature, "sponsor signed");
      assert.equal(rebuilt.signatures[1]!.signature, null, "buyer has not signed");
   });

   it("includes a recent blockhash that is fresh", async () => {
      const built = await builder.build({ buyer: buyer.publicKey, state, maxLamportsIn, kyc: false });
      const height = await solana.connection.getBlockHeight("confirmed");
      assert.ok(built.lastValidBlockHeight >= height, "blockhash is still valid");
      assert.ok(built.lastValidBlockHeight - height <= 152, "blockhash was just fetched");
   });

   describe("refuses anything that is not exactly this purchase", () => {
      const pass = () => ({ sponsor: sponsor.publicKey, buyer: buyer.publicKey, tokensOut: 1_200_000_000n, maxLamportsIn: BigInt(state.quote.maxLamportsIn) });
      const fresh = async () => (await builder.build({ buyer: buyer.publicKey, state, maxLamportsIn, kyc: false })).transaction;

      it("accepts the real transaction", async () => {
         inspectPurchaseTransaction(solana.program, await fresh(), pass());
      });

      it("rejects a different fee payer", async () => {
         const tx = await fresh();
         tx.feePayer = buyer.publicKey;
         assert.throws(() => inspectPurchaseTransaction(solana.program, tx, pass()), /fee payer/);
      });

      it("rejects an extra instruction that could spend the sponsor's SOL", async () => {
         const tx = await fresh();
         tx.add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: buyer.publicKey, lamports: 1_000_000 }));
         assert.throws(() => inspectPurchaseTransaction(solana.program, tx, pass()), /unexpected program/);
      });

      it("rejects the USDC buy instruction", async () => {
         const usdc = await buildBuyTokensUsdc(solana.program, {
            buyer: buyer.publicKey,
            payer: sponsor.publicKey,
            curveIndex: 0,
            usdcIn: 1_000_000,
            minTokensOut: 1,
            usdcMint: state.config.usdcMint,
            priceUpdate: state.config.pythSolUsdAccount,
         });
         const redeem = await buildRedeemPerk(solana.program, {
            buyer: buyer.publicKey,
            payer: sponsor.publicKey,
            artistIndex: 0,
            perkIndex: 0,
            curveIndex: 0,
            maxPaid: state.perk.price,
            collection: state.perk.collection,
         });
         const tx = new Transaction({ feePayer: sponsor.publicKey, blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 });
         tx.add(usdc.instruction, redeem.instruction);
         assert.throws(() => inspectPurchaseTransaction(solana.program, tx, pass()), /buy_tokens_exact_out_sol/);
      });

      it("rejects a SOL limit above what the user approved", async () => {
         const tx = await fresh();
         assert.throws(() => inspectPurchaseTransaction(solana.program, tx, { ...pass(), maxLamportsIn: BigInt(state.quote.maxLamportsIn) - 1n }), /above the approved limit/);
      });

      it("rejects an amount of $MOST that is not the pass price", async () => {
         const tx = await fresh();
         assert.throws(() => inspectPurchaseTransaction(solana.program, tx, { ...pass(), tokensOut: 1_199_999_999n }), /exactly the pass price/);
      });

      it("rejects a transaction signed for a different buyer", async () => {
         const tx = await fresh();
         assert.throws(() => inspectPurchaseTransaction(solana.program, tx, { ...pass(), buyer: Keypair.generate().publicKey }), /signers are not/);
      });
   });
});

describe("front-end error table", () => {
   it("matches the program IDL (so the front maps the right codes)", async () => {
      const { MOSTRO_ERROR_CODES } = await import("@mostro/shared/api");
      const { MostroErrorCode } = await import("@mostro/shared");
      for (const [name, code] of Object.entries(MOSTRO_ERROR_CODES)) assert.equal(MostroErrorCode[name], code, name);
   });
});
