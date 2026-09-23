import { describe, it, expect, vi } from "vitest";
import { createTransport, paymentIntent } from "./client";
import { ApiFailure } from "./errors";
const base = "http://localhost:3000";
describe("HTTP transport", () => {
  it("includes cookies, permits 204 and adds no global idempotency header", async () => {
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      expect((request as Request).credentials).toBe("include");
      expect((request as Request).headers.has("Idempotency-Key")).toBe(false);
      return new Response(null, { status: 204 });
    });
    await createTransport(base, { fetch: fetcher }).client.POST(
      "/api/v1/auth/logout",
      { body: {} },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("normalizes HTTP errors without exposing raw message and retains Retry-After", async () => {
    const client = createTransport(base, {
      fetch: async () =>
        new Response(
          JSON.stringify({ code: "RATE_LIMITED", message: "secret SQL" }),
          { status: 429, headers: { "Retry-After": "60" } },
        ),
    }).client;
    await expect(client.GET("/api/v1/auth/me")).rejects.toMatchObject({
      kind: "http",
      status: 429,
      code: "RATE_LIMITED",
      retryAfter: "60",
    });
  });
  it("network failures of mutations are uncertain and never retried", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network");
    });
    await expect(
      createTransport(base, { fetch: fetcher }).client.POST(
        "/api/v1/auth/admin/login",
        { body: { email: "x@y.test", password: "password" } },
      ),
    ).rejects.toMatchObject({ kind: "network", uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("public auth 401 and protected 403 do not expire another session", async () => {
    const unauthorized = vi.fn();
    let status = 401;
    const { client } = createTransport(base, {
      onUnauthorized: unauthorized,
      fetch: async () => new Response("{}", { status }),
    });
    await expect(
      client.POST("/api/v1/auth/admin/login", {
        body: { email: "a@b.test", password: "password" },
      }),
    ).rejects.toBeInstanceOf(ApiFailure);
    status = 403;
    await expect(client.GET("/api/v1/auth/me")).rejects.toBeInstanceOf(
      ApiFailure,
    );
    expect(unauthorized).not.toHaveBeenCalled();
    status = 401;
    await expect(client.GET("/api/v1/auth/me")).rejects.toBeInstanceOf(
      ApiFailure,
    );
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });
  it("rejects a stale response even if the fetch implementation ignores abort", async () => {
    let resolve!: (response: Response) => void;
    const { client, reset } = createTransport(base, {
      fetch: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    const pending = client.GET("/api/v1/auth/me");
    await Promise.resolve();
    reset();
    resolve(new Response('{"user":{"id":"old","role":"ADMIN"}}'));
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
  });
  it("timeout and explicit cancellation are distinct", async () => {
    const fetcher: typeof fetch = async (input) =>
      new Promise((_resolve, reject) =>
        (input as Request).signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    await expect(
      createTransport(base, { fetch: fetcher, timeoutMs: 5 }).client.GET(
        "/api/v1/auth/me",
      ),
    ).rejects.toMatchObject({ kind: "timeout" });
    const controller = new AbortController();
    const pending = createTransport(base, { fetch: fetcher }).client.GET(
      "/api/v1/auth/me",
      { signal: controller.signal },
    );
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
  });
  it("payment intention freezes the same payload/key across logical retries", async () => {
    const intent = paymentIntent({
      amount: "12.30",
      paidAt: "2026-01-01T00:00:00Z",
    });
    const keys: string[] = [];
    const bodies: string[] = [];
    const client = createTransport(base, {
      fetch: async (input) => {
        const request = input as Request;
        keys.push(request.headers.get("Idempotency-Key")!);
        bodies.push(await request.text());
        return new Response("{}");
      },
    }).client;
    for (let i = 0; i < 2; i++)
      await client.POST(
        "/api/v1/admin/subscriptions/{subscriptionId}/payments",
        {
          params: { path: { subscriptionId: "test" }, header: intent.headers },
          body: intent.body,
        },
      );
    expect(keys[0]).toBe(keys[1]);
    expect(bodies[0]).toBe(bodies[1]);
    expect(Object.isFrozen(intent.body)).toBe(true);
  });
});
