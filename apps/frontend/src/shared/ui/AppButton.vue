<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "danger";
    busy?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  { variant: "primary", type: "button", busy: false },
);
</script>
<template>
  <button
    :type="type"
    class="button"
    :class="`button--${variant}`"
    :disabled="busy"
    :aria-busy="busy || undefined"
  >
    <slot />
  </button>
</template>
