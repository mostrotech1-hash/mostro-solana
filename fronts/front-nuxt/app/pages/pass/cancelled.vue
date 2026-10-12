<script setup lang="ts">
// H08 · Payment cancelled. Neutral, not an error: no red, no warning icon.
// Same layout when the payment really failed: it then shows the reason.
const purchase = usePurchaseStore();

const text = computed(() => {
   if (purchase.failureReason) {
      return purchase.cardPaid
         ? `Your card payment went through and the SOL is in your wallet, but the pass could not be created: ${purchase.failureReason}`
         : purchase.failureReason;
   }
   return "You weren't charged. Your pass is still available.";
});
</script>

<template>
   <AppShell title="The pass" :max-width="560">
      <UiStatus title="Payment canceled" :text="text">
         <UiButton to="/pass?confirm=1" variant="primary" block>Try again</UiButton>
         <UiButton to="/pass" variant="secondary" block>Back to pass</UiButton>
      </UiStatus>
   </AppShell>
</template>
