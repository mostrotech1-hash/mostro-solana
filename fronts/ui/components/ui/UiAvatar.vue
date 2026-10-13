<script setup lang="ts">
/** Profile picture. Without a picture: initials when there is a name, the guest user icon when there is neither. */
const props = withDefaults(defineProps<{ src?: string | null; name?: string | null; size?: number }>(), { size: 36 });
const initials = computed(() =>
   (props.name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join(""),
);
</script>

<template>
   <span class="ui-avatar" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.38}px` }">
      <img v-if="src" :src="src" :alt="name ?? 'Profile picture'" class="ui-avatar__img" />
      <template v-else-if="initials">{{ initials }}</template>
      <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
         <circle cx="12" cy="8" r="4" />
         <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
      </svg>
   </span>
</template>

<style scoped>
.ui-avatar {
   display: inline-flex;
   align-items: center;
   justify-content: center;
   flex: none;
   overflow: hidden;
   border-radius: 50%;
   background: var(--m-surface-2);
   border: 1.5px solid var(--m-border);
   color: var(--m-muted);
   font-weight: 600;
}
.ui-avatar__img {
   width: 100%;
   height: 100%;
   object-fit: cover;
}
</style>
