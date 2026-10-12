<script setup lang="ts">
/** One-time code in separate boxes. Handles typing, backspace, arrow keys, paste and the browser's code autofill. */
const props = withDefaults(defineProps<{ length?: number; disabled?: boolean }>(), { length: 6 });
const model = defineModel<string>({ default: "" });
const emit = defineEmits<{ complete: [code: string] }>();

const boxes = ref<HTMLInputElement[]>([]);
const digits = computed(() => Array.from({ length: props.length }, (_, i) => model.value[i] ?? ""));

function focusBox(index: number) {
   boxes.value[Math.max(0, Math.min(index, props.length - 1))]?.focus();
}

function setCode(code: string) {
   const clean = code.replace(/\D/g, "").slice(0, props.length);
   model.value = clean;
   if (clean.length === props.length) emit("complete", clean);
}

function onInput(index: number, event: Event) {
   const input = event.target as HTMLInputElement;
   const typed = input.value.replace(/\D/g, "");
   if (typed.length > 1) {
      // Autofill or fast typing: spread over the boxes from this one.
      setCode(model.value.slice(0, index) + typed);
      focusBox(index + typed.length);
      return;
   }
   const next = digits.value.slice();
   next[index] = typed;
   setCode(next.join(""));
   input.value = typed;
   if (typed) focusBox(index + 1);
}

function onKeydown(index: number, event: KeyboardEvent) {
   if (event.key === "Backspace" && !digits.value[index]) {
      event.preventDefault();
      focusBox(index - 1);
      setCode(digits.value.slice(0, Math.max(0, index - 1)).join(""));
   } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
   } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
   }
}

function onPaste(event: ClipboardEvent) {
   event.preventDefault();
   const pasted = event.clipboardData?.getData("text") ?? "";
   setCode(pasted);
   focusBox(pasted.replace(/\D/g, "").length);
}

defineExpose({ focus: () => focusBox(0) });
</script>

<template>
   <div class="ui-otp" role="group" aria-label="Verification code">
      <input
         v-for="(digit, i) in digits"
         :key="i"
         :ref="(el) => (boxes[i] = el as HTMLInputElement)"
         class="ui-otp__box"
         :value="digit"
         type="text"
         inputmode="numeric"
         maxlength="6"
         :autocomplete="i === 0 ? 'one-time-code' : 'off'"
         :aria-label="`Digit ${i + 1}`"
         :disabled="disabled"
         @input="onInput(i, $event)"
         @keydown="onKeydown(i, $event)"
         @paste="onPaste"
         @focus="($event.target as HTMLInputElement).select()"
      />
   </div>
</template>

<style scoped>
.ui-otp {
   display: flex;
   gap: 8px;
}
.ui-otp__box {
   flex: 1;
   min-width: 0;
   height: 56px;
   padding: 0;
   border: 1.5px solid var(--m-border);
   border-radius: 10px;
   background: transparent;
   color: var(--m-text);
   font: inherit;
   font-size: 22px;
   font-weight: 600;
   text-align: center;
   outline: none;
}
.ui-otp__box:focus {
   border-color: var(--m-lime);
}
.ui-otp__box:disabled {
   opacity: 0.5;
}
@media (min-width: 900px) {
   .ui-otp {
      gap: 12px;
   }
   .ui-otp__box {
      height: 64px;
   }
}
</style>
