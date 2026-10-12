<script setup lang="ts">
/** Full-screen loading: the page behind is blurred, and Mo floats in a glowing ring in the center. */
withDefaults(defineProps<{ text?: string }>(), { text: "Loading…" });
</script>

<template>
   <Teleport to="body">
      <div class="ui-loading" role="status" aria-live="polite">
         <div class="ui-loading__box">
            <div class="ui-loading__ring">
               <span class="ui-loading__spin" aria-hidden="true" />
               <UiMascot :size="84" animated />
            </div>
            <p class="ui-loading__text">{{ text }}</p>
            <span class="ui-loading__dots" aria-hidden="true"><i /><i /><i /></span>
         </div>
      </div>
   </Teleport>
</template>

<style scoped>
.ui-loading {
   position: fixed;
   inset: 0;
   z-index: 80;
   display: flex;
   align-items: center;
   justify-content: center;
   padding: 24px;
   background: rgba(10, 17, 31, 0.55);
   -webkit-backdrop-filter: blur(12px);
   backdrop-filter: blur(12px);
   animation: ui-loading-in 220ms ease both;
}
.ui-loading__box {
   display: flex;
   flex-direction: column;
   align-items: center;
   gap: 18px;
   text-align: center;
}
.ui-loading__ring {
   position: relative;
   display: flex;
   align-items: center;
   justify-content: center;
   width: 150px;
   height: 150px;
   border-radius: 50%;
   background: radial-gradient(circle, rgba(220, 253, 99, 0.16), rgba(220, 253, 99, 0) 70%);
}
.ui-loading__spin {
   position: absolute;
   inset: 0;
   border-radius: 50%;
   border: 3px solid rgba(220, 253, 99, 0.18);
   border-top-color: var(--m-lime);
   border-right-color: var(--m-lime);
   animation: ui-loading-spin 1.1s linear infinite;
   filter: drop-shadow(0 0 10px rgba(220, 253, 99, 0.55));
}
.ui-loading__text {
   margin: 0;
   font-size: 18px;
   font-weight: 600;
}
.ui-loading__dots {
   display: inline-flex;
   gap: 6px;
}
.ui-loading__dots i {
   width: 7px;
   height: 7px;
   border-radius: 50%;
   background: var(--m-lime);
   animation: ui-loading-dot 1.2s ease-in-out infinite;
}
.ui-loading__dots i:nth-child(2) {
   animation-delay: 0.15s;
}
.ui-loading__dots i:nth-child(3) {
   animation-delay: 0.3s;
}
@keyframes ui-loading-in {
   from {
      opacity: 0;
   }
}
@keyframes ui-loading-spin {
   to {
      transform: rotate(360deg);
   }
}
@keyframes ui-loading-dot {
   0%,
   80%,
   100% {
      opacity: 0.25;
      transform: scale(0.8);
   }
   40% {
      opacity: 1;
      transform: scale(1.15);
   }
}
@media (prefers-reduced-motion: reduce) {
   .ui-loading__spin,
   .ui-loading__dots i {
      animation: none;
   }
}
</style>
