<script setup lang="ts">
/** Mo, the Mostro mascot. */
withDefaults(defineProps<{ size?: number; animated?: boolean }>(), { size: 96 });
</script>

<template>
   <img
      src="../../assets/images/mo-mascot.png"
      alt=""
      class="ui-mascot"
      :class="{ 'ui-mascot--animated': animated }"
      :width="size"
      :height="size"
      :style="{ width: `${size}px`, height: `${size}px` }"
   />
</template>

<style scoped>
.ui-mascot {
   flex: none;
   object-fit: contain;
}
.ui-mascot--animated {
   animation: ui-float 1.6s ease-in-out infinite;
}
@keyframes ui-float {
   50% {
      transform: translateY(-8px);
   }
}
@media (prefers-reduced-motion: reduce) {
   .ui-mascot--animated {
      animation: none;
   }
}
</style>
