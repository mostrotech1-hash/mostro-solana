/**
 * The Mostro program errors a front needs to recognize after a failed `sendTransaction`, by their on-chain code.
 * Dependency-free on purpose (the full table lives in `shared/src/errors.ts`); a backend test checks these match the IDL.
 */
export const MOSTRO_ERROR_CODES = {
   Paused: 6000,
   SaleNotStarted: 6002,
   PerkInactive: 6003,
   PerkSoldOut: 6004,
   SlippageExceeded: 6005,
   CurveSoldOut: 6006,
   CurveComplete: 6007,
   KycRequired: 6024,
} as const;

/** What a user may read for each of them. */
export const MOSTRO_ERROR_COPY: Record<number, string> = {
   [MOSTRO_ERROR_CODES.Paused]: "Trading is paused right now. Please try again later.",
   [MOSTRO_ERROR_CODES.SaleNotStarted]: "The pass sale has not opened yet.",
   [MOSTRO_ERROR_CODES.PerkInactive]: "The pass is no longer available.",
   [MOSTRO_ERROR_CODES.PerkSoldOut]: "Sold out. All passes have been claimed.",
   [MOSTRO_ERROR_CODES.SlippageExceeded]: "The price moved. Review the new price and confirm again.",
   [MOSTRO_ERROR_CODES.CurveSoldOut]: "Not enough tokens left for this purchase.",
   [MOSTRO_ERROR_CODES.CurveComplete]: "The curve is complete. Trading here is closed.",
   [MOSTRO_ERROR_CODES.KycRequired]: "This wallet needs an approval before it can buy.",
};
