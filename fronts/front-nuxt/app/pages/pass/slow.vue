<script setup lang="ts">
// H09 · Slower than usual. No retry button: a second payment could be charged twice.
// It keeps checking the purchase and moves to H06 when confirmed, or H08 with the reason if it fails.
const POLL_MS = 5000;
const session = useSessionStore();
const purchase = usePurchaseStore();
const config = useRuntimeConfig();
let poll: ReturnType<typeof setInterval> | undefined;

const explorerUrl = computed(() =>
   purchase.signature
      ? `https://explorer.solana.com/tx/${purchase.signature}?cluster=${config.public.solanaCluster}`
      : `https://explorer.solana.com/address/${session.walletAddress}?cluster=${config.public.solanaCluster}`,
);
let checking = false;

async function check() {
   // The purchase is still being signed or sent: nothing to look up yet.
   if (!purchase.signature || checking || !session.walletAddress) return;
   checking = true;
   try {
      const result = await getMintStatus({ api: session.api, walletAddress: session.walletAddress }, purchase.signature);
      if (result.status === "pending") return;
      purchase.result = result;
      if (result.status === "confirmed") await navigateTo("/pass/success", { replace: true });
      else {
         purchase.failureReason = result.reason;
         await navigateTo("/pass/cancelled", { replace: true });
      }
   } finally {
      checking = false;
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
