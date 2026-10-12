import { defineStore } from "pinia";
import type { MintResult } from "~/utils/pass-purchase";

/** Where the pass purchase is, shared by the pass, paying, slow, success and cancelled screens. */
export const usePurchaseStore = defineStore("purchase", () => {
   /** The card payment (MoonPay) finished: the user's wallet now holds the SOL. */
   const cardPaid = ref(false);
   /** The last mint result, once the blockchain task fills it in. */
   const result = ref<MintResult | null>(null);
   /** Why the purchase did not go through (shown on the cancelled screen). */
   const failureReason = ref("");

   function reset() {
      cardPaid.value = false;
      result.value = null;
      failureReason.value = "";
   }

   return { cardPaid, result, failureReason, reset };
});
