<script setup lang="ts">
defineProps<{ title: string; eyebrow?: string; description?: string }>();
</script>
<template>
  <header class="page-header">
    <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
    <h1 tabindex="-1">{{ title }}</h1>
    <p v-if="description" class="lead">{{ description }}</p>
    <slot />
  </header>
</template>
