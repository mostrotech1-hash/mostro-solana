import type { BuildTokenPurchaseRequest, BuildTokenPurchaseResponse, TokenQuote } from "@mostro/shared/api";
import { submitBuiltTransaction, toPurchaseError, type PurchaseContext } from "~/utils/pass-purchase";

/** Live quote for `tokens` whole $MOST, read from the bonding curve through the API. */
export function fetchTokenQuote(ctx: Pick<PurchaseContext, "api">, tokens: number): Promise<TokenQuote> {
   return ctx.api<TokenQuote>(`/tokens/quote?tokens=${encodeURIComponent(String(tokens))}`);
}

export interface BuyTokensInput {
   /** Whole $MOST to buy. */
   tokens: number;
   /** The `maxLamportsIn` the user saw and confirmed. The API never builds a transaction above it. */
   approvedMaxLamportsIn: string;
}

/**
 * Buys an exact amount of $MOST: the API builds the sponsored transaction, the user's wallet signs it, the browser sends it
 * and waits for the network. Same signing and sending code as the pass purchase. Throws a PurchaseError for anything that
 * did not go through. It never retries by itself after a signature was requested.
 */
export async function buyMostTokens(ctx: PurchaseContext, input: BuyTokensInput): Promise<{ signature: string; status: "confirmed" | "pending" }> {
   let built: BuildTokenPurchaseResponse;
   try {
      const body: BuildTokenPurchaseRequest = { walletAddress: ctx.walletAddress, tokens: input.tokens, approvedMaxLamportsIn: input.approvedMaxLamportsIn };
      built = await ctx.api<BuildTokenPurchaseResponse>("/tokens/buy/build", { method: "POST", body });
   } catch (error) {
      throw toPurchaseError(error);
   }
   return submitBuiltTransaction(ctx, built);
}
