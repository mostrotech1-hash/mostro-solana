<script setup lang="ts">
import type { PassOwnershipResponse, PassQuote } from "@mostro/shared/api";
import passImage from "~/assets/images/Mo-OG-Pass-x.png";

// H03 · The pass, paid in SOL  +  H04 · Review and confirm (sheet on phones, modal on desktop)
const session = useSessionStore();
const route = useRoute();
const config = useRuntimeConfig();
// "Try again" on the cancelled screen comes back here with the confirmation already open (H04).
const confirmOpen = ref(false);
const purchase = usePurchaseStore();
// Only when the wallet holds less SOL than the pass needs: the user tops up by card with MoonPay.
const moonpayOpen = ref(false);

// The price comes live from the bonding curve (through the API), the balance from Solana devnet.
const quote = computed(() => purchase.quote);
const balance = ref<bigint | null>(null);
const loadError = ref("");
const loading = ref(true);

async function refresh() {
   loading.value = true;
   loadError.value = "";
   try {
      const [fresh, lamports] = await Promise.all([session.api<PassQuote>("/pass/quote"), getBalanceLamports(config.public.solanaRpcUrl, session.walletAddress ?? "")]);
      purchase.quote = fresh;
      balance.value = lamports;
   } catch (error) {
      loadError.value = error instanceof Error ? error.message : "Could not load the price.";
   } finally {
      loading.value = false;
   }
}

// A wallet that already owns the pass goes straight to the success screen instead of being asked to buy again.
async function redirectIfOwned(): Promise<boolean> {
   if (purchase.inProgress || !session.walletAddress) return false;
   try {
      const status = await session.api<PassOwnershipResponse>(`/pass/ownership?walletAddress=${encodeURIComponent(session.walletAddress)}`);
      if (!status.owned) {
         purchase.owned = null;
         return false;
      }
      purchase.owned = { edition: status.edition, asset: status.asset };
      await navigateTo("/pass/success", { replace: true });
      return true;
   } catch (error) {
      console.warn("[mostro] could not check the pass ownership", error);
      return false;
   }
}

onMounted(async () => {
   if (route.query.confirm !== "1" && (await redirectIfOwned())) return;
   await refresh();
   // The price shown when the user confirms is always a fresh one.
   if (route.query.confirm === "1" && quote.value) confirmOpen.value = true;
});

const priceSol = computed(() => (quote.value ? formatSol(quote.value.lamportsTotal) : "…"));
const maxSol = computed(() => (quote.value ? formatSol(quote.value.maxLamportsIn) : "…"));
const priceUsd = computed(() => (quote.value ? formatUsd(quote.value.lamportsTotal, quote.value) : null));
const balanceSol = computed(() => (balance.value === null ? "…" : formatSol(balance.value, 3)));
const left = computed(() => passesLeft(quote.value));
const leftAfter = computed(() =>
   quote.value && balance.value !== null ? formatSol(balance.value > BigInt(quote.value.lamportsTotal) ? balance.value - BigInt(quote.value.lamportsTotal) : 0n, 3) : "…",
);
const wallet = computed(() => (session.walletAddress ? `Mostro wallet · ${shortAddress(session.walletAddress)}` : "Mostro wallet"));
const buyLabel = computed(() => `Buy pass · ${priceSol.value} SOL`);
const canBuy = computed(() => quote.value !== null && quote.value.pass.active && left.value !== 0 && !loading.value);
const shortBy = computed(() => (quote.value && balance.value !== null ? requiredLamports(quote.value) - balance.value : 0n));
// The card step always buys 0.15 SOL (the MoonPay minimum). Any extra stays in the wallet.
const MOONPAY_AMOUNT_SOL = 0.15;

function onOpenConfirm() {
   if (!canBuy.value) return;
   // Re-read the price so what is reviewed is what gets signed.
   void refresh().then(() => (confirmOpen.value = quote.value !== null));
}

function onConfirm() {
   if (!quote.value || purchase.inProgress) return;
   // The user approved this ceiling. Nothing above it is ever signed, even if the price moves.
   purchase.reset();
   purchase.approvedMaxLamportsIn = quote.value.maxLamportsIn;
   confirmOpen.value = false;
   // Enough SOL: buy straight away. Short: top up by card first, then buy.
   if (shortBy.value > 0n) moonpayOpen.value = true;
   else void navigateTo("/pass/paying");
}

function onCardPaid() {
   purchase.cardPaid = true;
   return navigateTo("/pass/paying");
}

function onCardCancelled() {
   // The window was closed before the payment finished.
   return navigateTo("/pass/cancelled");
}

function onCancel() {
   confirmOpen.value = false;
   return navigateTo("/pass/cancelled");
}
</script>

<template>
   <AppShell title="The pass" back-to="/profile">
      <div class="pass">
         <!-- Phones: pass card, then the price panel. -->
         <div class="pass__phone">
            <UiCard variant="lime" class="pass__card">
               <img :src="passImage" alt="Pass visual · Solana edition" class="pass__visual" width="640" height="480" />
               <UiBadge>{{ PASS.edition }}</UiBadge>
               <h1 class="pass__name">{{ PASS.name }}</h1>
               <p class="pass__description">{{ PASS.description }}</p>
               <p v-if="left !== null && quote" class="pass__supply">{{ left }} of {{ quote.pass.maxSupply }} passes left</p>
            </UiCard>
            <UiCard variant="panel" class="pass__price">
               <div class="pass__price-row">
                  <span class="pass__sol">{{ priceSol }} SOL</span>
                  <span v-if="priceUsd" class="pass__usd">≈ {{ priceUsd }}</span>
               </div>
               <p class="pass__balance">Wallet balance: {{ balanceSol }} SOL</p>
               <p v-if="loadError" class="pass__error">{{ loadError }} <button class="pass__retry" type="button" @click="refresh">Try again</button></p>
            </UiCard>
         </div>

         <!-- Desktop: one lime card with the picture on the left and the price and button on the right. -->
         <UiCard variant="lime" class="pass__desktop">
            <img :src="passImage" alt="Pass visual · Solana edition" class="pass__visual pass__visual--desktop" width="640" height="480" />
            <div class="pass__aside">
               <UiBadge>{{ PASS.edition }}</UiBadge>
               <h1 class="pass__name pass__name--desktop">{{ PASS.name }}</h1>
               <p class="pass__description pass__description--desktop">{{ PASS.description }}</p>
               <div class="pass__price-dark">
                  <div class="pass__price-row pass__price-row--inline">
                     <span class="pass__sol pass__sol--lime">{{ priceSol }} SOL</span>
                     <span v-if="priceUsd" class="pass__usd">≈ {{ priceUsd }}</span>
                  </div>
                  <p class="pass__balance">
                     <template v-if="left !== null && quote">{{ left }} of {{ quote.pass.maxSupply }} passes left · </template>Wallet balance: {{ balanceSol }} SOL
                  </p>
                  <p v-if="loadError" class="pass__error">{{ loadError }} <button class="pass__retry" type="button" @click="refresh">Try again</button></p>
               </div>
               <div>
                  <UiButton variant="dark" :disabled="!canBuy" @click="onOpenConfirm">{{ buyLabel }}</UiButton>
               </div>
               <p class="pass__fee pass__fee--ink">No network fee: Mostro pays it. You'll see the exact price before you confirm.</p>
            </div>
         </UiCard>

         <div class="pass__details">
            <UiSection title="What you get">
               <UiRow v-for="perk in PASS.perks" :key="perk.label" :label="perk.label" :value="perk.value" />
            </UiSection>
            <UiSection title="How it works">
               <UiRow v-for="step in PASS.steps" :key="step.label" :label="step.label" :value="step.value" />
            </UiSection>
         </div>

         <!-- Phones: the buy button sits below the details. -->
         <div class="pass__buy">
            <UiButton variant="primary" block :disabled="!canBuy" @click="onOpenConfirm">{{ buyLabel }}</UiButton>
            <p class="pass__fee">No network fee: Mostro pays it. You'll see the exact price before you confirm.</p>
         </div>
      </div>

      <UiSheet v-model="confirmOpen" title="Confirm your purchase">
         <div class="confirm__receive">
            <img :src="passImage" alt="" class="confirm__thumb" width="56" height="56" />
            <div>
               <p class="confirm__muted">You receive</p>
               <p class="confirm__strong">{{ PASS.name }}</p>
            </div>
         </div>
         <div>
            <UiRow strong label="You pay" :hint="priceUsd ? `≈ ${priceUsd}` : undefined" :value="`${priceSol} SOL`" />
            <UiRow label="Price protection" hint="The most you can pay if the price moves" :value="`${maxSol} SOL`" />
            <UiRow label="Network fee" value="Paid by Mostro" />
            <UiRow label="Paying from" :value="wallet" />
            <UiRow label="Balance after purchase" :value="`${leftAfter} SOL`" />
         </div>
         <p v-if="shortBy > 0n" class="confirm__note">Your wallet needs more SOL for this pass. After you confirm, you will pay by card.</p>
         <p class="confirm__note">Solana payments are final and can't be reversed. Please review the amount before confirming.</p>
         <UiButton variant="primary" block @click="onConfirm">Confirm and pay {{ priceSol }} SOL</UiButton>
         <UiButton variant="secondary" block @click="onCancel">Cancel</UiButton>
      </UiSheet>

      <MoonpayModal v-model="moonpayOpen" :amount-sol="MOONPAY_AMOUNT_SOL" @completed="onCardPaid" @cancelled="onCardCancelled" />
   </AppShell>
</template>

<style scoped>
.pass {
   display: flex;
   flex-direction: column;
   gap: 16px;
}
.pass__phone {
   display: flex;
   flex-direction: column;
   gap: 16px;
}
.pass__desktop {
   display: none;
}
.pass__card {
   display: flex;
   flex-direction: column;
   align-items: flex-start;
   gap: 14px;
}
.pass__visual {
   width: 100%;
   height: 200px;
   object-fit: cover;
   border-radius: 16px;
}
.pass__name {
   margin: 0;
   font-size: 24px;
   font-weight: 600;
   line-height: 1.4;
}
.pass__description {
   margin: 0;
   font-size: 14px;
   line-height: 1.4;
}
.pass__supply {
   margin: 0;
   font-size: 12px;
   font-weight: 500;
}
.pass__price {
   display: flex;
   flex-direction: column;
   gap: 4px;
}
.pass__price-row {
   display: flex;
   align-items: flex-end;
   justify-content: space-between;
}
.pass__sol {
   font-size: 32px;
   font-weight: 600;
   line-height: 1.4;
}
.pass__usd {
   font-size: 14px;
   color: var(--m-muted);
}
.pass__balance {
   margin: 0;
   font-size: 13px;
   color: var(--m-muted);
}
.pass__error {
   margin: 0;
   font-size: 13px;
}
.pass__retry {
   border: 0;
   background: none;
   padding: 0;
   color: inherit;
   font: inherit;
   text-decoration: underline;
   cursor: pointer;
}
.pass__details {
   display: flex;
   flex-direction: column;
   gap: 16px;
}
.pass__buy {
   display: flex;
   flex-direction: column;
   align-items: center;
   gap: 4px;
}
.pass__fee {
   margin: 0;
   font-size: 12px;
   color: var(--m-muted);
   text-align: center;
}
.confirm__receive {
   display: flex;
   align-items: center;
   gap: 14px;
}
.confirm__thumb {
   width: 56px;
   height: 56px;
   border-radius: 12px;
   object-fit: cover;
}
.confirm__muted {
   margin: 0;
   font-size: 12px;
   color: var(--m-muted);
}
.confirm__strong {
   margin: 2px 0 0;
   font-size: 16px;
   font-weight: 600;
}
.confirm__note {
   margin: 0;
   padding: 12px;
   border-radius: 12px;
   background: var(--m-warning);
   color: var(--m-ink);
   font-size: 13px;
   line-height: 1.4;
}

@media (min-width: 900px) {
   .pass {
      gap: 32px;
   }
   .pass__phone,
   .pass__buy {
      display: none;
   }
   .pass__desktop {
      display: flex;
      align-items: stretch;
      gap: 32px;
   }
   .pass__visual--desktop {
      flex: none;
      width: 420px;
      height: 360px;
      border-radius: 20px;
   }
   .pass__aside {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 16px;
   }
   .pass__name--desktop {
      font-size: 36px;
   }
   .pass__description--desktop {
      font-size: 16px;
   }
   .pass__price-dark {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 16px;
      border-radius: 16px;
      background: var(--m-bg);
   }
   .pass__price-row--inline {
      justify-content: flex-start;
      gap: 12px;
   }
   .pass__sol--lime {
      color: var(--m-lime);
   }
   .pass__fee--ink {
      color: var(--m-ink);
      text-align: left;
   }
   .pass__details {
      flex-direction: row;
      gap: 32px;
   }
   .pass__details > * {
      flex: 1;
      min-width: 0;
   }
}
</style>
