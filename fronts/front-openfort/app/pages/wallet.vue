<template>
   <div class="ck-page">
      <div class="ck-card">
         <p v-if="!session.ready" class="ck-subtitle" style="margin: 0">Loading…</p>

         <template v-else>
            <h1 class="ck-title">Your wallet</h1>
            <p class="ck-subtitle">Signed in as {{ session.email }}</p>

            <div v-if="session.walletAddress" class="ck-list">
               <div class="ck-field">
                  <small>Solana address</small>
                  {{ session.walletAddress }}
               </div>
               <a :href="explorerUrl" target="_blank" rel="noopener" class="ck-link-button">View on Solana Explorer</a>
               <!-- TODO(blockchain dev): artist/token pages and MOG pass purchase plug in here. -->
            </div>

            <form v-else-if="session.needsWallet" class="ck-list" @submit.prevent="onConfigure">
               <p class="ck-subtitle" style="margin: 0">
                  Choose a wallet password. It encrypts your recovery share and is never sent to Openfort. If you forget it, the wallet cannot be recovered. Use the same password to unlock
                  it later.
               </p>
               <input v-model="password" type="password" minlength="8" placeholder="Wallet password" required autocomplete="new-password" class="ck-input-row ck-input" />
               <button type="submit" :disabled="loading" class="ck-primary-button">{{ loading ? "Setting up…" : "Create / unlock wallet" }}</button>
            </form>

            <p v-if="errorMsg" class="ck-error" style="margin-top: 12px">{{ errorMsg }}</p>
            <button type="button" class="ck-link-button" style="margin-top: 16px" @click="onLogout">Sign out</button>
         </template>
      </div>
   </div>
</template>

<script setup lang="ts">
const session = useSessionStore();
const config = useRuntimeConfig();

const password = ref("");
const loading = ref(false);
const errorMsg = ref("");

const explorerUrl = computed(() => `https://explorer.solana.com/address/${session.walletAddress}?cluster=${config.public.solanaCluster}`);

onMounted(async () => {
   try {
      await session.init();
      if (!session.isAuthenticated) await navigateTo("/");
   } catch (err) {
      console.error("[openfort] init failed", err);
      errorMsg.value = err instanceof Error ? err.message : "Could not start Openfort.";
      session.ready = true;
   }
});

async function onConfigure() {
   loading.value = true;
   errorMsg.value = "";
   try {
      await session.configureWallet(password.value);
      password.value = "";
   } catch (err) {
      console.error("[openfort] configure wallet failed", err);
      errorMsg.value = "Could not create or unlock the wallet. Check the password and that Shield is configured.";
   } finally {
      loading.value = false;
   }
}

async function onLogout() {
   await session.logout();
   await navigateTo("/");
}
</script>
