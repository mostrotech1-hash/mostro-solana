import { BN } from "@coral-xyz/anchor";
import { Inject, Injectable } from "@nestjs/common";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { buildBuyTokensExactOutSol, buildRedeemPerk, type MostroProgram } from "@mostro/shared";
import { instructionCoder, normalizeName } from "./instruction-coder";
import { DEMO_PASS, SolanaService, type PassState } from "./solana.service";

/** Largest legacy transaction the network accepts. */
export const MAX_TRANSACTION_BYTES = 1232;

export interface BuiltPurchase {
   transaction: Transaction;
   serialized: Buffer;
   buyerSignatureIndex: number;
   blockhash: string;
   lastValidBlockHeight: number;
   asset: PublicKey;
   receipt: PublicKey;
}

/**
 * Checks, from the compiled transaction itself, that it is exactly the sponsored demo purchase and nothing else:
 * sponsor = fee payer and `payer` of both program instructions, buyer = the only other signer, and the program
 * instructions are `buy_tokens_exact_out_sol` (exactly the pass price, never above the approved limit) then
 * `redeem_perk`. `buy_tokens_usdc` (or anything else) makes it throw. This is what stops the backend from
 * being an unrestricted signing service. Pure: no network.
 */
export function inspectPurchaseTransaction(
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
   if (programIxs.length !== 2) fail("expected exactly two Mostro instructions");

   const [buyIx, redeemIx] = programIxs as [(typeof programIxs)[number], (typeof programIxs)[number]];
   const buy = instructionCoder.decode(buyIx.data);
   const redeem = instructionCoder.decode(redeemIx.data);
   if (!buy || normalizeName(buy.name) !== "buytokensexactoutsol") fail("the first instruction is not buy_tokens_exact_out_sol");
   if (!redeem || normalizeName(redeem.name) !== "redeemperk") fail("the second instruction is not redeem_perk");

   for (const ix of [buyIx, redeemIx]) {
      const [payer, buyer] = ix.keys;
      if (!payer?.pubkey.equals(expected.sponsor) || !payer.isSigner) fail("the sponsor is not the payer of an instruction");
      if (!buyer?.pubkey.equals(expected.buyer) || !buyer.isSigner) fail("the buyer is not the user signer of an instruction");
   }

   const buyData = buy!.data as Record<string, BN>;
   const redeemData = redeem!.data as Record<string, BN>;
   const tokensOut = BigInt((buyData.tokensOut ?? buyData.tokens_out)!.toString());
   const maxLamportsIn = BigInt((buyData.maxLamportsIn ?? buyData.max_lamports_in)!.toString());
   const maxPaid = BigInt((redeemData.maxPaid ?? redeemData.max_paid)!.toString());
   if (tokensOut !== expected.tokensOut) fail("the amount of $MOST is not exactly the pass price");
   if (maxLamportsIn > expected.maxLamportsIn) fail("the SOL limit is above the approved limit");
   if (maxPaid !== expected.tokensOut) fail("max_paid is not the pass price");

   const size = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
   if (size > MAX_TRANSACTION_BYTES) fail(`the transaction is ${size} bytes`);
}

/** Builds the ONE atomic transaction: compute budget, buy exactly the pass price in $MOST, redeem the pass. Sponsor-signed. */
@Injectable()
export class PurchaseTransactionBuilder {
   constructor(@Inject(SolanaService) private readonly solana: SolanaService) {}

   async build(input: { buyer: PublicKey; state: PassState; maxLamportsIn: BN }): Promise<BuiltPurchase> {
      const { buyer, state, maxLamportsIn } = input;
      const { program } = this.solana;
      const sponsor = this.solana.sponsor();

      // Same SDK builders as the reference scripts. The sponsor is `payer` of both instructions; the buyer pays only the trade.
      const buy = await buildBuyTokensExactOutSol(program, { buyer, payer: sponsor.publicKey, curveIndex: DEMO_PASS.curveIndex, tokensOut: state.perk.priceTokens, maxLamportsIn });
      const redeem = await buildRedeemPerk(program, {
         buyer,
         payer: sponsor.publicKey,
         artistIndex: DEMO_PASS.artistIndex,
         perkIndex: DEMO_PASS.perkIndex,
         curveIndex: DEMO_PASS.curveIndex,
         maxPaid: state.perk.priceTokens,
         collection: state.perk.collection,
      });

      // The blockhash is the very last network call: build, sign and return straight away (it is valid for about 60 seconds).
      const { blockhash, lastValidBlockHeight } = await this.solana.connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: sponsor.publicKey, blockhash, lastValidBlockHeight });
      transaction.add(
         ComputeBudgetProgram.setComputeUnitLimit({ units: DEMO_PASS.computeUnits }),
         ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
         buy.instruction,
         redeem.instruction,
      );

      inspectPurchaseTransaction(program, transaction, {
         sponsor: sponsor.publicKey,
         buyer,
         tokensOut: BigInt(state.perk.priceTokens.toString()),
         maxLamportsIn: BigInt(maxLamportsIn.toString()),
      });

      transaction.partialSign(sponsor);
      const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      const buyerSignatureIndex = transaction.compileMessage().accountKeys.findIndex((key) => key.equals(buyer));

      return { transaction, serialized, buyerSignatureIndex, blockhash, lastValidBlockHeight, asset: redeem.derived.asset, receipt: redeem.derived.receipt };
   }
}
