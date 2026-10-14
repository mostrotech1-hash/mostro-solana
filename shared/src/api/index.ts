/**
 * Contract between the Mostro API (`back/`) and the web fronts: plain types and constants, no runtime
 * dependencies, so a front can import `@mostro/shared/api` without pulling in the Solana SDK.
 */

/** How the user signed in. Mirrors the CHECK constraint on `mostro_app.users.login_type`. */
export const LOGIN_TYPES = ["email", "google", "apple", "twitter"] as const;
export type LoginType = (typeof LOGIN_TYPES)[number];

/** A row of `mostro_app.users`, as the API returns it. */
export interface UserProfile {
   id: string;
   loginType: LoginType;
   email: string | null;
   /** Display name chosen on the profile step. `null` until the user sets one. */
   name: string | null;
   /** Absolute URL of the avatar image, or `null`. */
   avatarUrl: string | null;
}

/** POST /users/sync (no body): creates the user on first login, returns it on the next ones. */

/** PATCH /users/me */
export interface UpdateProfileRequest {
   name: string;
}

/** POST /wallet/encryption-session: lets the front create the embedded wallet with automatic recovery. */
export interface EncryptionSessionResponse {
   session: string;
}

/** POST /moonpay/prepare: everything the MoonPay Web SDK needs to open the buy widget for this user. */
export interface PrepareMoonpayRequest {
   /** The user's own Solana wallet; MoonPay delivers the purchased SOL there. */
   walletAddress: string;
   /** Amount of SOL to buy. */
   amountSol: number;
}
export interface PrepareMoonpayResponse {
   /** Expiring server proof of the caller's prepared purchase. */
   preparationToken: string;
   /** `sandbox` for pk_test keys, `production` for pk_live keys. */
   environment: "sandbox" | "production";
   /** Widget query params, passed to the SDK as `params`. */
   params: Record<string, string>;
}

/** POST /moonpay/sign-url: the SDK's unsigned widget URL goes in, the signature comes out. */
export interface SignMoonpayUrlRequest {
   preparationToken: string;
   urlForSignature: string;
}
export interface SignMoonpayUrlResponse {
   signature: string;
}

// ---- Pass purchase (Solana devnet): one sponsored transaction = buy $MOST + redeem the pass ----

/** Live quote for the demo pass: exactly `tokensOut` of $MOST bought from the curve, then redeemed. Numbers are strings (u64). */
export interface PassQuote {
   cluster: "devnet";
   pass: {
      name: string;
      artistIndex: number;
      perkIndex: number;
      /** $MOST base units (6 decimals). */
      priceMost: string;
      active: boolean;
      sold: number;
      /** 0 means unlimited. */
      maxSupply: number;
   };
   /** $MOST bought, base units. Equals the pass price. */
   tokensOut: string;
   /** Lamports the curve charges for `tokensOut`, before and including the protocol fee. */
   lamportsCost: string;
   lamportsFee: string;
   lamportsTotal: string;
   /** Ceiling the program enforces (`max_lamports_in`): `lamportsTotal` plus the slippage tolerance. */
   maxLamportsIn: string;
   slippageBps: number;
   /** USD per SOL with 6 decimals, only when the program uses its own price (for a rough dollar estimate). */
   usdPerSolE6: string | null;
}

/** POST /pass/purchase/build */
export interface BuildPurchaseRequest {
   /** The buyer's Openfort Solana wallet. Must belong to the signed-in user. */
   walletAddress: string;
   /** The `maxLamportsIn` the user saw and approved. The API never builds a transaction above it. */
   approvedMaxLamportsIn: string;
}
export interface BuildPurchaseResponse {
   /** Base64 legacy transaction, signed by the sponsor (fee payer and `payer`), waiting for the buyer's signature. */
   transaction: string;
   /** Position of the buyer's signature in the transaction's signature list. */
   buyerSignatureIndex: number;
   blockhash: string;
   lastValidBlockHeight: number;
   /** Core asset (the pass) and receipt that the transaction creates. */
   asset: string;
   receipt: string;
   quote: PassQuote;
}

/** POST /pass/purchase/result */
export interface PurchaseResultRequest {
   walletAddress: string;
   signature: string;
}
export type PurchaseResultResponse =
   | { status: "pending" }
   | { status: "failed"; reason: string }
   | {
        status: "confirmed";
        signature: string;
        asset: string;
        receipt: string;
        /** Pass number (edition). */ edition: number;
        /** Lamports the buyer paid for the tokens. */ paidLamports: string;
     };

/** GET /pass/ownership?walletAddress=...: whether the wallet already owns the pass (read from the chain). */
export type PassOwnershipResponse = { owned: false } | { owned: true; edition: number; asset: string; receipt: string };

/** POST /pass/devnet-topup (devnet only): tops the buyer's wallet up to what the purchase needs. */
export interface DevnetTopupRequest {
   walletAddress: string;
}
export interface DevnetTopupResponse {
   toppedUpLamports: string;
   signature: string | null;
}

/** Machine-readable `code` carried by some API errors, next to `message`. */
export type ApiErrorCode = "QUOTE_CHANGED" | "PASS_PRICE_CHANGED" | "INSUFFICIENT_SOL" | "SPONSOR_UNAVAILABLE" | "WALLET_NOT_OWNED" | "RATE_LIMITED";

/** Every error body the API returns. */
export interface ApiError {
   statusCode: number;
   message: string;
   code?: ApiErrorCode;
   /** Present on QUOTE_CHANGED: the new quote to review. */
   quote?: PassQuote;
   /** Present on INSUFFICIENT_SOL. */
   neededLamports?: string;
   haveLamports?: string;
}
export * from "./mostro-errors";
