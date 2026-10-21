import { defineStore } from "pinia";
import { AccountTypeEnum, ChainTypeEnum, EmbeddedState, OAuthProvider, RecoveryMethod, type Openfort } from "@openfort/openfort-js";
import type { EncryptionSessionResponse, FeaturesResponse, KycAccessTokenResponse, KycStatus, KycStatusResponse, UserProfile } from "@mostro/shared/api";

export type SocialProvider = "google" | "apple" | "twitter";

const PROVIDERS: Record<SocialProvider, OAuthProvider> = { google: OAuthProvider.GOOGLE, apple: OAuthProvider.APPLE, twitter: OAuthProvider.TWITTER };

/**
 * Sign-in state. Openfort owns the session and the embedded Solana wallet (automatic recovery, no password);
 * the Mostro API owns the user row (name, avatar, login type).
 */
export const useSessionStore = defineStore("session", () => {
   const config = useRuntimeConfig();
   const ready = ref(false);
   const profile = ref<UserProfile | null>(null);
   const walletAddress = ref<string | null>(null);
   /** Signed in with Openfort but the profile or wallet step did not finish (e.g. a network error). The code is already used, so retry without it. */
   const needsRetry = ref(false);
   /** Why the last sign-in step failed (shown on the sign-in page with a retry button). */
   const error = ref("");
   /** What the full-screen loading says while sign-in is working (empty when idle). */
   const progress = ref("");
   const isAuthenticated = computed(() => profile.value !== null && walletAddress.value !== null);

   let initPromise: Promise<void> | null = null;

   function client(): Openfort {
      return getOpenfortClient(config.public.openfortPublishableKey, config.public.shieldPublishableKey);
   }

   async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
      return apiFetch<T>(config.public.apiBase, await client().getAccessToken(), path, options);
   }

   /** Everything the pass purchase needs from the signed-in user (wallet, Openfort signer, API, devnet RPC). */
   function purchaseContext(onSubmitted?: (signature: string) => void): PurchaseContext {
      if (!walletAddress.value) throw new PurchaseError("Your Mostro wallet is not ready. Please sign in again.", "wallet");
      return { openfort: client(), rpcUrl: config.public.solanaRpcUrl, walletAddress: walletAddress.value, api, onSubmitted };
   }

   /** Restores the session on page load. Safe to call from every page. */
   function init(): Promise<void> {
      initPromise ??= (async () => {
         const openfort = client();
         await openfort.waitForInitialization();
         const state = await openfort.embeddedWallet.getEmbeddedState();
         if (state !== EmbeddedState.NONE && state !== EmbeddedState.UNAUTHENTICATED) {
            // Do not reject: the sign-in page shows the error with a retry button.
            await completeLogin().catch(() => undefined);
         }
         ready.value = true;
      })();
      return initPromise;
   }

   /** After any login: register the user in the Mostro API, then make sure the Solana wallet exists. */
   async function completeLogin(): Promise<void> {
      error.value = "";
      try {
         progress.value = "Setting up your account…";
         profile.value = await api<UserProfile>("/users/sync", { method: "POST" });
         progress.value = "Creating your Mostro wallet…";
         walletAddress.value = await ensureWallet();
         needsRetry.value = false;
      } catch (err) {
         console.error("[mostro] could not finish sign-in", err);
         // The code is already used: from here on only the wallet step is retried.
         needsRetry.value = true;
         error.value = err instanceof Error && err.message ? err.message : String(err);
         throw err;
      } finally {
         progress.value = "";
      }
   }

   async function ensureWallet(): Promise<string> {
      const openfort = client();
      if ((await openfort.embeddedWallet.getEmbeddedState()) === EmbeddedState.READY) return (await openfort.embeddedWallet.get()).address;
      const { session } = await api<EncryptionSessionResponse>("/wallet/encryption-session", { method: "POST" });
      const account = await openfort.embeddedWallet.configure({
         chainType: ChainTypeEnum.SVM,
         // Solana has no chain id and no smart account: a plain account. The default (smart account) fails with "no chain id found".
         accountType: AccountTypeEnum.EOA,
         recoveryParams: { recoveryMethod: RecoveryMethod.AUTOMATIC, encryptionSession: session },
      });
      return account.address;
   }

   async function sendEmailCode(email: string): Promise<void> {
      await init();
      // A leftover session makes Openfort send an "email-verification" code instead of a sign-in one.
      await client().auth.logout();
      needsRetry.value = false;
      await client().auth.requestEmailOtp({ email });
   }

   async function verifyEmailCode(email: string, otp: string): Promise<void> {
      progress.value = "Checking your code…";
      try {
         await client().auth.logInWithEmailOtp({ email, otp });
      } finally {
         progress.value = "";
      }
      await completeLogin();
   }

   async function startSocialLogin(provider: SocialProvider): Promise<void> {
      await init();
      await client().auth.logout();
      window.location.href = await client().auth.initOAuth({ provider: PROVIDERS[provider], redirectTo: `${window.location.origin}/oauth/callback` });
   }

   /** Openfort appends access_token and user_id to the redirect URL after the provider. */
   async function finishSocialLogin(token: string, userId: string): Promise<void> {
      await init();
      await client().auth.storeCredentials({ token, userId });
      await completeLogin();
   }

   async function saveName(name: string): Promise<void> {
      profile.value = await api<UserProfile>("/users/me", { method: "PATCH", body: { name } });
   }

   async function uploadAvatar(file: File): Promise<void> {
      const body = new FormData();
      body.append("file", file);
      profile.value = await api<UserProfile>("/users/me/avatar", { method: "POST", body });
   }

   /** Whether buying a pass or $MOOG is open (the server turns it off while the Solana program is not ready). */
   const chainEnabled = ref(true);

   /** Asks the server what is open. If it cannot be reached, buying stays as it was. */
   async function loadFeatures(): Promise<void> {
      try {
         const { chainEnabled: enabled } = await apiFetch<FeaturesResponse>(config.public.apiBase, null, "/features");
         chainEnabled.value = enabled;
      } catch {
         // keep the last known value
      }
   }

   /** Identity check state, from the server (never from the widget). */
   const kycStatus = computed<KycStatus>(() => profile.value?.kycStatus ?? "none");
   /** Whether buying needs an approved check (the server decides; true until it says otherwise). */
   const kycRequired = ref(true);
   /** True when the user must finish the identity check before buying. */
   const needsKyc = computed(() => kycRequired.value && kycStatus.value !== "approved");

   async function kycToken(): Promise<string> {
      return (await api<KycAccessTokenResponse>("/kyc/access-token", { method: "POST" })).token;
   }

   /** Reads the status the server holds (it also asks Sumsub while the check is not final) and keeps the profile in step. */
   async function refreshKyc(): Promise<KycStatus> {
      const { status, required } = await api<KycStatusResponse>("/kyc/status");
      kycRequired.value = required;
      if (profile.value && profile.value.kycStatus !== status) profile.value = { ...profile.value, kycStatus: status };
      return status;
   }

   async function logout(): Promise<void> {
      await client().auth.logout();
      profile.value = null;
      walletAddress.value = null;
      needsRetry.value = false;
      usePurchaseStore().reset();
      usePurchaseStore().owned = null;
      error.value = "";
   }

   return {
      ready,
      profile,
      walletAddress,
      isAuthenticated,
      needsRetry,
      error,
      progress,
      completeLogin,
      init,
      sendEmailCode,
      verifyEmailCode,
      startSocialLogin,
      finishSocialLogin,
      saveName,
      uploadAvatar,
      chainEnabled,
      loadFeatures,
      kycStatus,
      kycRequired,
      needsKyc,
      kycToken,
      refreshKyc,
      api,
      purchaseContext,
      logout,
   };
});
