<script setup lang="ts">
import { loadMoonPay } from "@moonpay/moonpay-js";
import type { PrepareMoonpayRequest, PrepareMoonpayResponse, SignMoonpayUrlRequest, SignMoonpayUrlResponse } from "@mostro/shared/api";

/**
 * MoonPay buy widget (official Web SDK, embedded in this window). The API prepares the widget settings and signs
 * the URL (the MoonPay secret key never reaches the browser); MoonPay delivers the SOL straight to the user's own
 * Mostro wallet, so paying by card means the balance is never short.
 */
const props = defineProps<{ amountSol: number }>();
const open = defineModel<boolean>({ default: false });
// `completed`: the card payment finished. `cancelled`: the window was closed before that.
const emit = defineEmits<{ completed: []; cancelled: [] }>();
const session = useSessionStore();

const CONTAINER_ID = "moonpay-widget";
const loading = ref(false);
const errorMsg = ref("");
let widget: { close(): void } | null = null;
let completedTimer: ReturnType<typeof setTimeout> | undefined;
let completed = false;

function destroyWidget() {
   try {
      widget?.close();
   } catch {
      // The widget may already be closed.
   }
   widget = null;
}

async function start() {
   if (!session.walletAddress) return;
   errorMsg.value = "";
   loading.value = true;
   try {
      const body: PrepareMoonpayRequest = { walletAddress: session.walletAddress, amountSol: props.amountSol };
      const prepared = await session.api<PrepareMoonpayResponse>("/moonpay/prepare", { method: "POST", body });
      const moonPay = await loadMoonPay();
      if (!moonPay) throw new Error("Could not load the payment window.");
      await nextTick();

      const sdk = moonPay({
         flow: "buy",
         environment: prepared.environment,
         variant: "embedded",
         containerNodeSelector: `#${CONTAINER_ID}`,
         useWarnBeforeRefresh: false,
         // allowedIpAddress is MoonPay's IP check; it is a valid widget parameter even though the SDK types do not list it.
         params: prepared.params as never,
         handlers: {
            // The order finished: show the result for a moment, then close the window by itself.
            async onTransactionCompleted() {
               completed = true;
               completedTimer = setTimeout(() => (open.value = false), 1500);
            },
            async onClose() {
               open.value = false;
            },
         },
      });
      if (!sdk) throw new Error("Could not open the payment window.");
      widget = sdk;

      // MoonPay needs a signature because the URL carries a wallet address: the API signs it with the secret key.
      const urlForSignature = sdk.generateUrlForSigning();
      const signBody: SignMoonpayUrlRequest = { urlForSignature, preparationToken: prepared.preparationToken };
      const { signature } = await session.api<SignMoonpayUrlResponse>("/moonpay/sign-url", { method: "POST", body: signBody });
      sdk.updateSignature(signature);
      sdk.show();
   } catch (error) {
      console.error("[mostro] moonpay", error);
      errorMsg.value = error instanceof Error ? error.message : "Could not open the payment window.";
   } finally {
      loading.value = false;
   }
}

watch(open, (isOpen) => {
   if (isOpen) {
      completed = false;
      void start();
      return;
   }
   clearTimeout(completedTimer);
   destroyWidget();
   if (completed) emit("completed");
   else emit("cancelled");
   completed = false;
});
onBeforeUnmount(() => {
   clearTimeout(completedTimer);
   destroyWidget();
});
</script>

<template>
   <UiSheet v-model="open" title="Pay with your card" wide closable fill>
      <p v-if="loading" class="moonpay__note">Opening the payment window…</p>
      <p v-if="errorMsg" class="moonpay__error" role="alert">{{ errorMsg }}</p>
      <div :id="CONTAINER_ID" class="moonpay__frame" />
   </UiSheet>
</template>

<style scoped>
.moonpay__frame {
   flex: 1;
   min-height: 0;
   overflow: hidden;
   border-radius: 16px;
   background: #000;
}
.moonpay__frame :deep(iframe) {
   display: block;
   width: 100%;
   height: 100%;
   border: 0;
}
.moonpay__note {
   margin: 0;
   color: var(--m-muted);
}
.moonpay__error {
   margin: 0;
   color: var(--m-danger);
}
</style>
