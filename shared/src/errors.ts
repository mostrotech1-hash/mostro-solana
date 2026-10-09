/**
 * Program error table generated from the IDL at load time, plus user-facing copy and a parser that
 * turns whatever `sendTransaction` / Anchor throws into `{ code, name, message, copy }`.
 */
import idlJson from "../idl/mostro.json";

export interface MostroErrorInfo {
   code: number;
   name: string;
   /** `#[msg]` from the program. */
   message: string;
   /** Short copy safe to show in the UI. */
   copy: string;
}

/** Copy the fronts show for each program error (keyed by error name). */
export const ERROR_COPY: Record<string, string> = {
   Paused: "Trading is paused right now. Please try again later.",
   Unauthorized: "This wallet is not allowed to do that. Pass perks and artist vault withdrawals have a single allowed signer.",
   SaleNotStarted: "This sale has not opened yet. Pass holders get early access.",
   PerkInactive: "This perk (or the pass tier you presented) is no longer available.",
   PerkSoldOut: "Sold out. All editions have been claimed.",
   SlippageExceeded: "The price changed. Review the new quote and try again.",
   CurveSoldOut: "Not enough $MOST left on the curve for this amount.",
   CurveComplete: "The curve is complete. Trading here is closed.",
   InsufficientReserves: "The curve cannot pay out that much SOL right now. Try a smaller amount.",
   MathOverflow: "That amount is too large.",
   InvalidAmount: "Enter a larger amount.",
   InvalidBps: "Invalid percentage: the burn and rewards shares must sum to at most 100% and meet the protocol minimums.",
   InvalidTier: "Invalid pass tier.",
   InvalidCurveParams: "Invalid curve parameters.",
   StringTooLong: "That text is too long.",
   InvalidPriceAccount: "Price feed unavailable. Please try again.",
   PriceFeedMismatch: "Price feed unavailable. Please try again.",
   PriceTooOld: "The SOL/USD price is stale (feed or admin price older than the allowed age). Please try again later.",
   PriceNonPositive: "Price feed returned an invalid price.",
   PriceNotSet: "SOL/USD price is not configured yet.",
   AdminTransferNotReady: "The admin transfer cool-off has not elapsed.",
   NoPendingAdmin: "There is no pending admin transfer.",
   InvalidCollection: "This perk's collection does not match.",
   InvalidMint: "Wrong token for this action.",
   KycRequired: "Identity verification is required before buying or selling.",
   VipOnly: "This perk is for VIP pass holders only.",
   InvalidPass: "That pass is not owned by this wallet.",
   PassMismatch: "The pass does not belong to that pass tier.",
   AlreadyFulfilled: "This perk was already marked as delivered.",
   ArtistInactive: "This artist is not active.",
   InvalidDiscount: "The discount exceeds the price.",
   PriceUncertain: "The SOL/USD price feed is too volatile right now. Please try again in a moment.",
};

interface IdlErrorEntry {
   code: number;
   name: string;
   msg?: string;
}

const idlErrors: IdlErrorEntry[] = ((idlJson as { errors?: IdlErrorEntry[] }).errors ?? []).map((e) => ({ code: e.code, name: e.name, msg: e.msg }));

/** code -> info */
export const MOSTRO_ERRORS_BY_CODE: ReadonlyMap<number, MostroErrorInfo> = new Map(
   idlErrors.map((e) => [e.code, { code: e.code, name: e.name, message: e.msg ?? e.name, copy: ERROR_COPY[e.name] ?? e.msg ?? e.name }]),
);

/** name -> info */
export const MOSTRO_ERRORS_BY_NAME: ReadonlyMap<string, MostroErrorInfo> = new Map(Array.from(MOSTRO_ERRORS_BY_CODE.values()).map((e) => [e.name, e]));

/** Error codes as an object so TS can autocomplete them: `MostroErrorCode.SlippageExceeded === 6005`. */
export const MostroErrorCode: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(idlErrors.map((e) => [e.name, e.code])));

/** Well-known non-Anchor failures the UI should also explain. */
export const GENERIC_ERROR_COPY = {
   insufficientFunds: "Not enough SOL in the wallet to cover this transaction.",
   insufficientTokens: "Not enough tokens in the wallet.",
   userRejected: "Transaction was cancelled in the wallet.",
   blockhashExpired: "The network was slow and the transaction expired. Please try again.",
   unknown: "Something went wrong. Please try again.",
} as const;

export interface ParsedError {
   code: number | null;
   name: string;
   message: string;
   copy: string;
   /** Raw simulation logs when available. */
   logs?: string[];
}

const CUSTOM_ERROR_RE = /custom program error: (0x[0-9a-fA-F]+|\d+)/;
const ANCHOR_LOG_RE = /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/;

function collectLogs(err: unknown): string[] | undefined {
   const e = err as { logs?: unknown; transactionLogs?: unknown } | null;
   if (!e || typeof e !== "object") return undefined;
   if (Array.isArray(e.logs)) return e.logs as string[];
   if (Array.isArray(e.transactionLogs)) return e.transactionLogs as string[];
   return undefined;
}

function infoFor(code: number, logs?: string[]): ParsedError {
   const known = MOSTRO_ERRORS_BY_CODE.get(code);
   if (known) return { ...known, logs };
   return { code, name: `Custom(${code})`, message: `custom program error ${code}`, copy: GENERIC_ERROR_COPY.unknown, logs };
}

/**
 * Parse an error thrown by Anchor (`AnchorError`, `ProgramError`), by `sendTransaction`
 * (`SendTransactionError` with logs) or by a wallet adapter. Returns `null` when nothing is
 * recognisable; callers should then show `GENERIC_ERROR_COPY.unknown`.
 */
export function parseMostroError(err: unknown): ParsedError | null {
   if (err === null || err === undefined) return null;
   const logs = collectLogs(err);
   const anyErr = err as Record<string, unknown>;

   // AnchorError: err.error.errorCode.{code,number}
   const anchorErr = anyErr.error as { errorCode?: { code?: string; number?: number }; errorMessage?: string } | undefined;
   if (anchorErr && anchorErr.errorCode && typeof anchorErr.errorCode.number === "number") {
      return infoFor(anchorErr.errorCode.number, logs);
   }
   // ProgramError: err.code / err.msg
   if (typeof anyErr.code === "number" && anyErr.code >= 6000) {
      return infoFor(anyErr.code, logs);
   }
   // Scan logs for the Anchor-formatted line, then for the raw custom error.
   const haystack: string[] = [];
   if (logs) haystack.push(...logs);
   const msg = typeof anyErr.message === "string" ? anyErr.message : typeof err === "string" ? err : "";
   if (msg) haystack.push(msg);
   for (const line of haystack) {
      const a = ANCHOR_LOG_RE.exec(line);
      if (a) return infoFor(Number(a[2]), logs);
   }
   for (const line of haystack) {
      const m = CUSTOM_ERROR_RE.exec(line);
      if (m) {
         const code = m[1].startsWith("0x") ? parseInt(m[1], 16) : Number(m[1]);
         return infoFor(code, logs);
      }
   }
   // Non-program failures worth translating.
   const lower = msg.toLowerCase();
   if (lower.includes("user rejected") || lower.includes("user denied") || lower.includes("rejected the request")) {
      return { code: null, name: "UserRejected", message: msg, copy: GENERIC_ERROR_COPY.userRejected, logs };
   }
   if (lower.includes("insufficient funds for rent") || lower.includes("insufficient lamports") || lower.includes("attempt to debit an account but found no record")) {
      return { code: null, name: "InsufficientFunds", message: msg, copy: GENERIC_ERROR_COPY.insufficientFunds, logs };
   }
   if (lower.includes("insufficient funds") && haystack.some((l) => l.toLowerCase().includes("token"))) {
      return { code: null, name: "InsufficientTokens", message: msg, copy: GENERIC_ERROR_COPY.insufficientTokens, logs };
   }
   if (lower.includes("blockhash not found") || lower.includes("block height exceeded") || lower.includes("transaction was not confirmed")) {
      return { code: null, name: "BlockhashExpired", message: msg, copy: GENERIC_ERROR_COPY.blockhashExpired, logs };
   }
   return null;
}

/** Always returns something displayable. */
export function errorCopy(err: unknown): string {
   return parseMostroError(err)?.copy ?? GENERIC_ERROR_COPY.unknown;
}
