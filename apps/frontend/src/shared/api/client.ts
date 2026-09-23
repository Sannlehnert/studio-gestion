import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { ApiFailure } from "./errors";

export function createTransport(
  baseUrl: string,
  options: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    onUnauthorized?: () => void;
  } = {},
) {
  let epoch = 0;
  const active = new Set<AbortController>();
  const nativeFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, { ...init, credentials: "include" });
    const controller = new AbortController();
    const captured = epoch;
    const mutable = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    let timedOut = false;
    const cancel = () => controller.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) controller.abort();
    active.add(controller);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? 15000);
    try {
      const response = await nativeFetch(
        new Request(request, { signal: controller.signal }),
      );
      // Read body before releasing cancellation: a response may stream after its headers.
      const body = response.status === 204 ? null : await response.text();
      if (captured !== epoch || controller.signal.aborted)
        throw new ApiFailure("cancelled", 0, "", mutable);
      if (!response.ok) {
        let code = "";
        try {
          const parsed: unknown = JSON.parse(body ?? "");
          if (
            parsed &&
            typeof parsed === "object" &&
            "code" in parsed &&
            typeof parsed.code === "string"
          )
            code = parsed.code;
        } catch {
          /* Never expose proxy HTML or raw messages. */
        }
        const isPublicAuth =
          /\/auth\/(admin\/login|student\/activate|logout)$/.test(
            new URL(request.url).pathname,
          );
        if (response.status === 401 && !isPublicAuth)
          options.onUnauthorized?.();
        throw new ApiFailure(
          "http",
          response.status,
          code,
          mutable && response.status >= 500,
          response.headers.get("Retry-After"),
        );
      }
      if (body) {
        try {
          JSON.parse(body);
        } catch {
          throw new ApiFailure(
            "invalid-response",
            response.status,
            "",
            mutable,
          );
        }
      }
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      throw new ApiFailure(
        timedOut
          ? "timeout"
          : controller.signal.aborted
            ? "cancelled"
            : "network",
        0,
        "",
        mutable,
      );
    } finally {
      clearTimeout(timer);
      active.delete(controller);
      request.signal.removeEventListener("abort", cancel);
    }
  };
  return {
    client: createClient<paths>({
      baseUrl,
      fetch: transport,
      credentials: "include",
    }),
    reset() {
      epoch++;
      for (const controller of active) controller.abort();
      active.clear();
    },
  };
}

// One immutable payload + key per logical intention. No storage and no automatic retry.
export function paymentIntent(
  payload: paths["/api/v1/admin/subscriptions/{subscriptionId}/payments"]["post"]["requestBody"]["content"]["application/json"],
) {
  const body = Object.freeze(structuredClone(payload));
  const headers = Object.freeze({ "Idempotency-Key": crypto.randomUUID() });
  return Object.freeze({ body, headers });
}
