<script setup lang="ts">
import { nextTick, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSession } from "./context";
import FeedbackState from "../shared/ui/FeedbackState.vue";
const session = useSession();
const route = useRoute();
const router = useRouter();
watch(
  () => route.fullPath,
  async () => {
    await nextTick();
    document.querySelector<HTMLElement>("h1")?.focus();
  },
);
watch(
  () => session.state.value.kind,
  (kind) => {
    if (route.meta.role && ["anonymous", "expired"].includes(kind))
      void router.replace(
        route.meta.role === "ADMIN" ? "/admin/login" : "/access-required",
      );
  },
);
</script>
<template>
  <a class="skip-link" href="#main">Saltar al contenido</a>
  <div
    v-if="
      session.state.value.kind === 'checking' &&
        (!session.busy.value || $route.meta.role)
    "
    id="main"
    class="public-layout"
  >
    <FeedbackState kind="loading" title="Verificando tu acceso" />
  </div>
  <div
    v-else-if="
      ['offline', 'logout-unconfirmed'].includes(session.state.value.kind)
    "
    id="main"
    class="public-layout"
  >
    <FeedbackState
      kind="error"
      :title="
        session.state.value.kind === 'logout-unconfirmed'
          ? 'No pudimos confirmar el cierre'
          : 'No pudimos verificar tu acceso'
      "
      :message="
        session.state.value.kind === 'logout-unconfirmed'
          ? 'Ocultamos tus datos en este dispositivo. Reintentá para confirmar el cierre de la sesión.'
          : 'Puede ser un problema de conexión. Esto no significa que tu sesión haya vencido.'
      "
      retry
      @retry="
        session.state.value.kind === 'logout-unconfirmed'
          ? session.logout()
          : session.retry()
      "
    />
  </div>
  <RouterView v-else />
</template>
