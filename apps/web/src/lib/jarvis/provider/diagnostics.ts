import "server-only";
import { jarvisLog } from "../log";
import { JarvisProviderError, type JarvisProvider } from "./types";

/**
 * The ONE diagnostic event for a provider failure: action id, failure class (http | timeout | network | malformed), HTTP status, the API's error TYPE (a short token,
 * never its message) and the elapsed milliseconds. Nothing else is accepted: no key, header, prompt, instruction, customer text or response body can be logged here.
 */
export function logProviderFailure(actionId: string | undefined, err: unknown, startedAt?: number): void {
  const e = err instanceof JarvisProviderError ? err : null;
  jarvisLog({
    event: "provider",
    actionId,
    outcome: "failed",
    failureClass: e ? e.kind : "network",
    status: e?.status ?? null,
    apiErrorType: e?.apiErrorType ?? null,
    elapsedMs: e?.elapsedMs ?? (startedAt === undefined ? null : Date.now() - startedAt),
  });
}

/** The provider an action receives: every failure is logged once (with the action id) and rethrown unchanged. There is no retry here or anywhere else. */
export function withProviderDiagnostics(provider: JarvisProvider | null, actionId: string): JarvisProvider | null {
  if (!provider) return null;
  return {
    kind: provider.kind,
    async structured(req) {
      const started = Date.now();
      try { return await provider.structured(req); }
      catch (e) { logProviderFailure(actionId, e, started); throw e; }
    },
  };
}
