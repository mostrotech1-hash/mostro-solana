import type { Openfort } from "@openfort/openfort-js";
import devnet from "@mostro/shared/addresses/devnet";
import type {
   BuildPurchaseRequest,
   BuildPurchaseResponse,
   DevnetTopupRequest,
   DevnetTopupResponse,
   PassQuote,
   PurchaseResultRequest,
   PurchaseResultResponse,
} from "@mostro/shared/api";
import { ApiRequestError } from "~/utils/api";
import { RpcError, getBlockHeight, getSignatureStatus, describeTransactionError, sendTransaction } from "~/utils/solana-rpc";
import { attachBuyerSignature, bytesToBase64, normalizeSignature, prepareForSigning, transactionId, verifySignature } from "~/utils/solana-tx";

/**
 * The pass purchase on Solana devnet, in one atomic transaction (buy exactly 1,200 $MOST on the bonding curve and redeem
 * the pass). The Mostro API builds it and signs as sponsor (pays the fee and the rent); the user's Openfort wallet signs
 * as the buyer; the browser sends it to devnet. Success is shown only after the chain confirms it AND the API verifies
 * the redemption (`/pass/purchase/result`).
 *
 * The screens follow this contract:
 *   - `mintPassWithSol` runs once when the "Getting your pass…" screen (H05) opens.
 *   - `getMintStatus` is polled on the "Still working on it" screen (H09) until the purchase is confirmed or failed.
 */
export type MintResult =
   | { status: "confirmed"; signature: string; passNumber: string; asset: string; paidLamports: string }
   | { status: "failed"; reason: string }
   /** Sent but not confirmed yet. */
   | { status: "pending"; signature?: string };

export type PurchaseFailure = "quote_changed" | "insufficient_funds" | "slippage" | "expired" | "rejected" | "rpc" | "wallet" | "unavailable" | "kyc_required" | "failed";

/** A purchase step that did not go through, with a message that is safe to show to the user. */
export class PurchaseError extends Error {
   constructor(
      message: string,
      readonly kind: PurchaseFailure,
      /** On quote_changed / slippage: the price to review before trying again. */
      readonly quote?: PassQuote,
   ) {
      super(message);
   }
}

/** What the flow needs from the app (kept as arguments so the logic is plain and testable). */
export interface PurchaseContext {
   openfort: Openfort;
   rpcUrl: string;
   walletAddress: string;
   api: <T>(path: string, options?: { method?: "GET" | "POST"; body?: unknown }) => Promise<T>;
   /** Called as soon as the transaction is sent, so a reload or the slow screen can keep checking it. */
   onSubmitted?: (signature: string) => void;
}

export interface MintInput {
   /** The `maxLamportsIn` the user saw and confirmed. The API never builds a transaction above it. */
   approvedMaxLamportsIn: string;
}

const SIGN_ATTEMPTS: { hashMessage?: boolean; arrayifyMessage?: boolean }[] = [{ hashMessage: false, arrayifyMessage: false }, { hashMessage: false }, {}];
const CONFIRM_POLL_MS = 1500;
const CONFIRM_TIMEOUT_MS = 90_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks the Openfort Solana wallet to sign the transaction message, and returns a signature that has been verified. */
async function signWithOpenfort(ctx: PurchaseContext, message: Uint8Array): Promise<Uint8Array> {
   let lastError: unknown;
   for (const options of SIGN_ATTEMPTS) {
      try {
         const raw = (await ctx.openfort.embeddedWallet.signMessage(message, options)) as string | Uint8Array;
         const signature = normalizeSignature(raw);
         if (verifySignature(signature, message, ctx.walletAddress)) return signature;
         lastError = new Error("signature did not verify");
      } catch (error) {
         lastError = error;
      }
   }
   console.error("[mostro] the wallet could not sign the purchase", lastError);
   const text = lastError instanceof Error ? lastError.message.toLowerCase() : "";
   if (text.includes("reject") || text.includes("denied") || text.includes("cancel")) throw new PurchaseError("You declined the signature, so nothing was bought.", "rejected");
   throw new PurchaseError("Your wallet could not sign the purchase. Nothing was bought. Please sign in again and try once more.", "wallet");
}

async function build(ctx: PurchaseContext, approvedMaxLamportsIn: string): Promise<BuildPurchaseResponse> {
   const body: BuildPurchaseRequest = { walletAddress: ctx.walletAddress, approvedMaxLamportsIn };
   try {
      return await ctx.api<BuildPurchaseResponse>("/pass/purchase/build", { method: "POST", body });
   } catch (error) {
      if (!(error instanceof ApiRequestError)) throw error;
      if (error.code === "QUOTE_CHANGED")
         throw new PurchaseError("The price moved while you were confirming. Review the new price and confirm again.", "quote_changed", error.data?.quote);
      if (error.code === "PASS_PRICE_CHANGED") throw new PurchaseError("The pass changed. Please review it again.", "quote_changed");
      if (error.code === "INSUFFICIENT_SOL") throw new PurchaseError("Your wallet does not have enough SOL for this purchase.", "insufficient_funds");
      if (error.code === "SPONSOR_UNAVAILABLE") throw new PurchaseError("Purchases are temporarily unavailable. Please try again later.", "unavailable");
      if (error.code === "KYC_REQUIRED") throw new PurchaseError("Verify your identity before buying.", "kyc_required");
      if (error.code === "RATE_LIMITED") throw new PurchaseError("Too many attempts. Please wait a moment and try again.", "unavailable");
      throw new PurchaseError(error.message, "failed");
   }
}

/** Devnet only: asks the API to top up the wallet with test SOL when the card payment delivered less than needed. */
async function topUp(ctx: PurchaseContext): Promise<boolean> {
   const body: DevnetTopupRequest = { walletAddress: ctx.walletAddress };
   try {
      const result = await ctx.api<DevnetTopupResponse>("/pass/devnet-topup", { method: "POST", body });
      return result.signature !== null;
   } catch (error) {
      console.warn("[mostro] devnet top-up not available", error);
      return false;
   }
}

/** Waits until the transaction is confirmed. Resolves "pending" when it is still unknown after a while (never a failure). */
async function waitForConfirmation(ctx: PurchaseContext, signature: string, lastValidBlockHeight: number): Promise<"confirmed" | "pending"> {
   const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
   while (Date.now() < deadline) {
      const status = await getSignatureStatus(ctx.rpcUrl, signature).catch(() => null);
      if (status?.err) throw new PurchaseError(describeTransactionError(status.err), "failed");
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return "confirmed";
      // The blockhash is only valid for a while. Once it is past and the transaction is unknown, it can never land.
      const height = await getBlockHeight(ctx.rpcUrl).catch(() => null);
      if (height !== null && height > lastValidBlockHeight && !status) {
         const last = await getSignatureStatus(ctx.rpcUrl, signature).catch(() => null);
         if (!last) throw new PurchaseError("The purchase expired before the network confirmed it. You were not charged. Please try again.", "expired");
      }
      await sleep(CONFIRM_POLL_MS);
   }
   return "pending";
}

export function toMintResult(result: PurchaseResultResponse, signature: string): MintResult {
   if (result.status === "confirmed") return { status: "confirmed", signature, passNumber: `#${result.edition}`, asset: result.asset, paidLamports: result.paidLamports };
   if (result.status === "failed") return { status: "failed", reason: result.reason };
   return { status: "pending", signature };
}

/** Success only if the chain confirms the transaction AND the API finds the redeemed pass. */
export async function getMintStatus(ctx: Pick<PurchaseContext, "api" | "walletAddress">, signature?: string): Promise<MintResult> {
   if (!signature) return { status: "pending" };
   const body: PurchaseResultRequest = { walletAddress: ctx.walletAddress, signature };
   return toMintResult(await ctx.api<PurchaseResultResponse>("/pass/purchase/result", { method: "POST", body }), signature);
}

/**
 * Builds, signs, sends and confirms the purchase. Throws a PurchaseError for anything that did not go through.
 * It never retries by itself after a signature was requested: a second signature is always a second user decision.
 */
export async function mintPassWithSol(ctx: PurchaseContext, input: MintInput): Promise<MintResult> {
   let built: BuildPurchaseResponse;
   try {
      built = await build(ctx, input.approvedMaxLamportsIn);
   } catch (error) {
      // The card payment may have delivered less SOL than needed (the sandbox pays out a fraction): top up once on devnet.
      if (error instanceof PurchaseError && error.kind === "insufficient_funds" && (await topUp(ctx))) built = await build(ctx, input.approvedMaxLamportsIn);
      else throw error;
   }

   const { raw, parsed } = (() => {
      try {
         return prepareForSigning({
            transaction: built.transaction,
            buyerSignatureIndex: built.buyerSignatureIndex,
            walletAddress: ctx.walletAddress,
            allowedPrograms: [devnet.programId],
         });
      } catch (error) {
         throw new PurchaseError(error instanceof Error ? error.message : "The purchase could not be checked.", "failed");
      }
   })();

   const height = await getBlockHeight(ctx.rpcUrl).catch(() => null);
   if (height !== null && height >= built.lastValidBlockHeight) throw new PurchaseError("The purchase expired before it was signed. Please try again.", "expired");

   const buyerSignature = await signWithOpenfort(ctx, parsed.message);
   const signed = attachBuyerSignature(raw, parsed, built.buyerSignatureIndex, buyerSignature, ctx.walletAddress);
   const signature = transactionId(signed);

   try {
      const sent = await sendTransaction(ctx.rpcUrl, bytesToBase64(signed));
      if (sent !== signature) console.warn("[mostro] the network returned a different transaction id", sent, signature);
   } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      if (error.programCode === 6005) throw new PurchaseError("The price moved. Review the new price and confirm again.", "slippage");
      // The network said no: it was not sent. If it could not even be reached, the transaction may still have landed,
      // so keep watching it (the wait ends with "expired" when its blockhash runs out) instead of sending again.
      if (error.rejected) throw new PurchaseError(error.message, "failed");
   }
   ctx.onSubmitted?.(signature);

   if ((await waitForConfirmation(ctx, signature, built.lastValidBlockHeight)) === "pending") return { status: "pending", signature };
   return getMintStatus(ctx, signature);
}
