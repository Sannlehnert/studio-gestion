import { inject, type InjectionKey } from "vue";
import type { Session } from "../features/auth/session";
export const sessionKey: InjectionKey<Session> = Symbol("session");
export const activationKey: InjectionKey<{
  take(): string | undefined;
  discard(): void;
}> = Symbol("activation");
export function useSession() {
  const session = inject(sessionKey);
  if (!session) throw new Error("Session provider missing");
  return session;
}
