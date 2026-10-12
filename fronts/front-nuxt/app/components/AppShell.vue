<script setup lang="ts">
/** Header + page column shared by every screen. `maxWidth` is the content width on desktop; `back-to` shows the back arrow on phones. */
withDefaults(defineProps<{ title?: string; backTo?: string; maxWidth?: number }>(), { maxWidth: 1040 });
</script>

<template>
   <div class="shell">
      <UiTopBar :title="title" :back-to="backTo"><UserMenu /></UiTopBar>
      <main class="shell__main" :style="{ '--shell-max': `${maxWidth}px` }"><slot /></main>
   </div>
</template>

<style scoped>
.shell {
   display: flex;
   flex-direction: column;
   min-height: 100dvh;
}
.shell__main {
   flex: 1;
   display: flex;
   flex-direction: column;
   width: 100%;
   padding: 20px 20px 28px;
}
@media (min-width: 900px) {
   .shell__main {
      flex: none;
      max-width: calc(var(--shell-max) + 2 * var(--m-pad-x));
      margin: 0 auto;
      padding: 32px var(--m-pad-x) 49px;
   }
}
</style>
