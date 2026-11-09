import { friendlyCrmError } from "@/lib/crm/errors";
import type { JarvisExecuteOutcome } from "../types";
import type { GenericResult } from "../types";

/**
 * The database's own refusals of the PROOF (before anything is written): JV002 not valid, JV003 expired, JV004 the database has no confirmation key (fail closed). The person is
 * told, in words, to review again (or that JARVIS cannot save right now); nothing was created.
 */
export function proofRefusal(code: string, message: string): Extract<JarvisExecuteOutcome<unknown>, { kind: "refused" }> | null {
  if (code === "JV002" || code === "JV003") return { kind: "refused", code: "needs_review", message: code === "JV003" ? "This review has expired. Review the details again before saving anything." : "This confirmation is not valid. Review the details again." };
  if (code === "JV004") return { kind: "refused", code: "save_failed", message: "JARVIS cannot save changes right now. Sales & CRM is not affected: you can make the change yourself." };
  if (code === "40001") return { kind: "refused", code: "needs_review", message: friendlyCrmError(message) };
  return null;
}

/**
 * How a JARVIS write RPC answered, in one place for the generic actions: a SQLSTATE answer means the database refused and rolled back (nothing was saved); anything else
 * (network, timeout, gateway) is an UNKNOWN outcome, which the panel resolves by reading the ledger by confirmation id and never by saving a second time.
 */
export function rpcOutcome(r: { data: unknown; error: { message: string; code?: string } | null }, fallback: string): JarvisExecuteOutcome<GenericResult> {
  if (r.error) {
    const code = r.error.code ?? "";
    if (/^[0-9A-Z]{5}$/.test(code) && !code.startsWith("PGRST")) {
      const proof = proofRefusal(code, r.error.message);
      if (proof) return proof;
      return { kind: "refused", code: code === "42501" ? "not_permitted" : code === "JV001" ? "needs_review" : "save_failed", message: friendlyCrmError(r.error.message) };
    }
    return { kind: "ambiguous" };
  }
  const d = r.data as { status?: string; result_id?: string; reference?: string; extra?: Record<string, unknown> | null; replayed?: boolean; error_code?: string; error_message?: string } | null;
  if (!d || typeof d !== "object") return { kind: "ambiguous" };
  if (d.status === "done" && d.result_id && d.reference) return { kind: "done", result: { resultId: d.result_id, reference: d.reference, extra: d.extra ?? null }, replayed: !!d.replayed };
  return { kind: "refused", code: d.error_code === "JV001" ? "needs_review" : d.error_code === "42501" ? "not_permitted" : "save_failed", message: friendlyCrmError(d.error_message ?? fallback) };
}
