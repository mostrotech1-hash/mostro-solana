/**
 * The hook for the blockchain task. The purchase has two steps:
 *   1. The user pays by card with MoonPay; the SOL arrives in their Mostro wallet (done, see MoonpayModal).
 *   2. The app then uses that SOL to mint the pass through the bonding curve, automatically (NOT connected yet).
 *
 * The screens already follow this contract, so connecting the blockchain means filling in the two functions below:
 *   - `mintPassWithSol` runs once when the "Getting your pass…" screen (H05) opens.
 *   - `getMintStatus` is polled on the "Still working on it" screen (H09) until the mint is confirmed or has failed.
 * Return `confirmed` and the app shows the success screen (H06), `failed` and it shows the cancelled screen (H08) with
 * the reason, `pending` and it waits (H05, then H09 after about 30 seconds).
 */
export type MintResult =
   | { status: "confirmed"; signature: string; passNumber: string }
   | { status: "failed"; reason: string }
   /** Sent but not confirmed yet. */
   | { status: "pending"; signature?: string };

export interface MintInput {
   /** The user's Solana wallet that now holds the SOL. */
   walletAddress: string;
   priceSol: number;
}

export async function mintPassWithSol(input: MintInput): Promise<MintResult> {
   // TODO(blockchain task): sign and send `redeem_perk` for the pass with the user's Mostro wallet (Openfort),
   // using the SOL bought with the card, then return the transaction signature when it is confirmed.
   void input;
   return { status: "pending" };
}

export async function getMintStatus(signature?: string): Promise<MintResult> {
   // TODO(blockchain task): look up the transaction (signature) on Solana and map it to a MintResult.
   void signature;
   return { status: "pending" };
}
