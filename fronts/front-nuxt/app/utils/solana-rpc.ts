import { MOSTRO_ERROR_COPY } from "@mostro/shared/api";

/** The few Solana JSON-RPC calls the purchase needs, over plain fetch (devnet only). */
export class RpcError extends Error {
   constructor(
      message: string,
      /** On-chain custom program error code, when the node reported one (6006 is SlippageExceeded). */
      readonly programCode: number | null = null,
      /** The node answered but refused the transaction (as opposed to the node being unreachable). */
      readonly rejected = false,
   ) {
      super(message);
   }
}

interface RpcErrorBody {
   message?: string;
   data?: { err?: unknown; logs?: string[] };
}

/** `{ InstructionError: [index, { Custom: 6006 }] }` -> 6006 */
function customCode(err: unknown): number | null {
   const instruction = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError;
   const custom = (instruction?.[1] as { Custom?: number } | undefined)?.Custom;
   return typeof custom === "number" ? custom : null;
}

export function describeTransactionError(err: unknown): string {
   const code = customCode(err);
   if (code !== null && MOSTRO_ERROR_COPY[code]) return MOSTRO_ERROR_COPY[code]!;
   if (err === "BlockhashNotFound") return "The purchase expired before it was sent. Please try again.";
   if (err === "InsufficientFundsForFee" || err === "InsufficientFundsForRent") return "Your wallet does not have enough SOL for this purchase.";
   return "The network rejected the purchase.";
}

export async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
   let response: Response;
   try {
      response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
   } catch {
      throw new RpcError("Could not reach the Solana network. Please check your connection and try again.");
   }
   if (!response.ok)
      throw new RpcError(response.status === 429 ? "The Solana network is busy. Please try again in a moment." : "The Solana network did not answer. Please try again.");
   const body = (await response.json()) as { result?: T; error?: RpcErrorBody };
   if (body.error) {
      const err = body.error.data?.err;
      throw new RpcError(err ? describeTransactionError(err) : (body.error.message ?? "The Solana network returned an error."), customCode(err), Boolean(err));
   }
   return body.result as T;
}

export async function getBalanceLamports(url: string, address: string): Promise<bigint> {
   const result = await rpc<{ value: number }>(url, "getBalance", [address, { commitment: "confirmed" }]);
   return BigInt(result.value);
}

export function getBlockHeight(url: string): Promise<number> {
   return rpc<number>(url, "getBlockHeight", [{ commitment: "confirmed" }]);
}

export function getGenesisHash(url: string): Promise<string> {
   return rpc<string>(url, "getGenesisHash", []);
}

/** Sends an already signed transaction. The node simulates it first (preflight), so program errors come back here. */
export function sendTransaction(url: string, signedBase64: string): Promise<string> {
   return rpc<string>(url, "sendTransaction", [signedBase64, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
}

export interface SignatureStatus {
   confirmationStatus: "processed" | "confirmed" | "finalized" | null;
   err: unknown;
}

export async function getSignatureStatus(url: string, signature: string): Promise<SignatureStatus | null> {
   const result = await rpc<{ value: (SignatureStatus | null)[] }>(url, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
   return result.value[0] ?? null;
}

/** The wallet's balance of one token (base units): the sum of its token accounts for `mint`; 0 when it never held any. */
export async function getTokenBalance(url: string, owner: string, mint: string): Promise<bigint> {
   const result = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>(url, "getTokenAccountsByOwner", [
      owner,
      { mint },
      { encoding: "jsonParsed", commitment: "confirmed" },
   ]);
   return result.value.reduce((sum, entry) => sum + BigInt(entry.account.data.parsed.info.tokenAmount.amount), 0n);
}
