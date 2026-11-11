import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "./errors";
import type { EquipmentState } from "./work-attention";

/**
 * The equipment states the system can confirm for one project, read with the viewer's own session (row-level security decides what they may see): draft requests, requests
 * submitted and not yet started by the warehouse, and whether the last Sales-handover import failed with no handover request in place. A failed read is `error`, never "nothing".
 */
export async function loadEquipmentState(projectId: string): Promise<EquipmentState> {
  const db = await createClient();
  const [reqs, log] = await Promise.all([
    db.from("inv_requests").select("id, code, status, source").eq("project_id", projectId).order("created_at"),
    db.from("inv_import_log").select("outcome, detail, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1),
  ]);
  if (reqs.error) return isNotInstalled(reqs.error) ? { status: "unavailable" } : { status: "error" };
  if (log.error && !isNotInstalled(log.error)) return { status: "error" };
  const rows = reqs.data ?? [];
  const last = log.data?.[0] ?? null;
  const hasHandoverRequest = rows.some((r) => r.source === "sales_handover" && r.status !== "cancelled");
  return {
    status: "ok",
    drafts: rows.filter((r) => r.status === "draft").map((r) => ({ id: r.id, code: r.code })),
    waiting: rows.filter((r) => r.status === "submitted").map((r) => ({ id: r.id, code: r.code })),
    importFailed: last && last.outcome === "failed" && !hasHandoverRequest ? { at: last.created_at, detail: last.detail } : null,
    requests: rows.filter((r) => r.status !== "cancelled").length,
  };
}
