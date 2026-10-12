<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
   <section class="ui-section">
      <h2 class="ui-section__title">{{ title }}</h2>
      <slot />
   </section>
</template>

<style scoped>
.ui-section__title {
   margin: 0 0 4px;
   font-size: 18px;
   font-weight: 600;
   line-height: 1.4;
}
@media (min-width: 900px) {
   .ui-section__title {
      font-size: 20px;
   }
}
</style>
