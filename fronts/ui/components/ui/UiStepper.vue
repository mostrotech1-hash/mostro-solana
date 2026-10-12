<script setup lang="ts">
/** `current` is 1-based. */
defineProps<{ steps: string[]; current: number }>();
</script>

<template>
   <ol class="ui-stepper">
      <li v-for="(step, i) in steps" :key="step" class="ui-stepper__step" :class="{ 'is-active': i + 1 === current }">
         <span class="ui-stepper__bar" :class="{ 'is-filled': i + 1 <= current }" />
         <span class="ui-stepper__label">{{ step }}</span>
      </li>
   </ol>
</template>

<style scoped>
.ui-stepper {
   display: flex;
   gap: 6px;
   margin: 0;
   padding: 0;
   list-style: none;
}
.ui-stepper__step {
   flex: 1;
   display: flex;
   flex-direction: column;
   gap: 6px;
   min-width: 0;
}
.ui-stepper__bar {
   display: block;
   height: 4px;
   border-radius: 2px;
   background: var(--m-surface-2);
}
.ui-stepper__bar.is-filled {
   background: var(--m-lime);
}
.ui-stepper__label {
   font-size: 10px;
   line-height: 1.4;
   color: var(--m-muted);
}
.is-active .ui-stepper__label {
   color: var(--m-text);
   font-weight: 600;
}
</style>
