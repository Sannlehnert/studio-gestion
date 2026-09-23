import { createApp } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createSession } from "../features/auth/session";
import { readConfig } from "../shared/lib/config";
import { createQueryClient } from "./query";
import { buildRouter } from "./router";
import { activationKey, sessionKey } from "./context";
import App from "./App.vue";
import "../shared/styles/tokens.css";
export function mount(activation: {
  take(): string | undefined;
  discard(): void;
}) {
  try {
    const config = readConfig(import.meta.env);
    const query = createQueryClient();
    const session = createSession(config.apiBaseUrl, query);
    const router = buildRouter(session);
    const app = createApp(App);
    app.provide(sessionKey, session).provide(activationKey, activation);
    app.use(VueQueryPlugin, { queryClient: query }).use(router).mount("#app");
  } catch {
    activation.discard();
    const root = document.getElementById("app");
    if (root)
      root.textContent =
        "No pudimos iniciar la aplicación. Revisá la configuración de conexión.";
  }
}
