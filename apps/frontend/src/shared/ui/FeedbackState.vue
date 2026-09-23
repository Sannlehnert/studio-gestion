<script setup lang="ts">
import AppButton from "./AppButton.vue";
defineProps<{
  kind: "loading" | "error" | "empty";
  title: string;
  message?: string;
  retry?: boolean;
}>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <section
    class="feedback"
    :class="`feedback--${kind}`"
    :role="kind === 'error' ? 'alert' : 'status'"
    :aria-busy="kind === 'loading'"
  >
    <span
      v-if="kind === 'loading'"
      class="loading-mark"
      aria-hidden="true"
    ></span>
    <h2>{{ title }}</h2>
    <p v-if="message">{{ message }}</p>
    <AppButton v-if="retry" variant="secondary" @click="$emit('retry')">
      Reintentar
    </AppButton>
  </section>
</template>
