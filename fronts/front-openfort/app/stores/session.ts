import { defineStore } from "pinia";
import { ChainTypeEnum, EmbeddedState, OAuthProvider, RecoveryMethod, type Openfort } from "@openfort/openfort-js";

/**
 * Auth + Solana embedded wallet state. All client-side: Openfort keeps the auth session in its own
 * storage, and the wallet is non-custodial with PASSWORD recovery (no backend needed, unlike AUTOMATIC
 * recovery which requires a server-minted encryption session).
 */
export const useSessionStore = defineStore("session", () => {
   const config = useRuntimeConfig();
   const ready = ref(false);
   const email = ref<string | null>(null);
   const walletAddress = ref<string | null>(null);
   /** Logged in with Openfort but the wallet still needs the recovery password (create or unlock). */
   const needsWallet = ref(false);
   const isAuthenticated = computed(() => email.value !== null);

   let initPromise: Promise<void> | null = null;

   function client(): Openfort {
      return getOpenfortClient(config.public.openfortPublishableKey, config.public.shieldPublishableKey);
   }

   /** Restores the session on page load. Safe to call from every page. */
   function init(): Promise<void> {
      initPromise ??= (async () => {
         const openfort = client();
         await openfort.waitForInitialization();
         await refresh(openfort);
         ready.value = true;
      })();
      return initPromise;
   }

   async function refresh(openfort: Openfort = client()): Promise<void> {
      const state = await openfort.embeddedWallet.getEmbeddedState();
      if (state === EmbeddedState.NONE || state === EmbeddedState.UNAUTHENTICATED) {
         email.value = null;
         walletAddress.value = null;
         needsWallet.value = false;
         return;
      }
      const user = await openfort.user.get();
      email.value = user.email ?? user.id;
      if (state === EmbeddedState.READY) {
         walletAddress.value = (await openfort.embeddedWallet.get()).address;
         needsWallet.value = false;
      } else {
         walletAddress.value = null;
         needsWallet.value = true;
      }
   }

   async function requestEmailCode(address: string): Promise<void> {
      await init();
      // A stale session makes Openfort send an "email-verification" OTP instead of a sign-in one.
      await client().auth.logout();
      await client().auth.requestEmailOtp({ email: address });
   }

   async function verifyEmailCode(address: string, otp: string): Promise<void> {
      await client().auth.logInWithEmailOtp({ email: address, otp });
      await refresh();
   }

   async function startGoogle(): Promise<void> {
      await init();
      await client().auth.logout();
      const url = await client().auth.initOAuth({ provider: OAuthProvider.GOOGLE, redirectTo: `${window.location.origin}/oauth/callback` });
      window.location.href = url;
   }

   /** Openfort appends access_token/user_id to the redirect URL after Google. */
   async function finishOAuth(token: string, userId: string): Promise<void> {
      await init();
      await client().auth.storeCredentials({ token, userId });
      await refresh();
   }

   /** Creates the Solana wallet on first use, otherwise unlocks the existing one with the same password. */
   async function configureWallet(password: string): Promise<void> {
      const account = await client().embeddedWallet.configure({
         chainType: ChainTypeEnum.SVM,
         recoveryParams: { recoveryMethod: RecoveryMethod.PASSWORD, password },
      });
      walletAddress.value = account.address;
      needsWallet.value = false;
   }

   async function logout(): Promise<void> {
      await client().auth.logout();
      email.value = null;
      walletAddress.value = null;
      needsWallet.value = false;
   }

   return { ready, email, walletAddress, needsWallet, isAuthenticated, init, requestEmailCode, verifyEmailCode, startGoogle, finishOAuth, configureWallet, logout };
});
