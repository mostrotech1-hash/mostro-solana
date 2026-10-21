<script setup lang="ts">
import passImage from "~/assets/images/Mo-OG-Pass-x.png";

// H06 · Success, the pass is yours. Only reachable after the chain confirmed the purchase AND the API verified the redemption.
const session = useSessionStore();
const purchase = usePurchaseStore();
const config = useRuntimeConfig();
// The pass was just paid for: show the new balances right away.
onMounted(() => void useWalletStore().refresh(true));
// For design review in development only, /pass/success?preview=1 shows it with placeholder data.
definePageMeta({
   middleware: (to) => {
      if (usePurchaseStore().result?.status === "confirmed" || usePurchaseStore().owned || (import.meta.dev && to.query.preview === "1")) return;
      return navigateTo("/pass", { replace: true });
   },
});

const confirmed = computed(() => (purchase.result?.status === "confirmed" ? purchase.result : null));
const passNumber = computed(() => (confirmed.value ? `Pass ${confirmed.value.passNumber}` : purchase.owned ? `Pass #${purchase.owned.edition}` : "Pass #0"));
const paidSol = computed(() => (confirmed.value ? formatSol(confirmed.value.paidLamports) : "0"));
const wallet = computed(() => (session.walletAddress ? `Mostro wallet · ${shortAddress(session.walletAddress)}` : "Mostro wallet"));
// The transaction is the proof for the jury.
const explorerUrl = computed(() =>
   confirmed.value
      ? `https://explorer.solana.com/tx/${confirmed.value.signature}?cluster=${config.public.solanaCluster}`
      : purchase.owned
        ? `https://explorer.solana.com/address/${purchase.owned.asset}?cluster=${config.public.solanaCluster}`
        : `https://explorer.solana.com/address/${session.walletAddress}?cluster=${config.public.solanaCluster}`,
);
</script>

<template>
   <AppShell title="Your pass" :max-width="560">
      <div class="success">
         <UiCard variant="lime" class="success__card">
            <img :src="passImage" alt="Pass visual · Solana edition" class="success__visual" width="640" height="480" />
            <div class="success__tags">
               <UiBadge>{{ PASS.edition }}</UiBadge>
               <span class="success__number">{{ passNumber }}</span>
            </div>
            <h2 class="success__name">{{ PASS.name }}</h2>
         </UiCard>
         <h1 class="success__title">You've got your pass!</h1>
         <p class="success__lead">Your pass is in your Mostro wallet and under My Perks. Check your email for your Discord invite.</p>
         <div>
            <UiRow v-if="confirmed" label="You paid" :value="`${paidSol} SOL`" />
            <UiRow label="Network fee" value="Paid by Mostro" />
            <UiRow label="Wallet" :value="wallet" />
         </div>
         <UiButton to="/wallet" variant="primary" block>Open my wallet</UiButton>
         <UiButton :href="explorerUrl" variant="secondary" block>View on Solana Explorer</UiButton>
      </div>
   </AppShell>
</template>

<style scoped>
.success {
   display: flex;
   flex-direction: column;
   gap: 16px;
}
.success__card {
   display: flex;
   flex-direction: column;
   align-items: flex-start;
   gap: 12px;
}
.success__visual {
   width: 100%;
   height: 200px;
   object-fit: cover;
   border-radius: 16px;
}
.success__tags {
   display: flex;
   align-items: center;
   gap: 8px;
}
.success__number {
   font-size: 12px;
   font-weight: 500;
}
.success__name {
   margin: 0;
   font-size: 22px;
   font-weight: 600;
   line-height: 1.4;
}
.success__title {
   margin: 0;
   font-size: 28px;
   font-weight: 600;
   line-height: 1.4;
}
.success__lead {
   margin: 0;
   color: var(--m-muted);
   font-size: 14px;
   line-height: 1.4;
}
@media (min-width: 900px) {
   .success__visual {
      height: 260px;
   }
}
</style>
