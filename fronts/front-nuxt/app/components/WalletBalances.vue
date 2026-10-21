<script setup lang="ts">
/** The wallet's SOL and artist-token balances as two small chips. `to` makes them a link (the header uses it). */
const wallet = useWalletStore();
defineProps<{ to?: string }>();

const sol = computed(() => (wallet.sol === null ? "…" : formatSol(wallet.sol, 3)));
const token = computed(() => (wallet.token === null ? "…" : formatTokens(wallet.token)));
</script>

<template>
   <component :is="to ? resolveComponent('NuxtLink') : 'div'" v-bind="to ? { to } : {}" class="balances" aria-label="Wallet balances">
      <span class="balances__chip"><strong>{{ token }}</strong> ${{ wallet.tokenSymbol }}</span>
      <span class="balances__chip"><strong>{{ sol }}</strong> SOL</span>
   </component>
</template>

<style scoped>
.balances {
   display: inline-flex;
   align-items: center;
   gap: 8px;
   color: var(--m-text);
   font-size: 13px;
   text-decoration: none;
}
.balances__chip {
   padding: 6px 10px;
   border: 1px solid var(--m-border);
   border-radius: 999px;
   white-space: nowrap;
}
.balances__chip strong {
   font-weight: 600;
}
</style>
