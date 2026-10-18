import { BN } from "@coral-xyz/anchor";
import { Inject, Injectable } from "@nestjs/common";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { buildBuyTokensExactOutSol, type MostroProgram } from "@mostro/shared";
import { instructionCoder, normalizeName } from "./instruction-coder";
import { MAX_TRANSACTION_BYTES } from "./purchase-transaction.builder";
import { DEMO_PASS, SolanaService } from "./solana.service";

export interface BuiltTokenPurchase {
   transaction: Transaction;
   serialized: Buffer;
   buyerSignatureIndex: number;
   blockhash: string;
   lastValidBlockHeight: number;
}

/**
 * Checks, from the compiled transaction itself, that it is exactly "buy this many $MOST" and nothing else: sponsor = fee payer
 * and `payer` of the instruction, buyer = the only other signer, and the only Mostro instruction is `buy_tokens_exact_out_sol`
 * for exactly the quoted amount and never above the approved limit. Anything else makes it throw. This is what stops the
 * backend from being an unrestricted signing service. Pure: no network.
 */
export function inspectTokenPurchaseTransaction(
   program: MostroProgram,
   tx: Transaction,
   expected: { sponsor: PublicKey; buyer: PublicKey; tokensOut: bigint; maxLamportsIn: bigint },
): void {
   const fail = (why: string): never => {
      throw new Error(`Refusing to sign: ${why}`);
   };
   if (!tx.feePayer?.equals(expected.sponsor)) fail("the sponsor is not the fee payer");

   const message = tx.compileMessage();
   if (message.header.numRequiredSignatures !== 2) fail("the transaction needs a signer other than the sponsor and the buyer");
   const signers = message.accountKeys.slice(0, 2);
   if (!signers[0]?.equals(expected.sponsor) || !signers[1]?.equals(expected.buyer)) fail("the signers are not the sponsor and the buyer");

   const programIxs = [];
   for (const ix of tx.instructions) {
      if (ix.programId.equals(ComputeBudgetProgram.programId)) continue;
      if (!ix.programId.equals(program.programId)) fail(`unexpected program ${ix.programId.toBase58()}`);
      programIxs.push(ix);
   }
   if (programIxs.length !== 1) fail("expected exactly one Mostro instruction");

   const buyIx = programIxs[0]!;
   const buy = instructionCoder.decode(buyIx.data);
   if (!buy || normalizeName(buy.name) !== "buytokensexactoutsol") fail("the instruction is not buy_tokens_exact_out_sol");

   const [payer, buyer] = buyIx.keys;
   if (!payer?.pubkey.equals(expected.sponsor) || !payer.isSigner) fail("the sponsor is not the payer of the instruction");
   if (!buyer?.pubkey.equals(expected.buyer) || !buyer.isSigner) fail("the buyer is not the user signer of the instruction");

   const data = buy!.data as Record<string, BN>;
   const tokensOut = BigInt((data.tokensOut ?? data.tokens_out)!.toString());
   const maxLamportsIn = BigInt((data.maxLamportsIn ?? data.max_lamports_in)!.toString());
   if (tokensOut !== expected.tokensOut) fail("the amount of $MOST is not exactly the quoted amount");
   if (maxLamportsIn > expected.maxLamportsIn) fail("the SOL limit is above the approved limit");

   const size = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
   if (size > MAX_TRANSACTION_BYTES) fail(`the transaction is ${size} bytes`);
}

/** Builds the sponsor-signed "buy $MOST" transaction: compute budget, then `buy_tokens_exact_out_sol`. */
@Injectable()
export class TokenPurchaseBuilder {
   constructor(@Inject(SolanaService) private readonly solana: SolanaService) {}

   async build(input: { buyer: PublicKey; tokensOut: BN; maxLamportsIn: BN }): Promise<BuiltTokenPurchase> {
      const { buyer, tokensOut, maxLamportsIn } = input;
      const { program } = this.solana;
      const sponsor = this.solana.sponsor();

      const buy = await buildBuyTokensExactOutSol(program, { buyer, payer: sponsor.publicKey, curveIndex: DEMO_PASS.curveIndex, tokensOut, maxLamportsIn });

      // The blockhash is the very last network call: build, sign and return straight away (it is valid for about 60 seconds).
      const { blockhash, lastValidBlockHeight } = await this.solana.connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: sponsor.publicKey, blockhash, lastValidBlockHeight });
      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }), buy.instruction);

      inspectTokenPurchaseTransaction(program, transaction, {
         sponsor: sponsor.publicKey,
         buyer,
         tokensOut: BigInt(tokensOut.toString()),
         maxLamportsIn: BigInt(maxLamportsIn.toString()),
      });

      transaction.partialSign(sponsor);
      const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      const buyerSignatureIndex = transaction.compileMessage().accountKeys.findIndex((key) => key.equals(buyer));
      return { transaction, serialized, buyerSignatureIndex, blockhash, lastValidBlockHeight };
   }
}
