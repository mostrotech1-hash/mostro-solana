<script setup lang="ts">
/**
 * Phones: back arrow, logo, divider, page title, right slot (dark bar).
 * Desktop (>= 900px): logo on the left and the right slot only, on the lighter surface color.
 */
defineProps<{ title?: string; backTo?: string }>();
</script>

<template>
   <header class="ui-topbar">
      <NuxtLink v-if="backTo" :to="backTo" class="ui-topbar__back" aria-label="Back">
         <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 5l-7 7 7 7" />
         </svg>
      </NuxtLink>
      <NuxtLink to="/" class="ui-topbar__logo"><img src="../../assets/images/logo-mostro.png" alt="Mostro" width="104" height="38" /></NuxtLink>
      <span v-if="title" class="ui-topbar__divider" />
      <span class="ui-topbar__title">{{ title }}</span>
      <div class="ui-topbar__right"><slot /></div>
   </header>
</template>

<style scoped>
.ui-topbar {
   position: sticky;
   top: 0;
   z-index: 10;
   display: flex;
   align-items: center;
   gap: 10px;
   padding: 14px 20px;
   background: var(--m-bg);
   border-bottom: 1px solid var(--m-border);
}
.ui-topbar__back {
   display: inline-flex;
   color: var(--m-text);
}
.ui-topbar__logo {
   display: inline-flex;
}
.ui-topbar__logo img {
   height: 23px;
   width: auto;
}
.ui-topbar__divider {
   width: 1px;
   height: 16px;
   background: var(--m-border);
}
.ui-topbar__title {
   flex: 1;
   min-width: 0;
   overflow: hidden;
   text-overflow: ellipsis;
   white-space: nowrap;
   font-size: 15px;
   font-weight: 600;
   color: var(--m-muted);
}
.ui-topbar__right {
   display: flex;
   align-items: center;
   gap: 28px;
}
@media (min-width: 900px) {
   .ui-topbar {
      gap: 28px;
      padding: 18px var(--m-pad-x);
      background: var(--m-surface);
   }
   .ui-topbar__back,
   .ui-topbar__divider {
      display: none;
   }
   .ui-topbar__logo img {
      height: 38px;
   }
   .ui-topbar__title {
      display: none;
   }
   .ui-topbar__right {
      margin-left: auto;
   }
}
</style>
