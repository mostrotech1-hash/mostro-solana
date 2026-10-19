/**
 * The Mostro program errors a front needs to recognize after a failed `sendTransaction`, by their on-chain code.
 * Dependency-free on purpose (the full table lives in `shared/src/errors.ts`); a backend test checks these match the IDL.
 */
export const MOSTRO_ERROR_CODES = {
   BuysPaused: 6000,
   RedeemsPaused: 6001,
   SaleNotStarted: 6003,
   PerkInactive: 6004,
   PerkSoldOut: 6005,
   SlippageExceeded: 6006,
   CurveSoldOut: 6007,
   CurveComplete: 6008,
   Blacklisted: 6028,
   SpendCapExceeded: 6029,
} as const;

/** What a user may read for each of them. */
export const MOSTRO_ERROR_COPY: Record<number, string> = {
   [MOSTRO_ERROR_CODES.BuysPaused]: "Buying is paused right now. Please try again later.",
   [MOSTRO_ERROR_CODES.RedeemsPaused]: "Perk redemptions are paused right now. Please try again later.",
   [MOSTRO_ERROR_CODES.SaleNotStarted]: "The sale has not opened yet.",
   [MOSTRO_ERROR_CODES.PerkInactive]: "The pass is no longer available.",
   [MOSTRO_ERROR_CODES.PerkSoldOut]: "Sold out. All passes have been claimed.",
   [MOSTRO_ERROR_CODES.SlippageExceeded]: "The price moved. Review the new price and confirm again.",
   [MOSTRO_ERROR_CODES.CurveSoldOut]: "Not enough tokens left for this purchase.",
   [MOSTRO_ERROR_CODES.CurveComplete]: "The curve is complete. Trading here is closed.",
   [MOSTRO_ERROR_CODES.Blacklisted]: "This wallet is not allowed to use Mostro.",
   [MOSTRO_ERROR_CODES.SpendCapExceeded]: "You have reached the monthly SOL limit for this artist. Try again next month or with a smaller amount.",
};
