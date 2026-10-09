<template>
   <div class="ck-page">
      <div class="ck-card">
         <h1 class="ck-title">Sign in</h1>
         <p class="ck-subtitle">Connect your account to continue</p>

         <form v-if="step === 'method'" class="ck-list" @submit.prevent="onSendCode">
            <div class="ck-input-row">
               <input v-model="email" type="email" placeholder="Email address" required autocomplete="username" class="ck-input" />
               <button type="submit" :disabled="loading" class="ck-input-submit" aria-label="Send code">→</button>
            </div>
            <div class="ck-divider">or</div>
            <button type="button" :disabled="loading" class="ck-row" @click="onGoogle">Continue with Google</button>
            <p v-if="errorMsg" class="ck-error">{{ errorMsg }}</p>
         </form>

         <form v-else class="ck-list" @submit.prevent="onVerifyCode">
            <p class="ck-subtitle">
               Code sent to <strong>{{ email }}</strong>
            </p>
            <input v-model="code" inputmode="numeric" placeholder="Verification code" required autocomplete="one-time-code" class="ck-input-row ck-input" />
            <p v-if="errorMsg" class="ck-error">{{ errorMsg }}</p>
            <button type="submit" :disabled="loading" class="ck-primary-button">{{ loading ? "Verifying…" : "Verify & continue" }}</button>
            <button type="button" class="ck-link-button" @click="step = 'method'">Use a different email</button>
         </form>
      </div>
   </div>
</template>

<script setup lang="ts">
const session = useSessionStore();

const step = ref<"method" | "code">("method");
const email = ref("");
const code = ref("");
const loading = ref(false);
const errorMsg = ref("");

onMounted(async () => {
   try {
      await session.init();
      if (session.isAuthenticated) await navigateTo("/wallet");
   } catch (err) {
      console.error("[openfort] init failed", err);
      errorMsg.value = err instanceof Error ? err.message : "Could not start Openfort.";
   }
});

async function run(fn: () => Promise<void>, fallback: string) {
   loading.value = true;
   errorMsg.value = "";
   try {
      await fn();
   } catch (err) {
      console.error("[openfort]", err);
      errorMsg.value = fallback;
   } finally {
      loading.value = false;
   }
}

const onSendCode = () =>
   run(async () => {
      await session.requestEmailCode(email.value.trim());
      step.value = "code";
   }, "Could not send the code. Check the email and try again.");

const onVerifyCode = () =>
   run(async () => {
      await session.verifyEmailCode(email.value.trim(), code.value.trim());
      await navigateTo("/wallet");
   }, "Invalid or expired code. Try again.");

const onGoogle = () => run(() => session.startGoogle(), "Could not start Google sign-in. Is Google enabled in the Openfort dashboard?");
</script>
