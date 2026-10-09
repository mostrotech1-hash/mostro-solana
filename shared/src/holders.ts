import { Connection, ParsedAccountData, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface Holder {
   /** Token account address. */
   tokenAccount: PublicKey;
   /** Wallet that owns the token account. */
   owner: PublicKey;
   /** Raw base units. */
   amount: BN;
   /** Human amount (decimals applied). */
   uiAmount: number;
   /** Share of the summed listed balances, in basis points. */
   shareBps: number;
}

/**
 * Top holders of `mint` via `getTokenLargestAccounts` (max 20 accounts, RPC-sorted) resolved to owners
 * with `getMultipleParsedAccounts`. `exclude` may contain owners (curve vaults: rewards, artist) or
 * token accounts; both are matched. For the full holder list use a DAS provider (Helius
 * `getTokenAccounts`) and sort client-side.
 */
export async function topHolders(connection: Connection, mint: PublicKey, exclude: PublicKey[] = [], limit = 20): Promise<Holder[]> {
   const largest = await connection.getTokenLargestAccounts(mint, "confirmed");
   const pairs = largest.value.filter((p) => p.amount !== "0");
   if (pairs.length === 0) return [];
   const infos = await connection.getMultipleParsedAccounts(
      pairs.map((p) => p.address),
      { commitment: "confirmed" },
   );
   const excluded = new Set(exclude.map((k) => k.toBase58()));
   const rows: Holder[] = [];
   infos.value.forEach((info, i) => {
      const pair = pairs[i];
      if (!info || !("parsed" in (info.data as object))) return;
      const parsed = (info.data as ParsedAccountData).parsed as {
         type?: string;
         info?: { owner?: string; tokenAmount?: { amount: string; uiAmount: number | null; decimals: number } };
      };
      const ownerStr = parsed?.info?.owner;
      if (!ownerStr) return;
      if (excluded.has(ownerStr) || excluded.has(pair.address.toBase58())) return;
      const amount = new BN(parsed.info?.tokenAmount?.amount ?? pair.amount);
      const uiAmount = parsed.info?.tokenAmount?.uiAmount ?? pair.uiAmount ?? Number(amount.toString()) / Math.pow(10, pair.decimals);
      rows.push({ tokenAccount: pair.address, owner: new PublicKey(ownerStr), amount, uiAmount, shareBps: 0 });
   });
   rows.sort((a, b) => b.amount.cmp(a.amount));
   const top = rows.slice(0, limit);
   const total = top.reduce((acc, h) => acc.add(h.amount), new BN(0));
   if (!total.isZero()) {
      for (const h of top) h.shareBps = h.amount.muln(10_000).div(total).toNumber();
   }
   return top;
}

/** Same as `topHolders` but shares are relative to the live mint supply rather than the listed sum. */
export async function topHoldersOfSupply(connection: Connection, mint: PublicKey, supply: BN, exclude: PublicKey[] = [], limit = 20): Promise<Holder[]> {
   const top = await topHolders(connection, mint, exclude, limit);
   if (!supply.isZero()) {
      for (const h of top) h.shareBps = h.amount.muln(10_000).div(supply).toNumber();
   }
   return top;
}
