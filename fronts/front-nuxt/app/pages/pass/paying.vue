<script setup lang="ts">
// H05 · Payment in progress. The card payment is done; now the app uses the SOL to mint the pass (blockchain task).
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
   timer = setTimeout(() => leave("/pass/slow"), SLOW_AFTER_MS);
   try {
      const result = await mintPassWithSol({ walletAddress: session.walletAddress ?? "", priceSol: PASS.priceSol });
      purchase.result = result;
      if (leaving) return;
      if (result.status === "confirmed") await leave("/pass/success");
      else if (result.status === "failed") {
         purchase.failureReason = result.reason;
         await leave("/pass/cancelled");
      }
      // "pending": keep waiting here; the timer moves to H09.
   } catch (error) {
      console.error("[mostro] mint failed", error);
      purchase.failureReason = error instanceof Error ? error.message : "Something went wrong.";
      if (!leaving) await leave("/pass/cancelled");
   }
});
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
   <AppShell title="Paying" :max-width="560">
      <UiStatus title="Getting your pass…" text="Confirming the payment on Solana. It usually takes a few seconds. You can keep this page open." animated />
   </AppShell>
</template>
