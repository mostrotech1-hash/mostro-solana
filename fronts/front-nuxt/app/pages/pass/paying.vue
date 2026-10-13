<script setup lang="ts">
// H05 · Payment in progress. The wallet signs the purchase and it is sent to Solana devnet.
// After about 30 seconds without confirmation it becomes H09 (slower than usual), never an error.
const SLOW_AFTER_MS = 30_000;
const session = useSessionStore();
const purchase = usePurchaseStore();
let timer: ReturnType<typeof setTimeout> | undefined;
let leaving = false;

async function leave(path: string) {
   leaving = true;
   clearTimeout(timer);
   await navigateTo(path, { replace: true });
}

onMounted(async () => {
   // Opened without confirming a price (e.g. the page was reloaded): nothing is built or signed.
   if (!purchase.approvedMaxLamportsIn) return leave("/pass");
   // One purchase at a time: a second one is never started while this one is running.
   if (purchase.inProgress) return;
   purchase.inProgress = true;

   timer = setTimeout(() => leave("/pass/slow"), SLOW_AFTER_MS);
   try {
      const ctx = session.purchaseContext((signature) => {
         purchase.signature = signature;
         purchase.result = { status: "pending", signature };
      });
      const result = await mintPassWithSol(ctx, { approvedMaxLamportsIn: purchase.approvedMaxLamportsIn });
      purchase.result = result;
      if (leaving && result.status === "pending") return; // the slow screen keeps checking
      if (result.status === "confirmed") await leave("/pass/success");
      else if (result.status === "failed") {
         purchase.failureReason = result.reason;
         await leave("/pass/cancelled");
      }
      // "pending": keep waiting here; the timer moves to H09.
   } catch (error) {
      console.error("[mostro] purchase failed", error);
      if (error instanceof PurchaseError && error.quote) purchase.quote = error.quote;
      purchase.failureReason = error instanceof Error ? error.message : "Something went wrong.";
      await leave("/pass/cancelled");
   } finally {
      purchase.inProgress = false;
   }
});
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
   <AppShell title="Paying" :max-width="560">
      <UiStatus title="Getting your pass…" text="Confirming the payment on Solana. It usually takes a few seconds. You can keep this page open." animated />
   </AppShell>
</template>
