<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useSession } from "../../app/context";
import { errorMessage } from "../../shared/api/errors";
import PageHeader from "../../shared/ui/PageHeader.vue";
import TextField from "../../shared/ui/TextField.vue";
import AppButton from "../../shared/ui/AppButton.vue";
const session = useSession();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const show = ref(false);
async function submit() {
  error.value = "";
  try {
    await session.login(email.value, password.value);
    if (session.state.value.user) await router.replace(session.destination());
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    password.value = "";
  }
}
</script>
<template>
  <main id="main" class="public-layout login-layout">
    <div class="login-intro">
      <span class="brand-word">Studio</span>
      <p class="eyebrow">Tu gestión, con calma</p>
      <h2>Más espacio para<br />dar tus clases.</h2>
      <p>Un lugar para organizar el día y acompañar a tus alumnas.</p>
    </div>
    <div class="login-form">
      <PageHeader
        title="Ingresar a gestión"
        description="Usá tu acceso de administración."
      />
      <template v-if="session.state.value.user">
        <p>
          Tenés una sesión de alumna abierta. Cerrala antes de cambiar de
          acceso.
        </p>
        <AppButton @click="session.logout()">
          Cerrar sesión actual
        </AppButton>
      </template>
      <form v-else @submit.prevent="submit">
        <TextField
          v-model="email"
          label="Email"
          type="email"
          autocomplete="username"
          required
          :disabled="session.busy.value"
        />
        <TextField
          v-model="password"
          label="Contraseña"
          :type="show ? 'text' : 'password'"
          autocomplete="current-password"
          required
          :disabled="session.busy.value"
        />
        <button
          type="button"
          class="text-button"
          :aria-pressed="show"
          @click="show = !show"
        >
          {{ show ? "Ocultar contraseña" : "Mostrar contraseña" }}
        </button>
        <p v-if="error" role="alert" class="error-banner">{{ error }}</p>
        <AppButton type="submit" :busy="session.busy.value">
          {{
            session.busy.value ? "Ingresando…" : "Ingresar"
          }}
        </AppButton>
      </form>
      <p class="login-help">
        ¿Sos alumna?
        <RouterLink to="/access-required">Ingresá con tu enlace</RouterLink>.
      </p>
    </div>
  </main>
</template>
