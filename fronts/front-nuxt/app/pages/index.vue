<script setup lang="ts">
import type { SocialProvider } from "~/stores/session";

// H01 · Sign in / Sign up. The "Welcome to Mostro" banner shows on phones (as in the design) and on desktop.
const session = useSessionStore();

const step = ref<"method" | "code">("method");
const email = ref("");
const code = ref("");
const loading = ref(false);
/** What the full-screen loading says; while the account is being set up the store gives the exact step. */
const loadingText = ref("Loading…");
const errorMsg = ref("");

/** Signed in with Openfort, but the wallet could not be created: show why, and let the user retry or sign out. */
const walletFailed = computed(() => session.ready && session.profile !== null && session.walletAddress === null);

async function retryWallet() {
   errorMsg.value = "";
   loadingText.value = "Creating your Mostro wallet…";
   loading.value = true;
   try {
      await session.completeLogin();
      await navigateTo(session.profile?.name ? "/pass" : "/profile");
   } catch {
      // The reason is in session.error.
   } finally {
      loading.value = false;
   }
}

async function signOutAndRestart() {
   await session.logout();
   step.value = "method";
}

const SOCIAL: { provider: SocialProvider; label: string }[] = [
   { provider: "google", label: "Continue with Google" },
   { provider: "apple", label: "Continue with Apple" },
   { provider: "twitter", label: "Continue with X" },
];

async function run(action: () => Promise<void>, fallback: string, text = "Loading…") {
   errorMsg.value = "";
   loadingText.value = text;
   loading.value = true;
   try {
      await action();
   } catch (error) {
      console.error("[mostro] sign-in", error);
      errorMsg.value = error instanceof Error && error.message ? error.message : fallback;
      loading.value = false;
   }
}

const onSocial = (provider: SocialProvider) =>
   run(() => session.startSocialLogin(provider), "Could not start the sign-in. Is this provider enabled in Openfort?", "Opening the sign-in…");

const onEmail = () =>
   run(
      async () => {
         await session.sendEmailCode(email.value.trim());
         step.value = "code";
         loading.value = false;
      },
      "Could not send the code. Check the email and try again.",
      "Sending your code…",
   );

const onCode = () =>
   run(
      async () => {
         // The code can only be used once: if sign-in worked but the wallet step failed, retry that step alone.
         if (session.needsRetry) await session.completeLogin();
         else await session.verifyEmailCode(email.value.trim(), code.value.trim());
         await navigateTo(session.profile?.name ? "/pass" : "/profile");
      },
      "Invalid or expired code. Try again.",
      "Checking your code…",
   );

function useAnotherEmail() {
   step.value = "method";
   code.value = "";
   errorMsg.value = "";
   loading.value = false;
}
</script>

<template>
   <AppShell title="Sign in" :max-width="600">
      <UiLoading v-if="loading || session.progress" :text="session.progress || loadingText" />
      <UiCard class="signin">
         <WelcomeBanner />

         <template v-if="walletFailed">
            <div class="signin__intro signin__intro--always">
               <h1 class="signin__title">One more step</h1>
               <p class="signin__lead">You are signed in, but your Mostro wallet could not be created yet.</p>
            </div>
            <p v-if="session.error" class="signin__error" role="alert">{{ session.error }}</p>
            <UiButton variant="primary" block :loading="loading" @click="retryWallet">Try again</UiButton>
            <UiButton variant="link" @click="signOutAndRestart">Use a different account</UiButton>
         </template>

         <template v-else-if="step === 'method'">
            <div class="signin__intro">
               <h1 class="signin__title">Sign in or create your account</h1>
               <p class="signin__lead">Your Mostro wallet is created automatically. No crypto knowledge needed.</p>
            </div>

            <UiButton v-for="item in SOCIAL" :key="item.provider" variant="social" block :disabled="loading" @click="onSocial(item.provider)">
               <template #icon><SocialIcon :provider="item.provider" /></template>
               {{ item.label }}
            </UiButton>

            <div class="signin__divider"><span>or</span></div>

            <form id="signin-form" class="signin__form" @submit.prevent="onEmail">
               <UiInput v-model="email" label="Email" type="email" placeholder="you@email.com" autocomplete="username" inputmode="email" />
               <p class="signin__note">
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                     <circle cx="8" cy="8" r="6.2" />
                     <path d="M8 4.6V8l2.2 1.4" />
                  </svg>
                  Your Mostro wallet is created on Solana.
               </p>
               <p v-if="errorMsg" class="signin__error" role="alert">{{ errorMsg }}</p>
            </form>

            <div class="signin__footer">
               <UiButton type="submit" form="signin-form" variant="primary" block :loading="loading" :disabled="!email.trim()">Continue</UiButton>
            </div>
         </template>

         <template v-else>
            <form class="signin__form" @submit.prevent="onCode">
               <div class="signin__intro signin__intro--always">
                  <h1 class="signin__title">Check your email</h1>
                  <p class="signin__lead">
                     We sent a code to <strong>{{ email }}</strong
                     >.
                  </p>
               </div>
               <UiOtpInput v-model="code" :disabled="loading" @complete="onCode" />
               <p v-if="errorMsg" class="signin__error" role="alert">{{ errorMsg }}</p>
               <UiButton type="submit" variant="primary" block :loading="loading" :disabled="code.length < 6 && !session.needsRetry">{{
                  session.needsRetry ? "Try again" : "Verify and continue"
               }}</UiButton>
               <UiButton variant="link" @click="useAnotherEmail">Use a different email</UiButton>
            </form>
         </template>
      </UiCard>
   </AppShell>
</template>

<style scoped>
.signin {
   display: flex;
   flex: 1;
   flex-direction: column;
   gap: 16px;
}
.signin__intro {
   display: none;
}
.signin__intro--always {
   display: block;
}
.signin__title {
   margin: 0 0 4px;
   font-size: 26px;
   font-weight: 600;
   line-height: 1.4;
}
.signin__lead {
   margin: 0;
   color: var(--m-muted);
   font-size: 14px;
   line-height: 1.4;
}
.signin__divider {
   display: flex;
   align-items: center;
   gap: 12px;
   color: var(--m-muted);
   font-size: 14px;
}
.signin__divider::before,
.signin__divider::after {
   content: "";
   flex: 1;
   height: 1px;
   background: var(--m-border);
}
.signin__form {
   display: flex;
   flex-direction: column;
   gap: 18px;
}
.signin__note {
   display: flex;
   align-items: center;
   gap: 8px;
   margin: 0;
   padding: 12px 14px;
   border: 1px solid var(--m-border);
   border-radius: 12px;
   background: var(--m-surface-2);
   color: var(--m-muted);
   font-size: 12px;
}
.signin__error {
   margin: 0;
   font-size: 13px;
   color: var(--m-danger);
}
/* Phones: Continue is pinned to the bottom of the screen. */
.signin__footer {
   margin-top: auto;
   padding-top: 20px;
}
@media (min-width: 900px) {
   .signin {
      flex: none;
      gap: 16px;
   }
   .signin__intro {
      display: block;
   }
   .signin__footer {
      margin-top: 0;
      padding-top: 0;
   }
   .signin__form {
      gap: 16px;
   }
}
</style>
