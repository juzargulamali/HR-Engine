import { friendlyCrmError } from "@/lib/crm/errors";
import type { JarvisExecuteOutcome } from "../types";
import type { GenericResult } from "../types";

/**
 * How a JARVIS write RPC answered, in one place for the generic actions: a SQLSTATE answer means the database refused and rolled back (nothing was saved); anything else
 * (network, timeout, gateway) is an UNKNOWN outcome, which the panel resolves by reading the ledger by confirmation id and never by saving a second time.
 */
export function rpcOutcome(r: { data: unknown; error: { message: string; code?: string } | null }, fallback: string): JarvisExecuteOutcome<GenericResult> {
  if (r.error) {
    const code = r.error.code ?? "";
    if (/^[0-9A-Z]{5}$/.test(code) && !code.startsWith("PGRST")) {
      return { kind: "refused", code: code === "42501" ? "not_permitted" : code === "JV001" ? "needs_review" : "save_failed", message: friendlyCrmError(r.error.message) };
    }
    return { kind: "ambiguous" };
  }
  const d = r.data as { status?: string; result_id?: string; reference?: string; extra?: Record<string, unknown> | null; replayed?: boolean; error_code?: string; error_message?: string } | null;
  if (!d || typeof d !== "object") return { kind: "ambiguous" };
  if (d.status === "done" && d.result_id && d.reference) return { kind: "done", result: { resultId: d.result_id, reference: d.reference, extra: d.extra ?? null }, replayed: !!d.replayed };
  return { kind: "refused", code: d.error_code === "JV001" ? "needs_review" : d.error_code === "42501" ? "not_permitted" : "save_failed", message: friendlyCrmError(d.error_message ?? fallback) };
}
