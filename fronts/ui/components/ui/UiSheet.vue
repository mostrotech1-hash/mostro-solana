<script setup lang="ts">
/**
 * Bottom sheet on phones, centered modal on desktop. Close with the backdrop, the Escape key or `v-model`.
 * `closable` adds an X in the top-right corner. `fill` gives the sheet a fixed height and lets the content use all of it (no scrolling).
 */
const open = defineModel<boolean>({ default: false });
defineProps<{ title?: string; wide?: boolean; closable?: boolean; fill?: boolean }>();

function onKey(event: KeyboardEvent) {
   if (event.key === "Escape") open.value = false;
}
watchEffect(() => {
   if (import.meta.client) {
      document.body.style.overflow = open.value ? "hidden" : "";
      if (open.value) window.addEventListener("keydown", onKey);
      else window.removeEventListener("keydown", onKey);
   }
});
onBeforeUnmount(() => {
   if (import.meta.client) {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
   }
});
</script>

<template>
   <Teleport to="body">
      <div v-if="open" class="ui-sheet" role="dialog" aria-modal="true" :aria-label="title">
         <div class="ui-sheet__backdrop" @click="open = false" />
         <div class="ui-sheet__panel" :class="{ 'ui-sheet__panel--wide': wide, 'ui-sheet__panel--fill': fill }">
            <div v-if="title || closable" class="ui-sheet__head">
               <h2 class="ui-sheet__title">{{ title }}</h2>
               <button v-if="closable" type="button" class="ui-sheet__close" aria-label="Close" @click="open = false">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
               </button>
            </div>
            <slot />
         </div>
      </div>
   </Teleport>
</template>

<style scoped>
.ui-sheet {
   position: fixed;
   inset: 0;
   z-index: 50;
   display: flex;
   align-items: flex-end;
   justify-content: center;
}
.ui-sheet__backdrop {
   position: absolute;
   inset: 0;
   background: rgba(10, 17, 31, 0.78);
}
.ui-sheet__panel {
   position: relative;
   display: flex;
   flex-direction: column;
   gap: 14px;
   width: 100%;
   max-height: 92dvh;
   overflow-y: auto;
   padding: 24px 24px calc(24px + env(safe-area-inset-bottom));
   border-radius: 24px 24px 0 0;
   background: var(--m-surface);
   border: 1px solid var(--m-border);
}
/* Fill: tall enough for an embedded widget (MoonPay) to show its pay button without scrolling. */
.ui-sheet__panel--fill {
   height: 97dvh;
   max-height: none;
   overflow: hidden;
   gap: 10px;
   padding: 16px 16px 12px;
}
.ui-sheet__head {
   display: flex;
   align-items: center;
   justify-content: space-between;
   gap: 12px;
}
.ui-sheet__title {
   margin: 0;
   font-size: 22px;
   font-weight: 600;
   line-height: 1.4;
}
.ui-sheet__close {
   display: inline-flex;
   align-items: center;
   justify-content: center;
   flex: none;
   width: 36px;
   height: 36px;
   margin-left: auto;
   border: 1px solid var(--m-border);
   border-radius: 50%;
   background: var(--m-surface-2);
   color: var(--m-text);
   cursor: pointer;
}
.ui-sheet__close:hover {
   border-color: var(--m-text);
}
@media (min-width: 900px) {
   .ui-sheet {
      align-items: center;
   }
   .ui-sheet__panel {
      width: 480px;
      border-radius: 24px;
   }
   .ui-sheet__panel--wide {
      width: 560px;
   }
   .ui-sheet__panel--fill {
      height: min(920px, 96dvh);
      padding: 18px 20px 20px;
   }
}
</style>
