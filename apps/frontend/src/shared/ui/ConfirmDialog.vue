<script setup lang="ts">
import { nextTick, ref, useId, watch } from "vue";
import AppButton from "./AppButton.vue";
const props = defineProps<{
  open: boolean;
  title: string;
  confirmLabel: string;
  busy?: boolean;
}>();
const emit = defineEmits<{ close: []; confirm: [] }>();
const element = ref<HTMLDialogElement>();
const id = useId();
let trigger: HTMLElement | null = null;
watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (open) {
      trigger = document.activeElement as HTMLElement;
      element.value?.showModal();
    } else {
      element.value?.close();
      if (trigger?.isConnected) trigger.focus();
    }
  },
  { immediate: true },
);
function cancel(event: Event) {
  event.preventDefault();
  if (!props.busy) emit("close");
}
function containFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const controls = [
    ...(element.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ) ?? []),
  ].filter((control) => control.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
</script>
<template>
  <dialog
    ref="element"
    :aria-labelledby="id"
    :aria-describedby="`${id}-description`"
    @cancel="cancel"
    @keydown="containFocus"
  >
    <h2 :id="id">{{ title }}</h2>
    <div :id="`${id}-description`" class="dialog-content"><slot /></div>
    <div class="dialog-actions">
      <AppButton
        variant="secondary"
        autofocus
        :disabled="busy"
        @click="emit('close')"
      >
        Cancelar
      </AppButton>
      <AppButton :busy="busy" @click="emit('confirm')">
        {{
          confirmLabel
        }}
      </AppButton>
    </div>
  </dialog>
</template>
