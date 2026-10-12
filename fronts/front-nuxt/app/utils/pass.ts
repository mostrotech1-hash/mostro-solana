/**
 * Hardcoded hackathon pass, as in the Figma screens (H03 to H06). Names, price and supply are the design's
 * placeholders. TODO(blockchain task): read supply, sold count and the wallet balance from the chain.
 */
export const PASS = {
   name: "MoOG Pass · Solana Edition",
   edition: "Hackathon edition",
   description: "Your Mostro membership, minted on Solana for the hackathon. Limit one per person.",
   priceSol: 0.5,
   priceUsd: 72,
   networkFeeSol: 0.000005,
   networkFeeUsd: 0.001,
   supply: 500,
   left: 312,
   perks: [
      { label: "Members-only Discord channel", value: "Included" },
      { label: "Early access to new drops", value: "24 hours early" },
      { label: "Collectibles on Solana", value: "Added to your wallet" },
   ],
   steps: [
      { label: "1 · You pay in SOL", value: "From your Mostro wallet" },
      { label: "2 · Pass is minted to your wallet", value: "Takes a few seconds" },
      { label: "3 · Find it in My Perks", value: "Ready to use" },
   ],
} as const;

/** Placeholder numbers shown until the wallet is read from the chain. */
export const PLACEHOLDER_WALLET_BALANCE_SOL = 1.2;
export const PLACEHOLDER_PASS_NUMBER = "#0189 of 500";

export function shortAddress(address: string): string {
   return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-3)}` : address;
}
