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
   /** `sandbox` for pk_test keys, `production` for pk_live keys. */
   environment: "sandbox" | "production";
   /** Widget query params, passed to the SDK as `params`. */
   params: Record<string, string>;
}

/** POST /moonpay/sign-url: the SDK's unsigned widget URL goes in, the signature comes out. */
export interface SignMoonpayUrlRequest {
   urlForSignature: string;
}
export interface SignMoonpayUrlResponse {
   signature: string;
}

/** Every error body the API returns. */
export interface ApiError {
   statusCode: number;
   message: string;
}
