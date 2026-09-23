<script setup lang="ts">
import { useSession } from "./context";
import { home } from "./router";
import PageHeader from "../shared/ui/PageHeader.vue";
defineProps<{ title: string; message: string }>();
const session = useSession();
</script>
<template>
  <main id="main" class="public-layout">
    <PageHeader :title="title" :description="message" /><RouterLink
      class="button button--primary"
      :to="
        session.state.value.user
          ? home(session.state.value.user.role)
          : '/access-required'
      "
    >
      Volver al inicio
    </RouterLink>
  </main>
</template>
