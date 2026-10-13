<script setup lang="ts">
import passImage from "~/assets/images/pass-solana-edition.jpg";

// H06 · Success, the pass is yours.
// TODO(blockchain task): the pass number, amounts and explorer link must come from the confirmed transaction.
const session = useSessionStore();
const purchase = usePurchaseStore();
// This screen is only for a confirmed purchase: the blockchain task sets `purchase.result` to `confirmed`.
// For design review in development only, /pass/success?preview=1 shows it with placeholder data.
definePageMeta({
   middleware: (to) => {
      if (usePurchaseStore().result?.status === "confirmed" || (import.meta.dev && to.query.preview === "1")) return;
      return navigateTo("/pass", { replace: true });
   },
});

const passNumber = computed(() => (purchase.result?.status === "confirmed" ? purchase.result.passNumber : PLACEHOLDER_PASS_NUMBER));
const signature = computed(() => (purchase.result?.status === "confirmed" ? purchase.result.signature : null));
const config = useRuntimeConfig();

const wallet = computed(() => (session.walletAddress ? `Mostro wallet · ${shortAddress(session.walletAddress)}` : "Mostro wallet"));
// The transaction is the proof for the jury; until the blockchain task provides it, the wallet page is shown.
const explorerUrl = computed(() =>
   signature.value
      ? `https://explorer.solana.com/tx/${signature.value}?cluster=${config.public.solanaCluster}`
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
            <UiRow label="You paid" :hint="`≈ $${PASS.priceUsd}`" :value="`${PASS.priceSol} SOL`" />
            <UiRow label="Network fee" :value="`${PASS.networkFeeSol} SOL`" />
            <UiRow label="Wallet" :value="wallet" />
         </div>
         <UiButton to="/pass" variant="primary" block>View my pass</UiButton>
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
