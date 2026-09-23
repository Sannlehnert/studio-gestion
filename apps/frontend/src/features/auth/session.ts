import { readonly, shallowRef } from "vue";
import { QueryClient } from "@tanstack/vue-query";
import { createTransport } from "../../shared/api/client";
import { ApiFailure } from "../../shared/api/errors";
import type { components } from "../../shared/api/schema";

type Identity = components["schemas"]["UserIdentityDto"];
export type SessionState =
  | {
      kind:
        "checking" | "anonymous" | "expired" | "offline" | "logout-unconfirmed";
      user: null;
    }
  | { kind: "authenticated"; user: Identity };
export function createSession(
  baseUrl: string,
  query: QueryClient,
  fetcher?: typeof fetch,
) {
  const state = shallowRef<SessionState>({ kind: "checking", user: null });
  const busy = shallowRef(false);
  let generation = 0;
  let bootstrap: Promise<void> | undefined;
  let transition: Promise<void> | undefined;
  let returnTo: { path: string; role: string } | undefined;
  const clear = () => {
    generation++;
    transport.reset();
    void query.cancelQueries();
    query.clear();
    bootstrap = undefined;
  };
  const expire = () => {
    const wasAuthenticated = state.value.kind === "authenticated";
    clear();
    state.value = {
      kind: wasAuthenticated ? "expired" : "anonymous",
      user: null,
    };
  };
  const transport = createTransport(baseUrl, {
    fetch: fetcher,
    onUnauthorized: expire,
  });
  async function verify() {
    const current = generation;
    try {
      const result = await transport.client.GET("/api/v1/auth/me");
      if (current !== generation) return;
      if (
        !result.data?.user ||
        !["ADMIN", "STUDENT"].includes(result.data.user.role) ||
        typeof result.data.user.id !== "string"
      )
        throw new ApiFailure("invalid-response");
      const previous = state.value.user;
      if (
        previous &&
        (previous.id !== result.data.user.id ||
          previous.role !== result.data.user.role)
      )
        clear();
      state.value = { kind: "authenticated", user: result.data.user };
    } catch (error) {
      if (current !== generation) return;
      state.value = {
        kind:
          error instanceof ApiFailure && error.status === 401
            ? "anonymous"
            : "offline",
        user: null,
      };
    }
  }
  function ensure() {
    if (transition) return transition.catch(() => undefined);
    if (state.value.kind !== "checking") return Promise.resolve();
    return (bootstrap ??= verify().finally(() => {
      bootstrap = undefined;
    }));
  }
  function authenticate(
    operation: () => Promise<unknown>,
    expectedRole: Identity["role"],
  ) {
    if (transition) return transition;
    const previousUser = state.value.user;
    busy.value = true;
    clear();
    state.value = { kind: "checking", user: null };
    const current = generation;
    transition = (async () => {
      try {
        await operation();
        if (current === generation) await verify();
      } catch (error) {
        if (current === generation) {
          // A lost activation/login response may still have established the cookie.
          if (error instanceof ApiFailure && error.uncertain) await verify();
          else state.value = { kind: "anonymous", user: null };
        }
        const actual = (state.value as SessionState).user;
        if (
          !actual ||
          actual.role !== expectedRole ||
          (previousUser?.id === actual.id && previousUser.role === actual.role)
        )
          throw error;
      }
    })().finally(() => {
      busy.value = false;
      transition = undefined;
    });
    return transition;
  }
  function logout(): Promise<void> {
    // Let an in-flight Set-Cookie settle before revoking it; aborting the request
    // cannot undo a server-side login. Never silently discard a logout request.
    if (transition) return transition.catch(() => undefined).then(logout);
    returnTo = undefined;
    busy.value = true;
    clear();
    state.value = { kind: "checking", user: null };
    transition = (async () => {
      try {
        await transport.client.POST("/api/v1/auth/logout", { body: {} });
        state.value = { kind: "anonymous", user: null };
      } catch {
        state.value = { kind: "logout-unconfirmed", user: null };
      }
    })().finally(() => { busy.value = false; transition = undefined; });
    return transition;
  }
  return {
    state: readonly(state),
    busy: readonly(busy),
    client: transport.client,
    ensure,
    async retry() {
      if (busy.value) return;
      clear();
      state.value = { kind: "checking", user: null };
      await ensure();
    },
    login(email: string, password: string) {
      return authenticate(
        () =>
          transport.client.POST("/api/v1/auth/admin/login", {
            body: { email, password },
          }),
        "ADMIN",
      );
    },
    activate(token: string) {
      return authenticate(
        () =>
          transport.client.POST("/api/v1/auth/student/activate", {
            body: { token },
          }),
        "STUDENT",
      );
    },
    rememberDestination(path: string, role: string) {
      const allowed =
        role === "ADMIN"
          ? ["/admin", "/admin/students", "/admin/classes", "/admin/manage"]
          : ["/student", "/student/classes", "/student/history"];
      if (allowed.includes(path)) returnTo = { path, role };
    },
    destination() {
      const target = returnTo;
      returnTo = undefined;
      return target?.role === state.value.user?.role
        ? target!.path
        : state.value.user?.role === "ADMIN"
          ? "/admin"
          : "/student";
    },
    logout,
    key(resource: string, ...filters: unknown[]) {
      return [
        "session",
        generation,
        state.value.user?.role,
        state.value.user?.id,
        resource,
        ...filters,
      ] as const;
    },
  };
}
export type Session = ReturnType<typeof createSession>;
