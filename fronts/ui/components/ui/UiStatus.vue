<script setup lang="ts">
/** Centered status screen (paying, cancelled, still working): Mo in a round frame, a title, a text, and the actions in the slot. */
defineProps<{ title: string; text?: string; animated?: boolean }>();
</script>

<template>
   <div class="ui-status">
      <div class="ui-status__visual"><UiMascot :size="100" :animated="animated" /></div>
      <h1 class="ui-status__title">{{ title }}</h1>
      <p v-if="text" class="ui-status__text">{{ text }}</p>
      <div class="ui-status__actions"><slot /></div>
   </div>
</template>

<style scoped>
.ui-status {
   display: flex;
   flex-direction: column;
   align-items: center;
   gap: 16px;
   padding: 48px 24px;
   text-align: center;
}
.ui-status__visual {
   display: flex;
   align-items: center;
   justify-content: center;
   width: 140px;
   height: 140px;
   border-radius: 50%;
   background: var(--m-surface-2);
}
.ui-status__title {
   margin: 0;
   font-size: 24px;
   font-weight: 600;
   line-height: 1.4;
}
.ui-status__text {
   margin: 0;
   color: var(--m-muted);
   font-size: 14px;
   line-height: 1.4;
}
.ui-status__actions {
   display: flex;
   flex-direction: column;
   gap: 16px;
   width: 100%;
}
</style>
