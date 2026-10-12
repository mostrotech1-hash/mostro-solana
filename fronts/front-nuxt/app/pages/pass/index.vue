<script setup lang="ts">
import passImage from "~/assets/images/pass-solana-edition.jpg";

// H03 · The pass, paid in SOL  +  H04 · Review and confirm (sheet on phones, modal on desktop)
const session = useSessionStore();
const route = useRoute();
// "Try again" on the cancelled screen comes back here with the confirmation already open (H04).
const confirmOpen = ref(route.query.confirm === "1");
const purchase = usePurchaseStore();
// The only way to pay is by card: confirming opens the MoonPay window, and the SOL lands in the user's wallet.
const moonpayOpen = ref(false);

const leftAfter = computed(() => (PLACEHOLDER_WALLET_BALANCE_SOL - PASS.priceSol).toFixed(2));
const wallet = computed(() => (session.walletAddress ? `Mostro wallet · ${shortAddress(session.walletAddress)}` : "Mostro wallet"));
const buyLabel = `Buy pass · ${PASS.priceSol} SOL`;

function onConfirm() {
   // Step 1: pay by card with MoonPay. Step 2 (the pass is minted with that SOL) starts on the "paying" screen.
   purchase.reset();
   confirmOpen.value = false;
   moonpayOpen.value = true;
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
               <p class="pass__supply">{{ PASS.left }} of {{ PASS.supply }} passes left</p>
            </UiCard>
            <UiCard variant="panel" class="pass__price">
               <div class="pass__price-row">
                  <span class="pass__sol">{{ PASS.priceSol }} SOL</span>
                  <span class="pass__usd">≈ ${{ PASS.priceUsd }}</span>
               </div>
               <p class="pass__balance">Wallet balance: {{ PLACEHOLDER_WALLET_BALANCE_SOL.toFixed(2) }} SOL</p>
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
                     <span class="pass__sol pass__sol--lime">{{ PASS.priceSol }} SOL</span>
                     <span class="pass__usd">≈ ${{ PASS.priceUsd }}</span>
                  </div>
                  <p class="pass__balance">{{ PASS.left }} of {{ PASS.supply }} passes left · Wallet balance: {{ PLACEHOLDER_WALLET_BALANCE_SOL.toFixed(2) }} SOL</p>
               </div>
               <div>
                  <UiButton variant="dark" @click="confirmOpen = true">{{ buyLabel }}</UiButton>
               </div>
               <p class="pass__fee pass__fee--ink">Network fee: under $0.01. You'll see the exact amount before you confirm.</p>
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
            <UiButton variant="primary" block @click="confirmOpen = true">{{ buyLabel }}</UiButton>
            <p class="pass__fee">Network fee: under $0.01. You'll see the exact amount before you confirm.</p>
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
            <UiRow strong label="You pay" :hint="`≈ $${PASS.priceUsd}`" :value="`${PASS.priceSol} SOL`" />
            <UiRow label="Network fee" :hint="`${PASS.networkFeeSol} SOL`" :value="`≈ $${PASS.networkFeeUsd}`" />
            <UiRow label="Paying from" :value="wallet" />
            <UiRow label="Balance after purchase" :value="`${leftAfter} SOL`" />
         </div>
         <p class="confirm__note">Solana payments are final and can't be reversed. Please review the amount before confirming.</p>
         <UiButton variant="primary" block @click="onConfirm">Confirm and pay {{ PASS.priceSol }} SOL</UiButton>
         <UiButton variant="secondary" block @click="onCancel">Cancel</UiButton>
      </UiSheet>

      <MoonpayModal v-model="moonpayOpen" :amount-sol="PASS.priceSol" @completed="onCardPaid" @cancelled="onCardCancelled" />
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
