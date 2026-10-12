<script setup lang="ts">
/** One button for the whole app. `variant` picks the look, `to` / `href` turn it into a link. */
const props = withDefaults(
   defineProps<{
      variant?: "primary" | "dark" | "secondary" | "social" | "pill" | "link";
      block?: boolean;
      loading?: boolean;
      disabled?: boolean;
      to?: string;
      href?: string;
      type?: "button" | "submit";
   }>(),
   { variant: "primary", type: "button" },
);

const tag = computed(() => (props.to ? resolveComponent("NuxtLink") : props.href ? "a" : "button"));
const attrs = computed(() => {
   if (props.to) return { to: props.to };
   if (props.href) return { href: props.href, target: "_blank", rel: "noopener" };
   return { type: props.type, disabled: props.disabled || props.loading };
});
</script>

<template>
   <component :is="tag" v-bind="attrs" class="ui-btn" :class="[`ui-btn--${variant}`, { 'ui-btn--block': block }]">
      <span v-if="$slots.icon" class="ui-btn__icon"><slot name="icon" /></span>
      <span><slot /></span>
      <span v-if="loading" class="ui-btn__spinner" aria-hidden="true" />
   </component>
</template>

<style scoped>
.ui-btn {
   display: inline-flex;
   align-items: center;
   justify-content: center;
   gap: 10px;
   padding: 17px 24px;
   border: 1px solid transparent;
   border-radius: 30px;
   font-size: 16px;
   font-weight: 500;
   line-height: 1.4;
   text-decoration: none;
   cursor: pointer;
   transition:
      opacity 120ms ease,
      transform 120ms ease;
}
.ui-btn:active:not(:disabled) {
   transform: scale(0.98);
}
.ui-btn:disabled {
   opacity: 0.45;
   cursor: not-allowed;
}
.ui-btn--block {
   width: 100%;
}
/* Lime: the main action. */
.ui-btn--primary {
   background: var(--m-lime);
   color: var(--m-ink);
}
/* Dark: the main action when it sits on the lime card. */
.ui-btn--dark {
   background: var(--m-bg);
   color: var(--m-text);
}
.ui-btn--secondary {
   background: transparent;
   border-color: var(--m-text);
   color: var(--m-text);
}
/* Sign-in with Google, Apple, X. */
.ui-btn--social {
   background: transparent;
   border: 1.5px solid var(--m-text);
   color: var(--m-text);
   padding: 16px 20px;
   font-size: 15px;
}
/* Small outlined button, e.g. "Upload a photo". */
.ui-btn--pill {
   background: transparent;
   border: 1.5px solid var(--m-text);
   color: var(--m-text);
   padding: 10px 14px;
   font-size: 13px;
}
.ui-btn--link {
   background: none;
   padding: 4px;
   color: var(--m-muted);
   font-size: 13px;
}
.ui-btn__icon {
   display: inline-flex;
   align-items: center;
   justify-content: center;
   width: 20px;
   height: 20px;
}
.ui-btn__spinner {
   width: 16px;
   height: 16px;
   border-radius: 50%;
   border: 2px solid currentColor;
   border-right-color: transparent;
   animation: ui-spin 0.7s linear infinite;
}
@keyframes ui-spin {
   to {
      transform: rotate(360deg);
   }
}
@media (min-width: 900px) {
   .ui-btn--social {
      padding: 16px 20px;
   }
}
</style>
