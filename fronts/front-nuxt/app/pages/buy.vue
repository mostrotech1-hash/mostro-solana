<script setup lang="ts">
import { TOKEN_PURCHASE_LIMITS, type TokenQuote } from "@mostro/shared/api";

// Buy $MOOG: pick an amount, see the live price from the curve, pay from the Mostro wallet (card through MoonPay when it is short).
const session = useSessionStore();
const wallet = useWalletStore();
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
// A quote for another amount is never shown: while the new one loads, the price reads "…" instead of a wrong number.
const fresh = computed(() => (quote.value && quote.value.tokens === tokens.value ? quote.value : null));
const priceSol = computed(() => (fresh.value ? formatSolPrice(fresh.value.lamportsTotal) : "…"));
const maxSol = computed(() => (fresh.value ? formatSolPrice(fresh.value.maxLamportsIn) : "…"));
const priceUsd = computed(() => (fresh.value ? formatUsd(fresh.value.lamportsTotal, fresh.value) : null));
const balanceSol = computed(() => (balance.value === null ? "…" : formatSol(balance.value, 3)));
const needed = computed(() => (fresh.value ? BigInt(fresh.value.maxLamportsIn) + WALLET_RENT_FLOOR_LAMPORTS : 0n));
const shortBy = computed(() => (fresh.value && balance.value !== null && needed.value > balance.value ? needed.value - balance.value : 0n));
const explorerUrl = computed(() => `https://explorer.solana.com/tx/${signature.value}?cluster=${config.public.solanaCluster}`);
const buying = computed(() => phase.value === "buying");

async function refreshBalance() {
   if (session.walletAddress) balance.value = await getBalanceLamports(config.public.solanaRpcUrl, session.walletAddress);
}

let requestId = 0;
async function refreshQuote() {
   if (!validAmount.value) {
      quote.value = null;
      loadError.value = `Choose between ${TOKEN_PURCHASE_LIMITS.minTokens} and ${TOKEN_PURCHASE_LIMITS.maxTokens.toLocaleString("en-US")} $MOOG.`;
      loading.value = false;
      return;
   }
   const mine = ++requestId;
   loading.value = true;
   loadError.value = "";
   try {
      const [latest] = await Promise.all([fetchTokenQuote({ api: session.api }, tokens.value), refreshBalance()]);
      if (mine === requestId) quote.value = latest;
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
   clearTimeout(typing);
   custom.value = "";
   tokens.value = amount;
}

// Typing an amount asks for a new price only after a short pause, not on every key.
let typing: ReturnType<typeof setTimeout> | undefined;
watch(custom, (value) => {
   clearTimeout(typing);
   if (value === "") return;
   typing = setTimeout(() => (tokens.value = /^\d{1,6}$/.test(value) ? Number(value) : 0), 350);
});
onBeforeUnmount(() => clearTimeout(typing));
watch(tokens, () => {
   phase.value = "idle";
   void refreshQuote();
});

onMounted(async () => {
   void wallet.refresh();
   await session.loadFeatures();
   if (!session.chainEnabled) {
      loading.value = false;
      return;
   }
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
   if (!fresh.value) return;
   if (shortBy.value > 0n) {
      // Not enough SOL: pay the difference by card first (rounded up, never below what MoonPay sells).
      moonpaySol.value = Math.max(MIN_CARD_SOL, Math.ceil((Number(shortBy.value) / 1e9) * 100) / 100);
      moonpayOpen.value = true;
      return;
   }
   await buy();
}

/** The user chose to pay by card (MoonPay) even though the wallet may already hold enough SOL. */
async function onBuyByCard() {
   if (buying.value) return;
   failure.value = "";
   await session.refreshKyc().catch(() => undefined);
   if (session.needsKyc) return void (await navigateTo("/verify?next=/buy"));
   if (!fresh.value) return;
   moonpaySol.value = Math.max(MIN_CARD_SOL, Math.ceil((Number(shortBy.value) / 1e9) * 100) / 100);
   moonpayOpen.value = true;
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
   const current = fresh.value;
   if (!current) return;
   phase.value = "buying";
   boughtTokens = current.tokens;
   try {
      const ctx = session.purchaseContext((sig) => (signature.value = sig));
      const result = await buyMostTokens(ctx, { tokens: current.tokens, approvedMaxLamportsIn: current.maxLamportsIn });
      signature.value = result.signature;
      phase.value = result.status === "confirmed" ? "done" : "pending";
      await refreshBalance().catch(() => undefined);
      void wallet.refresh(true);
   } catch (error) {
      console.error("[mostro] buying $MOOG failed", error);
      if (error instanceof PurchaseError && error.kind === "kyc_required") return void (await navigateTo("/verify?next=/buy"));
      failure.value = error instanceof Error ? error.message : "Something went wrong. Nothing was bought.";
      phase.value = "failed";
      if (error instanceof PurchaseError && (error.kind === "quote_changed" || error.kind === "slippage")) await refreshQuote();
   }
}
</script>

<template>
   <AppShell title="Buy $MOOG" back-to="/pass" :max-width="560">
      <div class="buy">
         <UiStatus v-if="!session.chainEnabled" title="Buying $MOOG opens soon" text="We are finishing the setup on Solana. Your account and identity check are ready.">
            <UiButton v-if="session.needsKyc" to="/verify?next=/buy" variant="primary" block>Verify your identity</UiButton>
            <UiButton to="/pass" variant="secondary" block>Back to the pass</UiButton>
         </UiStatus>

         <template v-else-if="phase === 'done' || phase === 'pending'">
            <UiStatus
               :title="phase === 'done' ? `You bought ${boughtTokens.toLocaleString('en-US')} $MOOG` : 'Your purchase is on its way'"
               :text="phase === 'done' ? (wallet.token === null ? 'The tokens are in your Mostro wallet.' : `You now own ${formatTokens(wallet.token)} $MOOG in your Mostro wallet.`) : 'The network has not confirmed it yet. You can check it on the explorer; nothing is charged twice.'"
            >
               <UiButton to="/wallet" variant="primary" block>View my wallet</UiButton>
               <UiButton :href="explorerUrl" variant="secondary" block>View on Solana Explorer</UiButton>
               <UiButton to="/pass" variant="secondary" block>Back to the pass</UiButton>
            </UiStatus>
         </template>

         <template v-else>
            <h1 class="buy__title">Buy $MOOG</h1>
            <p class="buy__lead">Pick how many tokens you want. The price comes live from the bonding curve.</p>

            <div class="buy__presets" role="group" aria-label="Amount">
               <button v-for="amount in PRESETS" :key="amount" type="button" class="buy__preset" :class="{ 'buy__preset--on': tokens === amount && custom === '' }" :aria-pressed="tokens === amount && custom === ''" @click="pick(amount)">
                  {{ amount.toLocaleString("en-US") }}
               </button>
            </div>
            <UiInput v-model="custom" label="Or type an amount" placeholder="e.g. 250" inputmode="numeric" :maxlength="6" caps />
            <p class="buy__note">From {{ TOKEN_PURCHASE_LIMITS.minTokens }} to {{ TOKEN_PURCHASE_LIMITS.maxTokens.toLocaleString("en-US") }} $MOOG per purchase.</p>

            <UiCard variant="panel" class="buy__summary" aria-live="polite" :aria-busy="loading">
               <UiRow label="You get" :value="`${validAmount ? tokens.toLocaleString('en-US') : '…'} $MOOG`" />
               <UiRow label="You pay" :value="`${priceSol} SOL`" :hint="priceUsd ? `≈ ${priceUsd}` : undefined" strong />
               <UiRow label="At most" :value="`${maxSol} SOL`" hint="If the price moves while you confirm" />
               <UiRow label="Wallet balance" :value="`${balanceSol} SOL`" />
               <UiRow label="You own" :value="`${wallet.token === null ? '…' : formatTokens(wallet.token)} $MOOG`" />
            </UiCard>

            <p v-if="loadError" class="buy__error" role="alert">{{ loadError }}</p>
            <p v-if="phase === 'failed' && failure" class="buy__error" role="alert">{{ failure }}</p>
            <p v-if="shortBy > 0n && fresh" class="buy__note">Your wallet needs more SOL for this. After you confirm, you will pay the difference by card.</p>
            <p v-if="session.needsKyc" class="buy__note">You need to verify your identity before you can buy. We will take you there first.</p>

            <UiButton variant="primary" block :loading="buying" :disabled="!validAmount || (!session.needsKyc && (!fresh || loading))" @click="onBuy">
               {{ buying ? "Buying…" : session.needsKyc ? "Verify your identity to buy" : `Buy ${validAmount ? tokens.toLocaleString("en-US") : ""} $MOOG` }}
            </UiButton>
            <UiButton v-if="!session.needsKyc" variant="secondary" block :disabled="buying || !fresh || loading || !validAmount" @click="onBuyByCard">Pay by card (MoonPay)</UiButton>
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
   min-height: 44px;
   padding: 12px 0;
   transition:
      border-color 0.15s ease,
      color 0.15s ease,
      transform 0.1s ease;
   border: 1px solid var(--m-border);
   border-radius: 12px;
   background: transparent;
   color: inherit;
   font: inherit;
   font-weight: 600;
   cursor: pointer;
}
.buy__preset:hover {
   border-color: var(--m-muted);
}
.buy__preset:active {
   transform: scale(0.97);
}
.buy__preset:focus-visible {
   outline: 2px solid var(--m-lime);
   outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
   .buy__preset {
      transition: none;
   }
   .buy__preset:active {
      transform: none;
   }
}
.buy__preset--on {
   border-color: var(--m-lime);
   color: var(--m-lime);
}
.buy__error {
   margin: 0;
   color: var(--m-danger, #ff6b6b);
   font-size: 14px;
}
.buy__note {
   margin: 0;
   color: var(--m-muted);
   font-size: 12px;
}
</style>
