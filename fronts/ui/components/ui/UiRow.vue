<script setup lang="ts">
/** A label on the left, a value on the right, optional small line under the label. `strong` is the bold "You pay" style. */
defineProps<{ label: string; value?: string; hint?: string; strong?: boolean }>();
</script>

<template>
   <div class="ui-row">
      <div class="ui-row__left">
         <span class="ui-row__label" :class="{ 'ui-row__label--strong': strong }">{{ label }}</span>
         <span v-if="hint" class="ui-row__hint">{{ hint }}</span>
      </div>
      <span class="ui-row__value" :class="{ 'ui-row__value--strong': strong }"
         ><slot>{{ value }}</slot></span
      >
   </div>
</template>

<style scoped>
.ui-row {
   display: flex;
   align-items: center;
   justify-content: space-between;
   gap: 16px;
   padding: 12px 0;
   border-bottom: 1px solid var(--m-border);
   font-size: 14px;
   line-height: 1.4;
}
.ui-row__left {
   display: flex;
   flex-direction: column;
   gap: 2px;
}
.ui-row__label {
   color: var(--m-muted);
}
.ui-row__label--strong {
   color: var(--m-text);
   font-weight: 600;
}
.ui-row__hint {
   font-size: 12px;
   color: var(--m-muted);
}
.ui-row__value {
   font-weight: 500;
   text-align: right;
}
.ui-row__value--strong {
   font-weight: 600;
}
</style>
