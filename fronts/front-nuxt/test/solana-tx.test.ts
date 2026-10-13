/** Offline tests of the browser-side transaction checks (nothing is sent). Run: `yarn workspace @app/front-nuxt test` */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import {
   attachBuyerSignature,
   base58Decode,
   base58Encode,
   bytesToBase64,
   normalizeSignature,
   parseLegacyTransaction,
   prepareForSigning,
   transactionId,
} from "../app/utils/solana-tx";
import { formatSol } from "../app/utils/pass";

const sponsor = Keypair.generate();
const buyer = Keypair.generate();
const program = Keypair.generate().publicKey;

function build(extra?: TransactionInstruction) {
   const tx = new Transaction({ feePayer: sponsor.publicKey, blockhash: base58Encode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 1 });
   tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }));
   tx.add(
      new TransactionInstruction({
         programId: program,
         keys: [
            { pubkey: sponsor.publicKey, isSigner: true, isWritable: true },
            { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
         ],
         data: Buffer.from([1, 2, 3]),
      }),
   );
   if (extra) tx.add(extra);
   tx.partialSign(sponsor);
   return tx;
}
const b64 = (tx: Transaction) => bytesToBase64(tx.serialize({ requireAllSignatures: false }));

describe("base58", () => {
   it("round-trips addresses, signatures and leading zeros", () => {
      assert.equal(base58Encode(base58Decode(buyer.publicKey.toBase58())), buyer.publicKey.toBase58());
      assert.equal(base58Encode(base58Decode("11111111111111111111111111111111")), "11111111111111111111111111111111");
      assert.deepEqual([...base58Decode(base58Encode(Uint8Array.from([0, 0, 1, 255])))], [0, 0, 1, 255]);
   });
});

describe("prepareForSigning", () => {
   const input = (tx: Transaction) => ({ transaction: b64(tx), buyerSignatureIndex: 1, walletAddress: buyer.publicKey.toBase58(), allowedPrograms: [program.toBase58()] });

   it("accepts the expected sponsored transaction and reads its parts", () => {
      const { parsed } = prepareForSigning(input(build()));
      assert.equal(parsed.numRequiredSignatures, 2);
      assert.equal(parsed.accountKeys[0], sponsor.publicKey.toBase58());
      assert.equal(parsed.accountKeys[1], buyer.publicKey.toBase58());
   });

   it("matches web3.js's own reading of the message", () => {
      const tx = build();
      const { parsed } = prepareForSigning(input(tx));
      assert.deepEqual([...parsed.message], [...tx.serializeMessage()]);
   });

   it("refuses a transaction for a different wallet", () => {
      assert.throws(() => prepareForSigning({ ...input(build()), walletAddress: Keypair.generate().publicKey.toBase58() }), /not for your wallet/);
   });

   it("refuses a program that is not on the allowlist (e.g. a transfer)", () => {
      const transfer = SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: sponsor.publicKey, lamports: 1 });
      assert.throws(() => prepareForSigning(input(build(transfer))), /unexpected step/);
   });

   it("refuses a transaction the sponsor has not signed", () => {
      const tx = new Transaction({ feePayer: sponsor.publicKey, blockhash: base58Encode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 1 });
      tx.add(
         new TransactionInstruction({
            programId: program,
            keys: [
               { pubkey: sponsor.publicKey, isSigner: true, isWritable: true },
               { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
            ],
            data: Buffer.from([1]),
         }),
      );
      assert.throws(() => prepareForSigning(input(tx)), /not prepared correctly/);
   });

   it("refuses garbage", () => {
      assert.throws(() => parseLegacyTransaction(Uint8Array.from([1, 2, 3])), /Malformed/);
   });
});

describe("buyer signature", () => {
   const tx = build();
   const { raw, parsed } = prepareForSigning({ transaction: b64(tx), buyerSignatureIndex: 1, walletAddress: buyer.publicKey.toBase58(), allowedPrograms: [program.toBase58()] });
   const good = ed25519.sign(parsed.message, buyer.secretKey.slice(0, 32));

   it("is inserted at the buyer's position and produces a transaction the network would accept", () => {
      const signed = attachBuyerSignature(raw, parsed, 1, good, buyer.publicKey.toBase58());
      const rebuilt = Transaction.from(signed);
      assert.ok(rebuilt.verifySignatures(), "both signatures verify");
      assert.equal(transactionId(signed), base58Encode(rebuilt.signatures[0]!.signature!), "id is the fee payer's signature");
   });

   it("refuses a signature from another key or over other bytes", () => {
      const other = Keypair.generate();
      assert.throws(() => attachBuyerSignature(raw, parsed, 1, ed25519.sign(parsed.message, other.secretKey.slice(0, 32)), buyer.publicKey.toBase58()), /does not match/);
      assert.throws(() => attachBuyerSignature(raw, parsed, 1, ed25519.sign(Uint8Array.from([1]), buyer.secretKey.slice(0, 32)), buyer.publicKey.toBase58()), /does not match/);
   });

   it("understands hex, 0x hex, base58, base64 and raw bytes", () => {
      const hex = Buffer.from(good).toString("hex");
      for (const form of [hex, `0x${hex}`, base58Encode(good), Buffer.from(good).toString("base64"), good]) assert.deepEqual([...normalizeSignature(form)], [...good]);
      assert.throws(() => normalizeSignature("nope"), /Unexpected/);
   });
});

describe("formatSol", () => {
   it("rounds up so a price is never understated", () => {
      assert.equal(formatSol("36732965"), "0.0368");
      assert.equal(formatSol("1000000000"), "1");
      assert.equal(formatSol(1_500_000_000n), "1.5");
      assert.equal(formatSol("1"), "0.0001");
   });
});
