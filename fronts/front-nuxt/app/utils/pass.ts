import type { PassQuote } from "@mostro/shared/api";

/**
 * Copy of the pass, as in the Figma screens (H03 to H06). The price, supply and balance are NOT here: they are read
 * live (price from the bonding curve through the API, balance from Solana devnet).
 */
export const PASS = {
   name: "MoOG Pass · Solana Edition",
   edition: "Hackathon edition",
   description: "Your Mostro membership, minted on Solana for the hackathon. Limit one per person.",
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

/** The least SOL a wallet account keeps after a trade (rent-exempt minimum of a system account). */
export const WALLET_RENT_FLOOR_LAMPORTS = 890_880n;

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Lamports to a SOL string with up to `decimals` digits, rounded UP so a price is never understated. */
export function formatSol(lamports: bigint | string, decimals = 4): string {
   const value = BigInt(lamports);
   const scale = 10n ** BigInt(9 - decimals);
   const rounded = (value + scale - 1n) / scale;
   const whole = rounded / 10n ** BigInt(decimals);
   const fraction = (rounded % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
   return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/** Rough dollar value, only when the program publishes its own SOL price. */
export function formatUsd(lamports: bigint | string, quote: { usdPerSolE6: string | null } | null): string | null {
   if (!quote?.usdPerSolE6) return null;
   const cents = (BigInt(lamports) * BigInt(quote.usdPerSolE6) * 100n) / (LAMPORTS_PER_SOL * 1_000_000n);
   const dollars = Number(cents) / 100;
   return dollars < 0.01 ? "< $0.01" : `$${dollars.toFixed(2)}`;
}

/** What the wallet must hold: the approved ceiling plus the rent floor the account keeps. */
export function requiredLamports(quote: PassQuote): bigint {
   return BigInt(quote.maxLamportsIn) + WALLET_RENT_FLOOR_LAMPORTS;
}

export function passesLeft(quote: PassQuote | null): number | null {
   if (!quote || quote.pass.maxSupply === 0) return null;
   return Math.max(quote.pass.maxSupply - quote.pass.sold, 0);
}

export function shortAddress(address: string): string {
   return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-3)}` : address;
}

/** Token base units to a readable amount, e.g. 1234500000n (6 decimals) -> "1,234.5". Rounded down: a balance is never overstated. */
export function formatTokens(baseUnits: bigint, decimals = 6, shown = 2): string {
   const scale = 10n ** BigInt(decimals - shown);
   const cut = baseUnits / scale;
   const whole = cut / 10n ** BigInt(shown);
   const fraction = (cut % 10n ** BigInt(shown)).toString().padStart(shown, "0").replace(/0+$/, "");
   return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** A price in SOL. Tiny prices keep 6 decimals (0.000096, not a rounded-up 0.0001); everything else shows 4. Rounded up, like `formatSol`. */
export function formatSolPrice(lamports: bigint | string): string {
   return formatSol(lamports, BigInt(lamports) < 1_000_000n ? 6 : 4);
}
