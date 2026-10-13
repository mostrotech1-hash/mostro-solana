<script setup lang="ts">
// H09 · Slower than usual. No retry button: a second payment could be charged twice.
// It keeps checking the purchase and moves to H06 when confirmed, or H08 with the reason if it fails.
const POLL_MS = 5000;
const session = useSessionStore();
const purchase = usePurchaseStore();
const config = useRuntimeConfig();
let poll: ReturnType<typeof setInterval> | undefined;

const explorerUrl = computed(() => `https://explorer.solana.com/address/${session.walletAddress}?cluster=${config.public.solanaCluster}`);

async function check() {
   const signature = purchase.result?.status === "pending" ? purchase.result.signature : undefined;
   const result = await getMintStatus(signature);
   purchase.result = result;
   if (result.status === "confirmed") await navigateTo("/pass/success", { replace: true });
   else if (result.status === "failed") {
      purchase.failureReason = result.reason;
      await navigateTo("/pass/cancelled", { replace: true });
   }
}

onMounted(() => {
   poll = setInterval(() => void check().catch((error) => console.error("[mostro] status check failed", error)), POLL_MS);
});
onBeforeUnmount(() => clearInterval(poll));
</script>

<template>
   <AppShell title="Processing payment" :max-width="560">
      <UiStatus
         title="Still processing…"
         text="The Solana network is busy, so your payment hasn't been confirmed yet. Your SOL is safe, so please don't pay again. We'll show your pass as soon as it goes through."
         animated
      >
         <UiButton :href="explorerUrl" variant="secondary" block>View on Solana Explorer</UiButton>
      </UiStatus>
   </AppShell>
</template>
