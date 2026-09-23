import { createRouter, createWebHistory, type RouterHistory } from "vue-router";
import type { Session } from "../features/auth/session";
import Shell from "./Shell.vue";
import FoundationView from "./FoundationView.vue";
import LoginView from "../features/auth/LoginView.vue";
import ActivationView from "../features/auth/ActivationView.vue";
import AccessView from "../features/auth/AccessView.vue";
import PublicView from "./PublicView.vue";
export function home(role: string) {
  return role === "ADMIN" ? "/admin" : "/student";
}
export function buildRouter(
  session: Session,
  history: RouterHistory = createWebHistory(),
) {
  const router = createRouter({
    history,
    routes: [
      {
        path: "/",
        component: AccessView,
      },
      {
        path: "/admin/login",
        component: LoginView,
        meta: { title: "Ingresar a gestión" },
      },
      {
        path: "/activate",
        component: ActivationView,
        meta: { title: "Activar acceso" },
      },
      {
        path: "/access-required",
        component: AccessView,
        meta: { title: "Tu acceso" },
      },
      {
        path: "/admin",
        component: Shell,
        meta: { role: "ADMIN" },
        children: [
          { path: "", component: FoundationView, meta: { title: "Hoy" } },
          {
            path: "students",
            component: FoundationView,
            meta: { title: "Alumnas" },
          },
          {
            path: "classes",
            component: FoundationView,
            meta: { title: "Clases" },
          },
          {
            path: "manage",
            component: FoundationView,
            meta: { title: "Gestión" },
          },
        ],
      },
      {
        path: "/student",
        component: Shell,
        meta: { role: "STUDENT" },
        children: [
          { path: "", component: FoundationView, meta: { title: "Inicio" } },
          {
            path: "classes",
            component: FoundationView,
            meta: { title: "Clases" },
          },
          {
            path: "history",
            component: FoundationView,
            meta: { title: "Historial" },
          },
        ],
      },
      {
        path: "/forbidden",
        component: PublicView,
        props: {
          title: "Este espacio no corresponde a tu acceso",
          message: "Volvé a tu inicio para continuar.",
        },
        meta: { title: "Acceso no autorizado" },
      },
      {
        path: "/:pathMatch(.*)*",
        component: PublicView,
        props: {
          title: "No encontramos esta página",
          message: "Podés volver al inicio y seguir desde ahí.",
        },
        meta: { title: "Página no encontrada" },
      },
    ],
  });
  router.beforeEach(async (to) => {
    await session.ensure();
    const state = session.state.value;
    if (to.path === "/") return state.user ? home(state.user.role) : "/access-required";
    if (
      to.meta.role &&
      state.kind === "authenticated" &&
      state.user.role !== to.meta.role
    )
      return "/forbidden";
    if (
      to.meta.role &&
      (state.kind === "anonymous" || state.kind === "expired")
    ) {
      session.rememberDestination(to.path, String(to.meta.role));
      return to.meta.role === "ADMIN" ? "/admin/login" : "/access-required";
    }
    if (
      to.path === "/admin/login" &&
      state.kind === "authenticated" &&
      state.user.role === "ADMIN"
    )
      return "/admin";
  });
  router.afterEach((to) => {
    document.title = `${String(to.meta.title ?? "Studio")} · Studio Gestión`;
  });
  return router;
}
