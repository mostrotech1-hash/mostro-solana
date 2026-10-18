<script setup lang="ts">
import { TOKEN_PURCHASE_LIMITS, type TokenQuote } from "@mostro/shared/api";

// Buy $MOST: pick an amount, see the live price from the curve, pay from the Mostro wallet (card through MoonPay when it is short).
const session = useSessionStore();
const config = useRuntimeConfig();

const PRESETS = [100, 500, 1000, 5000];
const MIN_CARD_SOL = 0.15; // the least MoonPay sells
const tokens = ref(PRESETS[0]!);
const custom = ref("");
const quote = ref<TokenQuote | null>(null);
const balance = ref<bigint | null>(null);
const loading = ref(true);
const loadError = ref("");
const moonpayOpen = ref(false);
const moonpaySol = ref(MIN_CARD_SOL);

type Phase = "idle" | "buying" | "done" | "pending" | "failed";
const phase = ref<Phase>("idle");
const failure = ref("");
const signature = ref("");
let boughtTokens = 0;

const validAmount = computed(() => Number.isInteger(tokens.value) && tokens.value >= TOKEN_PURCHASE_LIMITS.minTokens && tokens.value <= TOKEN_PURCHASE_LIMITS.maxTokens);
const priceSol = computed(() => (quote.value ? formatSol(quote.value.lamportsTotal) : "…"));
const maxSol = computed(() => (quote.value ? formatSol(quote.value.maxLamportsIn) : "…"));
const priceUsd = computed(() => (quote.value ? formatUsd(quote.value.lamportsTotal, quote.value) : null));
const balanceSol = computed(() => (balance.value === null ? "…" : formatSol(balance.value, 3)));
const needed = computed(() => (quote.value ? BigInt(quote.value.maxLamportsIn) + WALLET_RENT_FLOOR_LAMPORTS : 0n));
const shortBy = computed(() => (quote.value && balance.value !== null && needed.value > balance.value ? needed.value - balance.value : 0n));
const explorerUrl = computed(() => `https://explorer.solana.com/tx/${signature.value}?cluster=${config.public.solanaCluster}`);
const buying = computed(() => phase.value === "buying");

async function refreshBalance() {
   if (session.walletAddress) balance.value = await getBalanceLamports(config.public.solanaRpcUrl, session.walletAddress);
}

let requestId = 0;
async function refreshQuote() {
   if (!validAmount.value) {
      quote.value = null;
      loadError.value = `Choose between ${TOKEN_PURCHASE_LIMITS.minTokens} and ${TOKEN_PURCHASE_LIMITS.maxTokens.toLocaleString("en-US")} $MOST.`;
      loading.value = false;
      return;
   }
   const mine = ++requestId;
   loading.value = true;
   loadError.value = "";
   try {
      const [fresh] = await Promise.all([fetchTokenQuote({ api: session.api }, tokens.value), refreshBalance()]);
      if (mine === requestId) quote.value = fresh;
   } catch (error) {
      if (mine === requestId) {
         quote.value = null;
         loadError.value = error instanceof Error ? error.message : "Could not load the price.";
      }
   } finally {
      if (mine === requestId) loading.value = false;
   }
}

function pick(amount: number) {
   custom.value = "";
   tokens.value = amount;
}

watch(custom, (value) => {
   if (value === "") return;
   tokens.value = /^\d{1,6}$/.test(value) ? Number(value) : 0;
});
watch(tokens, () => {
   phase.value = "idle";
   void refreshQuote();
});

onMounted(async () => {
   // Keep the identity-check state fresh so the buy button sends an unverified user to the check.
   void session.refreshKyc().catch(() => undefined);
   await refreshQuote();
});

async function onBuy() {
   if (buying.value) return;
   failure.value = "";
   // The identity check comes first and does not depend on the price loading.
   await session.refreshKyc().catch(() => undefined);
   if (session.needsKyc) return void (await navigateTo("/verify?next=/buy"));
   if (!quote.value) return;
   if (shortBy.value > 0n) {
      // Not enough SOL: pay the difference by card first (rounded up, never below what MoonPay sells).
      moonpaySol.value = Math.max(MIN_CARD_SOL, Math.ceil((Number(shortBy.value) / 1e9) * 100) / 100);
      moonpayOpen.value = true;
      return;
   }
   await buy();
}

async function onCardPaid() {
   await refreshQuote();
   await refreshBalance();
   if (shortBy.value > 0n) {
      failure.value = "The card payment is not in your wallet yet or is still too small. Wait a moment and try again.";
      phase.value = "failed";
      return;
   }
   await buy();
}

async function buy() {
   const current = quote.value;
   if (!current) return;
   phase.value = "buying";
   boughtTokens = current.tokens;
   try {
      const ctx = session.purchaseContext((sig) => (signature.value = sig));
      const result = await buyMostTokens(ctx, { tokens: current.tokens, approvedMaxLamportsIn: current.maxLamportsIn });
      signature.value = result.signature;
      phase.value = result.status === "confirmed" ? "done" : "pending";
      await refreshBalance().catch(() => undefined);
   } catch (error) {
      console.error("[mostro] buying $MOST failed", error);
      if (error instanceof PurchaseError && error.kind === "kyc_required") return void (await navigateTo("/verify?next=/buy"));
      failure.value = error instanceof Error ? error.message : "Something went wrong. Nothing was bought.";
      phase.value = "failed";
      if (error instanceof PurchaseError && (error.kind === "quote_changed" || error.kind === "slippage")) await refreshQuote();
   }
}
</script>

<template>
   <AppShell title="Buy $MOST" back-to="/pass" :max-width="560">
      <div class="buy">
         <template v-if="phase === 'done' || phase === 'pending'">
            <UiStatus
               :title="phase === 'done' ? `You bought ${boughtTokens.toLocaleString('en-US')} $MOST` : 'Your purchase is on its way'"
               :text="phase === 'done' ? 'The tokens are in your Mostro wallet.' : 'The network has not confirmed it yet. You can check it on the explorer; nothing is charged twice.'"
            >
               <UiButton :href="explorerUrl" variant="secondary" block>View on Solana Explorer</UiButton>
               <UiButton to="/pass" variant="primary" block>Back to the pass</UiButton>
            </UiStatus>
         </template>

         <template v-else>
            <h1 class="buy__title">Buy $MOST</h1>
            <p class="buy__lead">Pick how many tokens you want. The price comes live from the bonding curve.</p>

            <div class="buy__presets" role="group" aria-label="Amount">
               <button v-for="amount in PRESETS" :key="amount" type="button" class="buy__preset" :class="{ 'buy__preset--on': tokens === amount && custom === '' }" @click="pick(amount)">
                  {{ amount.toLocaleString("en-US") }}
               </button>
            </div>
            <UiInput v-model="custom" label="Or type an amount" placeholder="e.g. 250" inputmode="numeric" :maxlength="6" caps />

            <UiCard variant="panel">
               <UiRow label="You get" :value="`${validAmount ? tokens.toLocaleString('en-US') : '…'} $MOST`" />
               <UiRow label="You pay" :value="`${priceSol} SOL`" :hint="priceUsd ? `≈ ${priceUsd}` : undefined" strong />
               <UiRow label="At most" :value="`${maxSol} SOL`" hint="If the price moves while you confirm" />
               <UiRow label="Wallet balance" :value="`${balanceSol} SOL`" />
            </UiCard>

            <p v-if="loadError" class="buy__error" role="alert">{{ loadError }}</p>
            <p v-if="phase === 'failed' && failure" class="buy__error" role="alert">{{ failure }}</p>
            <p v-if="shortBy > 0n && quote" class="buy__note">Your wallet needs more SOL for this. After you confirm, you will pay the difference by card.</p>
            <p v-if="session.needsKyc" class="buy__note">You need to verify your identity before you can buy. We will take you there first.</p>

            <UiButton variant="primary" block :loading="buying" :disabled="!validAmount || (!session.needsKyc && (!quote || loading))" @click="onBuy">
               {{ buying ? "Buying…" : session.needsKyc ? "Verify your identity to buy" : `Buy ${validAmount ? tokens.toLocaleString("en-US") : ""} $MOST` }}
            </UiButton>
            <p class="buy__note">No network fee: Mostro pays it. Solana payments are final and can't be reversed.</p>
         </template>
      </div>
      <MoonpayModal v-model="moonpayOpen" :amount-sol="moonpaySol" @completed="onCardPaid" @cancelled="phase = 'idle'" />
   </AppShell>
</template>

<style scoped>
.buy {
   display: flex;
   flex-direction: column;
   gap: 16px;
}
.buy__title {
   margin: 0;
   font-size: 28px;
   font-weight: 600;
}
.buy__lead {
   margin: 0;
   color: var(--m-muted);
   font-size: 14px;
}
.buy__presets {
   display: grid;
   grid-template-columns: repeat(4, 1fr);
   gap: 8px;
}
.buy__preset {
   padding: 12px 0;
   border: 1px solid var(--m-border);
   border-radius: 12px;
   background: transparent;
   color: inherit;
   font: inherit;
   font-weight: 600;
   cursor: pointer;
}
.buy__preset--on {
   border-color: var(--m-lime);
   color: var(--m-lime);
}
.buy__error {
   margin: 0;
   color: #ff6b6b;
   font-size: 14px;
}
.buy__note {
   margin: 0;
   color: var(--m-muted);
   font-size: 12px;
}
</style>
