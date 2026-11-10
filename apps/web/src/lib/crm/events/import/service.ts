import { friendlyCrmError } from "../../errors";
import { parseEventsFile, type RejectedRow } from "./parse";

/**
 * The calendar import, one flow for the route and the tests: parse the file, let the DATABASE classify every row (crm_import_events with p_apply = false writes nothing),
 * and on confirm let the same function write the whole batch in one transaction. The database repeats the permission check, the validation and the duplicate rules, so a
 * hand-made request cannot get past them; this layer reads the file and words the result.
 */
type Rpc = { rpc(fn: "crm_import_events", args: { p_rows: unknown; p_apply?: boolean; p_expect?: number | null }): PromiseLike<{ data: unknown; error: { message: string } | null }> };

export interface ImportDeps {
  db: Rpc;
  /** null = signed out. */
  ctx: { grants: readonly unknown[]; loadFailed?: boolean } | null;
}
export interface ImportRequest { fileName: string; bytes: Uint8Array; mode: "preview" | "confirm"; expect?: number | null }

export type RowStatus = "new_event" | "new_edition" | "present" | "conflict" | "ambiguous" | "review" | "invalid";
export interface PreviewRow {
  row: number; status: RowStatus; reason: string | null; note: string | null; event: string;
  start: string; end: string; country: string; city: string; venue: string; eventIsNew: boolean;
}
export interface Summary { fileRows: number; newEvents: number; newEditions: number; present: number; needsCorrection: number }

export type ImportResponse =
  | { ok: false; status: 400 | 401 | 403 | 409 | 503; error: string; code?: "preview_stale" | "needs_correction" }
  | { ok: true; mode: "preview"; summary: Summary; rows: PreviewRow[]; ignoredColumns: string[]; canConfirm: boolean }
  | { ok: true; mode: "confirm"; summary: Summary; added: { events: number; editions: number }; skipped: number; rows: PreviewRow[] };

interface DbRow { row: number; status: RowStatus; reason: string | null; note: string | null; event: string; eventIsNew: boolean; start: string; end: string; country: string; city: string | null; venue: string | null }
interface DbResult { applied: boolean; blocked: boolean; stale: boolean; createdEvents: number; createdEditions: number; summary: Record<string, number>; rows: DbRow[] }

const rejectedRow = (r: RejectedRow): PreviewRow => ({ row: r.row, status: "invalid", reason: r.reason, note: null, event: r.name, start: r.start, end: r.end, country: "", city: "", venue: "", eventIsNew: false });
const fromDb = (r: DbRow): PreviewRow => ({ ...r, city: r.city ?? "", venue: r.venue ?? "" });

export async function runEventsImport({ db, ctx }: ImportDeps, req: ImportRequest): Promise<ImportResponse> {
  if (!ctx) return { ok: false, status: 401, error: "Sign in to import events." };
  if (ctx.loadFailed) return { ok: false, status: 503, error: "Could not load your Sales access. Nothing was changed; try again." };
  if (ctx.grants.length === 0) return { ok: false, status: 403, error: "You do not have Sales access." };

  const parsed = await parseEventsFile(req.bytes, req.fileName);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { rows, rejected, ignoredColumns, sourceRows } = parsed.file;
  if (sourceRows === 0) return { ok: false, status: 400, error: "The file has a header but no event rows." };

  // Rows the file itself gets wrong are never sent: the person corrects them first, and a save is refused while any remain.
  if (req.mode === "confirm" && rejected.length > 0) {
    return { ok: false, status: 409, code: "needs_correction", error: `${rejected.length} row${rejected.length === 1 ? "" : "s"} need correcting (row ${rejected.slice(0, 5).map((r) => r.row).join(", ")}${rejected.length > 5 ? ", …" : ""}). Nothing was saved. Correct the file and preview again.` };
  }
  let result: DbResult | null = null;
  if (rows.length > 0) {
    const { data, error } = await db.rpc("crm_import_events", { p_rows: rows, p_apply: req.mode === "confirm", p_expect: req.mode === "confirm" ? (req.expect ?? null) : null });
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return { ok: false, status: 409, code: "preview_stale", error: "The calendar changed while the import ran. Nothing was added. Run a fresh preview." };
      return { ok: false, status: /Sales access|not allowed|permission/i.test(error.message) ? 403 : 400, error: friendlyCrmError(error.message) };
    }
    result = data as DbResult;
  }
  const merged = [...rejected.map(rejectedRow), ...(result?.rows ?? []).map(fromDb)].sort((a, b) => a.row - b.row);
  const count = (s: RowStatus) => merged.filter((r) => r.status === s).length;
  const summary: Summary = {
    fileRows: sourceRows, newEvents: result?.summary.newEvents ?? 0, newEditions: result?.summary.newEditions ?? 0, present: count("present"),
    needsCorrection: merged.filter((r) => r.status === "invalid" || r.status === "conflict" || r.status === "ambiguous" || r.status === "review").length,
  };
  if (req.mode === "preview") return { ok: true, mode: "preview", summary, rows: merged, ignoredColumns, canConfirm: summary.needsCorrection === 0 && summary.newEditions > 0 };

  if (!result) return { ok: false, status: 400, error: "There is nothing to import." };
  if (result.stale) return { ok: false, status: 409, code: "preview_stale", error: "The calendar changed since your preview, so what would be added is different. Nothing was saved. Run a fresh preview and check it." };
  if (result.blocked || !result.applied) return { ok: false, status: 409, code: "needs_correction", error: "Some rows now need correcting (the calendar changed since your preview). Nothing was saved. Run a fresh preview." };
  return { ok: true, mode: "confirm", summary, added: { events: result.createdEvents, editions: result.createdEditions }, skipped: summary.present, rows: merged };
}
