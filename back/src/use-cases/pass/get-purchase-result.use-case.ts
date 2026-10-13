import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { PurchaseResultRequest, PurchaseResultResponse } from "@mostro/shared/api";
import { errorCopy, fetchReceipt } from "@mostro/shared";
import { RateLimiter } from "../../common/api-error";
import { OpenfortService, type OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { accountSlot, instructionCoder, normalizeName } from "../../modules/solana/instruction-coder";
import { SolanaService } from "../../modules/solana/solana.service";
import { requireOwnedWallet } from "./pass-wallet";

const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/**
 * Step 10: success is declared only from the chain. The transaction must be confirmed without an error, must contain
 * `redeem_perk`, and the receipt it created must belong to this wallet and to the demo pass.
 */
@Injectable()
export class GetPurchaseResultUseCase {
   private readonly limiter = new RateLimiter();

   constructor(
      @Inject(OpenfortService) private readonly openfort: OpenfortService,
      @Inject(SolanaService) private readonly solana: SolanaService,
   ) {}

   async execute(identity: OpenfortIdentity, request: PurchaseResultRequest): Promise<PurchaseResultResponse> {
      this.limiter.check(`${identity.openfortId}:result`, 60, 60_000);
      if (!BASE58_SIGNATURE.test(request.signature)) throw new BadRequestException("Invalid transaction signature.");
      const buyer = await requireOwnedWallet(this.openfort, identity, request.walletAddress);
      const state = await this.solana.loadPassState().catch(() => null);

      const tx = await this.solana.connection.getTransaction(request.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) return { status: "pending" };
      if (tx.meta?.err) return { status: "failed", reason: errorCopy({ logs: tx.meta.logMessages ?? [], message: JSON.stringify(tx.meta.err) }) };

      const keys = tx.transaction.message.staticAccountKeys;
      const receiptSlot = accountSlot("redeem_perk", "receipt");
      const buyerSlot = accountSlot("redeem_perk", "buyer");

      for (const ix of tx.transaction.message.compiledInstructions) {
         if (!keys[ix.programIdIndex]?.equals(this.solana.program.programId)) continue;
         const decoded = instructionCoder.decode(Buffer.from(ix.data));
         if (!decoded || normalizeName(decoded.name) !== "redeemperk") continue;

         const accountKeys = ix.accountKeyIndexes.map((i) => keys[i]!);
         const receiptAddress = accountKeys[receiptSlot];
         if (!receiptAddress || !accountKeys[buyerSlot]?.equals(buyer)) return { status: "failed", reason: "The transaction does not belong to this wallet." };

         const receipt = await fetchReceipt(this.solana.program, receiptAddress).catch(() => null);
         if (!receipt) return { status: "failed", reason: "The pass receipt was not created." };
         if (!receipt.buyer.equals(buyer) || (state && !receipt.perk.equals(state.perkAddress))) return { status: "failed", reason: "The receipt does not match this purchase." };

         // The buyer pays only the trade (the sponsor pays the fee and the rent), so the balance change is the real price.
         const buyerIndex = keys.findIndex((key) => key.equals(buyer));
         const pre = BigInt(tx.meta?.preBalances[buyerIndex] ?? 0);
         const post = BigInt(tx.meta?.postBalances[buyerIndex] ?? 0);
         return {
            status: "confirmed",
            signature: request.signature,
            asset: receipt.asset.toBase58(),
            receipt: receiptAddress.toBase58(),
            edition: receipt.edition,
            paidLamports: (pre > post ? pre - post : 0n).toString(),
         };
      }
      return { status: "failed", reason: "This transaction is not a pass purchase." };
   }
}
