<script setup lang="ts">
/** `lime` is the pass card, `surface` the centered sign-in / profile card (a plain page on phones), `panel` a small framed block. */
withDefaults(defineProps<{ variant?: "lime" | "surface" | "panel" }>(), { variant: "surface" });
</script>

<template>
   <div class="ui-card" :class="`ui-card--${variant}`"><slot /></div>
</template>

<style scoped>
.ui-card--lime {
   background: var(--m-lime);
   color: var(--m-ink);
   border-radius: 20px;
   padding: 16px;
}
.ui-card--panel {
   background: var(--m-surface);
   border: 1px solid var(--m-border);
   border-radius: 16px;
   padding: 16px;
}
/* Phones: no card, the content sits on the page. */
.ui-card--surface {
   background: none;
}
@media (min-width: 900px) {
   .ui-card--lime {
      border-radius: 24px;
      padding: 24px;
   }
   .ui-card--surface {
      background: var(--m-surface);
      border: 1px solid var(--m-border);
      border-radius: 20px;
      padding: 32px;
   }
}
</style>
