import { defineStore } from "pinia";
import type { PassQuote } from "@mostro/shared/api";
import type { MintResult } from "~/utils/pass-purchase";

/** Where the pass purchase is, shared by the pass, paying, slow, success and cancelled screens. */
export const usePurchaseStore = defineStore("purchase", () => {
   /** The card payment (MoonPay) finished: the user's wallet now holds the SOL. */
   const cardPaid = ref(false);
   /** The live price the user is looking at (refreshed every time the pass page opens). */
   const quote = ref<PassQuote | null>(null);
   /** The `maxLamportsIn` the user confirmed. Nothing above it is ever signed. Empty until they confirm. */
   const approvedMaxLamportsIn = ref("");
   /** The last purchase result. Success is only ever set from a confirmed, verified redemption. */
   const result = ref<MintResult | null>(null);
   /** Transaction id once it was sent (kept so the slow screen can keep checking the same one). */
   const signature = ref("");
   /** A purchase is being built, signed or sent: blocks a second one. */
   const inProgress = ref(false);
   /** Why the purchase did not go through (shown on the cancelled screen). */
   const failureReason = ref("");

   /** Set when the wallet already owns the pass (read from the chain): the pass page then skips the purchase. */
   const owned = ref<{ edition: number; asset: string } | null>(null);

   function reset() {
      cardPaid.value = false;
      approvedMaxLamportsIn.value = "";
      result.value = null;
      signature.value = "";
      inProgress.value = false;
      failureReason.value = "";
   }

   return { owned, cardPaid, quote, approvedMaxLamportsIn, result, signature, inProgress, failureReason, reset };
});
