<script setup lang="ts">
// "My wallet" (the pill in the desktop header): the user's Mostro wallet on Solana.
const session = useSessionStore();
const config = useRuntimeConfig();

const explorerUrl = computed(() => `https://explorer.solana.com/address/${session.walletAddress}?cluster=${config.public.solanaCluster}`);
const copied = ref(false);
const kycText = computed(
   () => ({ none: "Not verified", pending: "In review", approved: "Verified", rejected: "Not verified, you can try again" })[session.kycStatus],
);

async function copyAddress() {
   if (!session.walletAddress) return;
   await navigator.clipboard.writeText(session.walletAddress);
   copied.value = true;
   setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
   <AppShell title="My wallet" back-to="/pass" :max-width="560">
      <div class="wallet">
         <h1 class="wallet__title">Your Mostro wallet</h1>
         <p class="wallet__lead">Created on Solana when you signed up. Your passes live here.</p>
         <UiCard variant="panel">
            <p class="wallet__label">ADDRESS</p>
            <p class="wallet__address">{{ session.walletAddress }}</p>
         </UiCard>
         <UiCard variant="panel">
            <UiRow label="Identity check" :value="kycText" />
            <UiButton v-if="session.kycStatus !== 'approved'" to="/verify" variant="secondary" block>{{ session.kycStatus === "pending" ? "See progress" : "Verify your identity" }}</UiButton>
         </UiCard>
         <UiButton variant="primary" block @click="copyAddress">{{ copied ? "Copied" : "Copy address" }}</UiButton>
         <UiButton :href="explorerUrl" variant="secondary" block>View on Solana Explorer</UiButton>
      </div>
   </AppShell>
</template>

<style scoped>
.wallet {
   display: flex;
   flex-direction: column;
   gap: 16px;
}
.wallet__title {
   margin: 0;
   font-size: 28px;
   font-weight: 600;
}
.wallet__lead {
   margin: 0;
   color: var(--m-muted);
   font-size: 14px;
}
.wallet__label {
   margin: 0 0 6px;
   color: var(--m-muted);
   font-size: 11px;
   font-weight: 600;
}
.wallet__address {
   margin: 0;
   font-size: 14px;
   word-break: break-all;
}
</style>
