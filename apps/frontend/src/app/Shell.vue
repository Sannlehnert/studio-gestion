<script setup lang="ts">
import { computed, ref } from "vue";
import {
  CalendarDays,
  Users,
  Settings,
  House,
  History,
  LogOut,
} from "@lucide/vue";
import { useSession } from "./context";
import ConfirmDialog from "../shared/ui/ConfirmDialog.vue";
const session = useSession();
const confirm = ref(false);
const admin = computed(() => session.state.value.user?.role === "ADMIN");
const links = computed(() =>
  admin.value
    ? [
        { to: "/admin", label: "Hoy", icon: House },
        { to: "/admin/students", label: "Alumnas", icon: Users },
        { to: "/admin/classes", label: "Clases", icon: CalendarDays },
        { to: "/admin/manage", label: "Gestión", icon: Settings },
      ]
    : [
        { to: "/student", label: "Inicio", icon: House },
        { to: "/student/classes", label: "Clases", icon: CalendarDays },
        { to: "/student/history", label: "Historial", icon: History },
      ],
);
async function logout() {
  confirm.value = false;
  await session.logout();
}
</script>
<template>
  <div
    v-if="session.state.value.kind === 'authenticated'"
    class="shell"
    :class="admin ? 'shell--admin' : 'shell--student'"
  >
    <header class="shell-brand">
      <span class="brand-symbol" aria-hidden="true">s.</span><span>Studio<span class="brand-detail">{{
        admin ? "Gestión de clases" : "Tu espacio de clases"
      }}</span></span>
    </header>
    <nav class="main-nav" :aria-label="admin ? 'Administración' : 'Alumna'">
      <RouterLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        :class="{ selected: $route.path === link.to }"
      >
        <component :is="link.icon" :size="20" aria-hidden="true" /><span>{{
          link.label
        }}</span>
      </RouterLink>
    </nav>
    <div class="account">
      <span class="role-label">{{ admin ? "Administración" : "Alumna" }}</span><button class="account-button" @click="confirm = true">
        <LogOut :size="18" aria-hidden="true" /><span>Cerrar sesión</span>
      </button>
    </div>
    <main id="main" class="main-content"><RouterView /></main>
    <ConfirmDialog
      :open="confirm"
      title="¿Cerrar tu sesión?"
      confirm-label="Cerrar sesión"
      @close="confirm = false"
      @confirm="logout"
    >
      <p>
        {{
          admin
            ? "Para volver a gestionar tus clases, vas a necesitar ingresar con tu email y contraseña."
            : "Para volver a ingresar, vas a necesitar un nuevo enlace de tu profesora."
        }}
      </p>
    </ConfirmDialog>
  </div>
</template>
