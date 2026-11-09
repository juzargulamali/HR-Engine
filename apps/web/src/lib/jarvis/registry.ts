import "server-only";
import type { AnyJarvisAction } from "./types";

/**
 * The deny-by-default allowlist of JARVIS actions. Nothing is reachable unless it is registered here AND enabled. Each module registers its own actions from its own
 * folder (apps/web/src/lib/jarvis/<module>/), listed once in lib/jarvis/actions.ts. An id that is not here is refused as unknown, whatever the browser or the model says.
 */
const actions = new Map<string, AnyJarvisAction>();

export function registerJarvisAction(action: AnyJarvisAction): void {
  if (!/^jarvis\.[a-z_]+\.[a-z_.]+$/.test(action.id)) throw new Error(`Invalid JARVIS action id: ${action.id}`);
  if (!action.id.startsWith(`jarvis.${action.module === "people_hr" ? "people" : action.module}.`)) throw new Error(`Action ${action.id} must live under its own module prefix`);
  if (actions.has(action.id)) throw new Error(`JARVIS action registered twice: ${action.id}`);
  if (!action.status.enabled && !action.status.reason) throw new Error(`Disabled action ${action.id} needs a reason`);
  actions.set(action.id, action);
}

export type Resolved = { ok: true; action: AnyJarvisAction } | { ok: false; code: "unknown_action" | "action_disabled"; reason: string };

/** Deny by default: unknown ids and disabled actions never resolve. */
export function resolveJarvisAction(id: unknown): Resolved {
  if (typeof id !== "string") return { ok: false, code: "unknown_action", reason: "That is not something JARVIS can do." };
  const a = actions.get(id);
  if (!a) return { ok: false, code: "unknown_action", reason: "That is not something JARVIS can do." };
  if (!a.status.enabled) return { ok: false, code: "action_disabled", reason: a.status.reason ?? "Not available yet." };
  return { ok: true, action: a };
}

export const listJarvisActions = (): AnyJarvisAction[] => [...actions.values()];
/** For tests only. */
export const clearJarvisRegistryForTests = (): void => actions.clear();
