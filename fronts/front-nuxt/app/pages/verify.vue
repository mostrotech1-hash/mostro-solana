<script setup lang="ts">
// Identity check with Sumsub. The widget only collects the documents; the result comes from our server (webhook), never from the widget.
const session = useSessionStore();
const route = useRoute();
// Where to go once the check is approved (only a path inside the app, never another site).
const next = computed(() => {
   const value = typeof route.query.next === "string" ? route.query.next : "";
   return value.startsWith("/") && !value.startsWith("//") ? value : "/pass";
});

const loading = ref(true);
const error = ref("");
/** After the user submits, wait for the server to hear the verdict from Sumsub. */
const waiting = ref(false);
let dispose: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const done = computed(() => session.kycStatus === "approved");
const rejected = computed(() => session.kycStatus === "rejected");
const inReview = computed(() => session.kycStatus === "pending" || waiting.value);
const showWidget = computed(() => !done.value && !inReview.value && !rejected.value);

function stopPolling() {
   if (timer) clearInterval(timer);
   timer = null;
}

function startPolling() {
   stopPolling();
   waiting.value = true;
   let tries = 0;
   timer = setInterval(async () => {
      tries += 1;
      try {
         const status = await session.refreshKyc();
         if (status === "approved" || status === "rejected") {
            waiting.value = false;
            stopPolling();
            if (status === "approved") await navigateTo(next.value);
         }
      } catch {
         // keep trying; the next tick may work
      }
      if (tries >= 60) stopPolling(); // about 4 minutes; the result still arrives, the user can come back
   }, 4000);
}

async function start() {
   error.value = "";
   loading.value = true;
   try {
      const status = await session.refreshKyc();
      if (status === "approved" && route.query.next) return void (await navigateTo(next.value));
      if (status === "pending") return startPolling();
      if (status !== "none") return;
      await nextTick();
      dispose = await launchKycWidget({
         container: "#sumsub-container",
         email: session.profile?.email,
         getToken: () => session.kycToken(),
         onReady: () => (loading.value = false),
         onSubmitted: () => {
            dispose?.();
            dispose = null;
            startPolling();
         },
         onError: (message) => {
            error.value = message;
            loading.value = false;
         },
      });
   } catch (err) {
      error.value = err instanceof Error && err.message ? err.message : "Identity verification is not available right now.";
      loading.value = false;
   }
}

async function retry() {
   // A refused check can be repeated: the widget opens again for the same account.
   waiting.value = false;
   if (session.profile) session.profile = { ...session.profile, kycStatus: "none" };
   await start();
}

onMounted(start);
onBeforeUnmount(() => {
   stopPolling();
   dispose?.();
});
</script>

<template>
   <AppShell title="Identity check" back-to="/pass" :max-width="560">
      <div class="verify">
         <UiStatus v-if="done" title="You are verified" text="Your identity check is complete.">
            <UiButton :to="next" variant="primary" block>Continue</UiButton>
         </UiStatus>

         <UiStatus v-else-if="inReview" title="We are checking your documents" text="This usually takes a few minutes. You can leave this page; we will keep your result." animated>
            <UiButton to="/pass" variant="secondary" block>Back to the pass</UiButton>
         </UiStatus>

         <UiStatus v-else-if="rejected" title="We could not verify you" text="The check was not successful. You can try again with clearer documents.">
            <UiButton variant="primary" block @click="retry">Try again</UiButton>
         </UiStatus>

         <template v-if="showWidget">
            <h1 class="verify__title">Verify your identity</h1>
            <p class="verify__lead">{{ route.query.next ? "You need to verify your identity before you can buy. " : "" }}A quick check with our partner Sumsub. Your documents are handled by Sumsub, not stored by Mostro.</p>
            <div class="verify__stage">
               <div id="sumsub-container" />
               <UiLoading v-if="loading" text="Loading verification…" />
            </div>
         </template>

         <p v-if="error" class="verify__error" role="alert">{{ error }}</p>
         <UiButton v-if="error" variant="secondary" block @click="start">Try again</UiButton>
      </div>
   </AppShell>
</template>

<style scoped>
.verify {
   display: flex;
   flex-direction: column;
   gap: 16px;
}
.verify__title {
   margin: 0;
   font-size: 28px;
   font-weight: 600;
}
.verify__lead {
   margin: 0;
   color: var(--m-muted);
   font-size: 14px;
}
.verify__stage {
   position: relative;
   min-height: 560px;
}
.verify__error {
   margin: 0;
   color: #ff6b6b;
   font-size: 14px;
}
</style>
