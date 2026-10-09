<template>
   <div class="ck-page">
      <div class="ck-card" style="text-align: center">
         <p class="ck-subtitle" style="margin: 0">{{ errorMsg || "Signing you in…" }}</p>
         <NuxtLink v-if="errorMsg" to="/" class="ck-link-button">Back to sign in</NuxtLink>
      </div>
   </div>
</template>

<script setup lang="ts">
const session = useSessionStore();
const route = useRoute();
const errorMsg = ref("");

onMounted(async () => {
   try {
      const token = route.query.access_token;
      const userId = route.query.user_id;
      if (typeof token !== "string" || typeof userId !== "string") throw new Error("Missing access_token/user_id in callback URL.");
      await session.finishOAuth(token, userId);
      await navigateTo("/wallet", { replace: true });
   } catch (err) {
      console.error("[openfort] google callback failed", err);
      errorMsg.value = "Google sign-in failed.";
   }
});
</script>
