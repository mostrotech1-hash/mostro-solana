<script setup lang="ts">
const session = useSessionStore();
const route = useRoute();
const errorMsg = ref("");

onMounted(async () => {
   try {
      const token = route.query.access_token;
      const userId = route.query.user_id;
      if (typeof token !== "string" || typeof userId !== "string") throw new Error("The sign-in did not complete.");
      await session.finishSocialLogin(token, userId);
      await navigateTo(session.profile?.name ? "/pass" : "/profile", { replace: true });
   } catch (error) {
      console.error("[mostro] social sign-in failed", error);
      errorMsg.value = error instanceof Error ? error.message : "Sign-in failed.";
   }
});
</script>

<template>
   <div class="callback">
      <UiLoading v-if="!errorMsg" :text="session.progress || 'Signing you in…'" />
      <UiStatus v-else title="Sign-in failed" :text="errorMsg">
         <UiButton to="/" variant="primary" block>Back to sign in</UiButton>
      </UiStatus>
   </div>
</template>

<style scoped>
.callback {
   padding: 0 var(--m-pad-x);
}
</style>
