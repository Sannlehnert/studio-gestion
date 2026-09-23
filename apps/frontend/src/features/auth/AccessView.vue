<script setup lang="ts">
import PageHeader from "../../shared/ui/PageHeader.vue";
import { useSession } from "../../app/context";
import { home } from "../../app/router";
const session = useSession();
</script>
<template>
  <main id="main" class="public-layout">
    <span class="brand-word">Studio</span><PageHeader
      :title="
        session.state.value.kind === 'expired'
          ? 'Tu sesión terminó'
          : 'Tu próxima clase empieza acá'
      "
      description="Abrí el enlace que te compartió tu profesora para ingresar a tu espacio."
    />
    <p>
      No necesitás crear una contraseña. Si tu acceso ya no funciona, pedile un
      nuevo enlace.
    </p>
    <RouterLink
      v-if="session.state.value.user"
      class="button button--primary"
      :to="home(session.state.value.user.role)"
    >
      Ir a mi inicio
    </RouterLink><RouterLink v-else class="text-button" to="/admin/login">
      Soy la profesora
    </RouterLink>
  </main>
</template>
