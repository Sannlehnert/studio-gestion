// Called before loading Router or application code. Closure is never reactive/cached.
export function captureActivation(
  location: Pick<Location, "pathname" | "search" | "hash">,
  history: Pick<History, "replaceState" | "state">,
) {
  let token: string | undefined;
  if (location.pathname === "/activate") {
    token =
      new URLSearchParams(location.hash.slice(1)).get("token") ?? undefined;
    history.replaceState(history.state, "", location.pathname); // Also discard unexpected query params.
  }
  return {
    take() {
      const value = token;
      token = undefined;
      return value;
    },
    discard() {
      token = undefined;
    },
  };
}
