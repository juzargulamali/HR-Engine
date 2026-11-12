import { friendlyProjectError } from "@/lib/projects/errors";
import type { DeliveryPlan } from "../model";
import { parseDeliveryPlanWorkbook } from "./parse";
import { planDeliveryImport, type ImportPlan, type Named, type PreviewRow, type Resolutions } from "./plan";

/**
 * The Delivery Plan import, one flow for the route and the tests. Preview: read the file, compare it with the plan as it is now, write nothing, and return the plan
 * revision the preview was made at. Confirm: read the file again, compare again with the CURRENT plan, and hand the batch to `proj_dp_apply_import` with the revision
 * the person previewed; the database refuses it whole if the plan moved on, and repeats every permission check (so a hand-made request cannot get past this layer).
 * Everything runs under the signed-in person's own session.
 */
type Rpc = {
  rpc(fn: "proj_dp_apply_import", args: { p_project_id: string; p_expected_rev: number; p_items: Record<string, unknown>[]; p_lines: Record<string, unknown>[] }): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};
export type PlanRead = { state: "ok"; plan: DeliveryPlan } | { state: "not_installed" } | { state: "denied" } | { state: "error" };

export interface DpImportDeps {
  db: Rpc;
  /** false = signed out. */
  signedIn: boolean;
  /** The project as this person may see it; null = it does not exist or they may not see it. */
  project: { id: string; companyId: string; status: string; level: string } | null;
  loadPlan: (projectId: string) => Promise<PlanRead>;
  /** The project's members. */
  loadPeople: () => Promise<Named[]>;
  /** The company's stock items that can still be requested; null = the read failed or Inventory is not installed. */
  loadInventoryItems: (companyId: string) => Promise<Named[] | null>;
}
export interface DpImportRequest { fileName: string; bytes: Uint8Array; mode: "preview" | "confirm"; rev?: number | null; resolutions?: Resolutions }

export const PREVIEW_STALE = "The plan changed after this preview was prepared. Nothing was imported. Upload the workbook again.";

export type DpImportResponse =
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 503; error: string; code?: "preview_stale" | "needs_attention" }
  | {
      ok: true; mode: "preview"; rev: number; summary: ImportPlan["summary"];
      /** Every row except the plain unchanged ones (those are only counted). */
      rows: PreviewRow[]; warnings: string[]; fileRows: { deliverables: number; breakdown: number; examplesSkipped: number };
    }
  | { ok: true; mode: "confirm"; counts: { added: number; updated: number; proposed: number; unchanged: number }; nothingToDo: boolean };

const finished = (status: string) => status === "completed" || status === "archived";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function runDeliveryPlanImport(deps: DpImportDeps, req: DpImportRequest): Promise<DpImportResponse> {
  if (!deps.signedIn) return { ok: false, status: 401, error: "Sign in to import a Delivery plan." };
  const project = deps.project;
  if (!project) return { ok: false, status: 404, error: "Project not found." };
  if (project.level !== "details") return { ok: false, status: 403, error: "The Delivery plan is for the people working on this project." };
  if (finished(project.status)) return { ok: false, status: 403, error: "This project is finished, so its Delivery plan is read-only. Nothing was imported." };

  const read = await deps.loadPlan(project.id);
  if (read.state === "not_installed") return { ok: false, status: 503, error: "The Delivery plan is not installed in this environment yet. Nothing was imported." };
  if (read.state === "denied") return { ok: false, status: 403, error: "You cannot open this project's Delivery plan." };
  if (read.state === "error") return { ok: false, status: 503, error: "Could not load the Delivery plan. Nothing was imported; try again." };
  const plan = read.plan;
  if (!plan.can_manage && plan.my_sections.length === 0) {
    return { ok: false, status: 403, error: "Only the Project Manager, or a person a section was delegated to, can import into the Delivery plan." };
  }

  const parsed = await parseDeliveryPlanWorkbook(req.bytes, req.fileName);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const file = parsed.file;
  if (file.items.length + file.lines.length === 0) return { ok: false, status: 400, error: "The workbook has no rows to import (example rows are ignored)." };

  let people: Named[];
  try { people = await deps.loadPeople(); } catch { return { ok: false, status: 503, error: "Could not load the project's members. Nothing was imported; try again." }; }
  // The stock list is only needed when a row names a stock item. A failed read is carried as null, and such rows then need attention.
  let inventory: Named[] | null = [];
  if (file.lines.some((l) => l.stockItem)) { try { inventory = await deps.loadInventoryItems(project.companyId); } catch { inventory = null; } }

  // A preview never takes answers: it shows what needs one. Confirm applies the answers the person gave.
  const result = planDeliveryImport({ workbook: file, plan, people, inventory, resolutions: req.mode === "confirm" ? req.resolutions ?? {} : {} });

  if (req.mode === "preview") {
    return {
      ok: true, mode: "preview", rev: plan.rev, summary: result.summary, warnings: result.warnings,
      rows: result.rows.filter((r) => r.status !== "unchanged" || r.choices.length > 0),
      fileRows: { deliverables: file.items.length, breakdown: file.lines.length, examplesSkipped: file.examplesSkipped },
    };
  }

  if (typeof req.rev !== "number" || !Number.isInteger(req.rev)) return { ok: false, status: 400, error: "Preview the workbook first. Nothing was imported." };
  if (req.rev !== plan.rev) return { ok: false, status: 409, code: "preview_stale", error: PREVIEW_STALE };
  if (result.summary.attention > 0) {
    const n = result.summary.attention;
    return { ok: false, status: 409, code: "needs_attention", error: `${n} row${n === 1 ? " needs" : "s need"} attention. Nothing was imported. Upload the workbook again and answer every row listed under Needs attention.` };
  }
  const { items, lines } = result.payload;
  if (items.length + lines.length === 0) return { ok: true, mode: "confirm", nothingToDo: true, counts: { added: 0, updated: 0, proposed: 0, unchanged: result.summary.unchanged } };

  const { data, error } = await deps.db.rpc("proj_dp_apply_import", { p_project_id: project.id, p_expected_rev: req.rev, p_items: items as unknown as Record<string, unknown>[], p_lines: lines as unknown as Record<string, unknown>[] });
  if (error) {
    if (/changed after this preview/i.test(error.message)) return { ok: false, status: 409, code: "preview_stale", error: PREVIEW_STALE };
    const denied = error.code === "42501" || /^Only the Project Manager/i.test(error.message);
    return { ok: false, status: denied ? 403 : 400, error: `Nothing was imported. ${friendlyProjectError(error.message)}` };
  }
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return { ok: true, mode: "confirm", nothingToDo: false, counts: { added: num(d.added), updated: num(d.updated), proposed: num(d.proposed), unchanged: num(d.unchanged) + result.summary.unchanged } };
}
