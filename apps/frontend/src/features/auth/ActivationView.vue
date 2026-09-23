<script setup lang="ts">
import { inject, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { activationKey, useSession } from "../../app/context";
import { errorMessage } from "../../shared/api/errors";
import PageHeader from "../../shared/ui/PageHeader.vue";
import AppButton from "../../shared/ui/AppButton.vue";
const activation = inject(activationKey)!;
const session = useSession();
const router = useRouter();
let token = activation.take();
const hasToken = !!token;
const error = ref("");
onBeforeUnmount(() => {
  token = undefined;
  activation.discard();
});
async function activate() {
  if (!token) return;
  const secret = token;
  token = undefined;
  try {
    await session.activate(secret);
    if (session.state.value.user?.role === "STUDENT")
      await router.replace(session.destination());
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}
</script>
<template>
  <main id="main" class="public-layout">
    <span class="brand-word">Studio</span><PageHeader
      title="Abrí tu espacio de clases"
      :description="
        hasToken
          ? 'Confirmá para usar el acceso que te compartió tu profesora.'
          : 'Abrí el enlace que te compartió tu profesora. Si ya lo usaste, podés volver a tu inicio.'
      "
    />
    <p v-if="session.state.value.user">
      Este acceso puede cambiar la sesión actualmente abierta. Confirmá sólo si
      querés usar el nuevo enlace.
    </p>
    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
    <AppButton
      v-if="hasToken && !error"
      :busy="session.busy.value"
      @click="activate"
    >
      {{
        session.busy.value ? "Abriendo tu espacio…" : "Usar este acceso"
      }}
    </AppButton><RouterLink class="text-button" to="/access-required">Volver</RouterLink>
  </main>
</template>
