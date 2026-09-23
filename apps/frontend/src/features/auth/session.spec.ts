import { describe, it, expect } from "vitest";
import { createMemoryHistory } from "vue-router";
import { createSession } from "./session";
import { captureActivation } from "./activation";
import { createQueryClient } from "../../app/query";
import { buildRouter } from "../../app/router";
const identity = (role: "ADMIN" | "STUDENT") => ({
  user: { id: role.toLowerCase(), role },
});
describe("session and router", () => {
  it("logout requested during login revokes the cookie after login settles", async () => {
    let finish!: (response: Response) => void;
    const calls: string[] = [];
    const session = createSession("http://localhost:3000", createQueryClient(), async input => {
      const path = new URL((input as Request).url).pathname; calls.push(path);
      if (path.endsWith('/login')) return new Promise(resolve => { finish = resolve; });
      if (path.endsWith('/logout')) return new Response(null, { status: 204 });
      return Response.json(identity('ADMIN'));
    });
    const login = session.login('admin@example.test', 'password');
    await Promise.resolve(); const logout = session.logout();
    finish(Response.json(identity('ADMIN'))); await Promise.all([login, logout]);
    expect(calls.at(-1)).toBe('/api/v1/auth/logout'); expect(session.state.value.kind).toBe('anonymous');
  });
  it("root waits for verified role before choosing the home route", async () => {
    const session = createSession('http://localhost:3000', createQueryClient(), async () => Response.json(identity('ADMIN')));
    const router = buildRouter(session, createMemoryHistory()); await router.push('/');
    expect(router.currentRoute.value.path).toBe('/admin');
  });
  it.each(["ADMIN", "STUDENT"] as const)(
    "allows %s only in its experience",
    async (role) => {
      const session = createSession(
        "http://localhost:3000",
        createQueryClient(),
        async () => Response.json(identity(role)),
      );
      const router = buildRouter(session, createMemoryHistory());
      await router.push(role === "ADMIN" ? "/admin" : "/student");
      expect(session.state.value.user?.role).toBe(role);
      await router.push(role === "ADMIN" ? "/student" : "/admin");
      expect(router.currentRoute.value.path).toBe("/forbidden");
    },
  );
  it("anonymous redirects while disconnection remains distinct", async () => {
    const session = createSession(
      "http://localhost:3000",
      createQueryClient(),
      async () => new Response("{}", { status: 401 }),
    );
    const router = buildRouter(session, createMemoryHistory());
    await router.push("/admin");
    expect(router.currentRoute.value.path).toBe("/admin/login");
    const offline = createSession(
      "http://localhost:3000",
      createQueryClient(),
      async () => {
        throw new TypeError();
      },
    );
    await offline.ensure();
    expect(offline.state.value.kind).toBe("offline");
  });
  it("logout wins against late bootstrap and removes private queries", async () => {
    let resolve!: (response: Response) => void;
    const query = createQueryClient();
    query.setQueryData(["private"], "old secret");
    const session = createSession(
      "http://localhost:3000",
      query,
      async (input) =>
        (input as Request).method === "POST"
          ? new Response(null, { status: 204 })
          : new Promise((r) => {
              resolve = r;
            }),
    );
    const pending = session.ensure();
    await Promise.resolve();
    expect(session.state.value.kind).toBe("checking");
    await session.logout();
    resolve(Response.json(identity("ADMIN")));
    await pending;
    expect(session.state.value.kind).toBe("anonymous");
    expect(query.getQueryData(["private"])).toBeUndefined();
  });
  it("expired protected session clears data while failed logout never claims cookie revoked", async () => {
    let status = 200;
    const query = createQueryClient();
    const session = createSession("http://localhost:3000", query, async () =>
      status === 0
        ? Promise.reject(new TypeError())
        : Response.json(identity("ADMIN"), { status }),
    );
    await session.ensure();
    query.setQueryData(["private"], "secret");
    status = 401;
    await expect(session.client.GET("/api/v1/auth/me")).rejects.toBeTruthy();
    expect(session.state.value.kind).toBe("expired");
    expect(query.getQueryCache().getAll()).toHaveLength(0);
    status = 0;
    await session.logout();
    expect(session.state.value.kind).toBe("logout-unconfirmed");
  });
  it("activation fragment is removed immediately and consumed only once", () => {
    history.replaceState(null, "", "/activate#token=secret");
    const activation = captureActivation(location, history);
    expect(location.hash).toBe("");
    expect(activation.take()).toBe("secret");
    expect(activation.take()).toBeUndefined();
  });
  it("navigation waits for login and cannot start an anonymous bootstrap mid-transition", async () => {
    let finish!: (response: Response) => void;
    const session = createSession(
      "http://localhost:3000",
      createQueryClient(),
      async (input) =>
        (input as Request).method === "POST"
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Response.json(identity("ADMIN")),
    );
    const login = session.login("admin@example.test", "password");
    const router = buildRouter(session, createMemoryHistory());
    const navigation = router.push("/admin/classes");
    await Promise.resolve();
    finish(Response.json(identity("ADMIN")));
    await Promise.all([login, navigation]);
    expect(router.currentRoute.value.path).toBe("/admin/classes");
    expect(session.state.value.user?.role).toBe("ADMIN");
  });
  it("changing identity cancels old query results, changes query keys and rejects unsafe returns", async () => {
    let role: "ADMIN" | "STUDENT" = "ADMIN";
    let finish!: (response: Response) => void;
    const query = createQueryClient();
    const session = createSession(
      "http://localhost:3000",
      query,
      async (input) => {
        const request = input as Request;
        if (request.url.endsWith("/auth/me"))
          return Response.json(identity(role));
        if (request.method === "POST") {
          role = "STUDENT";
          return Response.json(identity(role));
        }
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    await session.ensure();
    const oldKey = session.key("students");
    const previous = query.fetchQuery({
      queryKey: oldKey,
      queryFn: ({ signal }) =>
        session.client.GET("/api/v1/admin/students", { signal }),
    });
    const caught = previous.catch(() => undefined);
    await Promise.resolve();
    await session.activate("fixture-only");
    finish(Response.json({ items: ["old private data"] }));
    await caught;
    expect(query.getQueryData(oldKey)).toBeUndefined();
    expect(session.key("students")).not.toEqual(oldKey);
    session.rememberDestination("https://foreign.example", "STUDENT");
    expect(session.destination()).toBe("/student");
    session.rememberDestination("/admin/students", "ADMIN");
    expect(session.destination()).toBe("/student");
    session.rememberDestination("/student/history", "STUDENT");
    expect(session.destination()).toBe("/student/history");
  });
  it("uncertain activation does not claim the already existing Student identity proves success", async () => {
    const session = createSession(
      "http://localhost:3000",
      createQueryClient(),
      async (input) => {
        if ((input as Request).method === "POST")
          throw new TypeError("network");
        return Response.json(identity("STUDENT"));
      },
    );
    await session.ensure();
    await expect(session.activate("fixture-only")).rejects.toMatchObject({
      uncertain: true,
    });
  });
});
