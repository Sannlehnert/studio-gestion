<script setup lang="ts">
import { useRoute } from "vue-router";
import PageHeader from "../shared/ui/PageHeader.vue";
const route = useRoute();
</script>
<template>
  <PageHeader
    :title="String(route.meta.title)"
    eyebrow="Studio · Base de la aplicación"
  />
  <section class="foundation-note">
    <span class="status-label">En preparación</span>
    <h2>Un lugar para lo que sigue</h2>
    <p>
      La navegación y tu acceso ya están disponibles. El contenido de esta
      sección se incorporará en la próxima etapa del producto.
    </p>
    <p class="muted">
      Esta vista todavía no consulta ni muestra registros de clases, alumnas o
      pagos.
    </p>
  </section>
</template>
