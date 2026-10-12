<script setup lang="ts">
/** `caps` is the small uppercase label style used on the profile screen (DISPLAY NAME). */
defineProps<{
   label?: string;
   placeholder?: string;
   type?: string;
   error?: string;
   autocomplete?: string;
   inputmode?: "text" | "numeric" | "email";
   maxlength?: number;
   caps?: boolean;
}>();
const model = defineModel<string>({ default: "" });
const id = useId();
</script>

<template>
   <div class="ui-field">
      <label v-if="label" :for="id" class="ui-field__label" :class="{ 'ui-field__label--caps': caps }">{{ label }}</label>
      <input
         :id="id"
         v-model="model"
         class="ui-field__input"
         :class="{ 'ui-field__input--caps': caps }"
         :type="type ?? 'text'"
         :placeholder="placeholder"
         :autocomplete="autocomplete"
         :inputmode="inputmode"
         :maxlength="maxlength"
      />
      <p v-if="error" class="ui-field__error">{{ error }}</p>
   </div>
</template>

<style scoped>
.ui-field {
   display: flex;
   flex-direction: column;
   gap: 6px;
}
.ui-field__label {
   font-size: 12px;
   font-weight: 500;
   color: var(--m-text);
}
.ui-field__label--caps {
   font-size: 11px;
   font-weight: 600;
   color: var(--m-muted);
}
.ui-field__input {
   padding: 16px 16px;
   border-radius: 10px;
   border: 1px solid var(--m-border);
   background: transparent;
   color: var(--m-text);
   font: inherit;
   font-size: 14px;
   outline: none;
}
.ui-field__input--caps {
   padding: 12px;
   border-width: 1.5px;
}
.ui-field__input::placeholder {
   color: var(--m-muted);
}
.ui-field__input:focus {
   border-color: var(--m-lime);
}
.ui-field__error {
   margin: 0;
   font-size: 12px;
   color: var(--m-danger);
}
</style>
