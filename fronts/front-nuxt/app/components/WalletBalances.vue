<script setup lang="ts">
/**
 * One compact pill: the $MOOG and SOL balances (a link to the wallet), and, when `buy` is set, a "+ Buy" segment at the end.
 * The header and the pass page use it; the wallet page shows it without the buy segment.
 */
const wallet = useWalletStore();
withDefaults(defineProps<{ to?: string; buy?: boolean }>(), { to: undefined, buy: false });

const sol = computed(() => (wallet.sol === null ? "…" : formatSol(wallet.sol, 3)));
const token = computed(() => (wallet.token === null ? "…" : formatTokens(wallet.token)));
</script>

<template>
   <div class="pill" aria-label="Wallet balances">
      <component :is="to ? resolveComponent('NuxtLink') : 'span'" v-bind="to ? { to } : {}" class="pill__balances">
         <strong>{{ token }}</strong> ${{ wallet.tokenSymbol }}
         <span class="pill__dot" aria-hidden="true">·</span>
         <strong>{{ sol }}</strong> SOL
      </component>
      <NuxtLink v-if="buy" to="/buy" class="pill__buy" :aria-label="`Buy ${wallet.tokenSymbol}`">+ Buy</NuxtLink>
   </div>
</template>

<style scoped>
.pill {
   display: inline-flex;
   align-items: stretch;
   border: 1px solid var(--m-border);
   border-radius: 999px;
   overflow: hidden;
   color: var(--m-text);
   font-size: 13px;
   white-space: nowrap;
}
.pill__balances,
.pill__buy {
   display: inline-flex;
   align-items: center;
   gap: 4px;
   padding: 7px 12px;
   color: inherit;
   text-decoration: none;
}
.pill__balances strong {
   font-weight: 600;
}
.pill__dot {
   margin: 0 2px;
   color: var(--m-muted);
}
.pill__buy {
   border-left: 1px solid var(--m-border);
   font-weight: 600;
}
.pill__buy:hover,
.pill__balances:hover {
   background: var(--m-surface);
}
</style>
