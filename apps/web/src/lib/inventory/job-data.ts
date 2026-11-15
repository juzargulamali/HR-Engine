import "server-only";
import { createClient } from "@/lib/supabase/server";
import { formatInZone, projectCheckView, type ProjectCheckView } from "@/lib/inventory/planning";
import { parseRunCover, runOption, type RunCoverRow, type RunOption } from "@/lib/inventory/runs";
import type { SendItem } from "@/lib/inventory/workspace";
import { isNotInstalled } from "@/lib/projects/errors";

/**
 * Small reads for the steps of one equipment job (Inventory Phase 1). Everything is read through the signed-in person's own session, so row level security decides
 * what comes back: a Project Manager, who cannot read stock, simply gets no bins and no dispatch lines, and the screens say "not recorded" rather than guess.
 */

const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Where to find what is reserved: the bin of each reserved unit, and the bins that hold good counted stock of each item at the working warehouse. */
export async function loadPickBins(items: readonly SendItem[], locationId: string | null): Promise<{ unitBins: Record<string, string>; itemBins: Record<string, string[]> }> {
  const db = await createClient();
  const unitIds = items.flatMap((i) => i.units.map((u) => u.unitId));
  const countedIds = items.filter((i) => !i.individual && i.countedToSend > 0).map((i) => i.itemId);
  const unitBin = new Map<string, string>();
  for (const part of chunk(unitIds, 100)) {
    const { data, error } = await db.from("inv_units").select("id, bin_id").in("id", part);
    if (error) throw new Error(error.message);
    for (const u of data ?? []) if (u.bin_id) unitBin.set(u.id, u.bin_id);
  }
  const itemBin = new Map<string, Set<string>>();
  if (locationId && countedIds.length > 0) {
    for (const part of chunk(countedIds, 100)) {
      const { data, error } = await db.from("inv_balances").select("item_id, bin_id").in("item_id", part).eq("holder_kind", "warehouse").eq("location_id", locationId).eq("condition", "good").gt("qty", 0);
      if (error) throw new Error(error.message);
      for (const b of data ?? []) if (b.bin_id) itemBin.set(b.item_id, (itemBin.get(b.item_id) ?? new Set<string>()).add(b.bin_id));
    }
  }
  const binIds = [...new Set([...unitBin.values(), ...[...itemBin.values()].flatMap((s) => [...s])])];
  const codes = new Map<string, string>();
  for (const part of chunk(binIds, 100)) {
    const { data, error } = await db.from("inv_bins").select("id, code").in("id", part);
    if (error) throw new Error(error.message);
    for (const b of data ?? []) codes.set(b.id, b.code);
  }
  const unitBins: Record<string, string> = {};
  for (const [u, b] of unitBin) { const c = codes.get(b); if (c) unitBins[u] = c; }
  const itemBins: Record<string, string[]> = {};
  for (const [i, set] of itemBin) { const list = [...set].map((b) => codes.get(b)).filter((c): c is string => !!c).sort(); if (list.length > 0) itemBins[i] = list; }
  return { unitBins, itemBins };
}

/** The dispatches recorded against one request, oldest first: which dispatch each unit left on, and one line of words per dispatch. */
export async function loadDispatchesOf(requestId: string, zone: string): Promise<{ sentIn: Record<string, string>; dispatches: string[] }> {
  const db = await createClient();
  const { data: moves, error } = await db.from("inv_movements").select("id, code, occurred_at").eq("request_id", requestId).eq("kind", "dispatch_project").order("occurred_at").limit(200);
  if (error) throw new Error(error.message);
  const list = moves ?? [];
  if (list.length === 0) return { sentIn: {}, dispatches: [] };
  const label = new Map(list.map((m) => [m.id, `${m.code}, ${formatInZone(m.occurred_at, zone)}`]));
  const sentIn: Record<string, string> = {};
  const things = new Map<string, number>();
  for (const part of chunk(list.map((m) => m.id), 50)) {
    const { data: lines, error: le } = await db.from("inv_movement_lines").select("movement_id, unit_id, qty").in("movement_id", part).limit(5000);
    if (le) throw new Error(le.message);
    for (const l of lines ?? []) {
      if (l.unit_id) sentIn[l.unit_id] = label.get(l.movement_id) ?? "";
      things.set(l.movement_id, (things.get(l.movement_id) ?? 0) + (l.unit_id ? 1 : Number(l.qty)));
    }
  }
  return { sentIn, dispatches: list.map((m) => `${label.get(m.id)}${things.has(m.id) ? ` (${things.get(m.id)} sent)` : ""}`) };
}

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> };

/** A read that can be absent (the Phase 1 SQL is not applied here), refused for this person, or failed: the three are never confused with "nothing". */
export type Read<T> = { state: "ok"; value: T } | { state: "not_installed" } | { state: "none" } | { state: "error" };

async function call<T>(fn: string, args: Record<string, unknown>, shape: (data: unknown) => T | null): Promise<Read<T>> {
  try {
    const db = (await createClient()) as unknown as Rpc;
    const { data, error } = await db.rpc(fn, args);
    if (error) {
      if (isNotInstalled(error)) return { state: "not_installed" };
      // "not found" or "not allowed" is the database's answer for someone this is not for: nothing is shown, and no data leaks through an error.
      if (error.code === "P0002" || error.code === "42501") return { state: "none" };
      console.error(`[inventory] ${fn} failed`, error.message);
      return { state: "error" };
    }
    const value = shape(data);
    return value === null ? { state: "error" } : { state: "ok", value };
  } catch (e) {
    console.error(`[inventory] ${fn} failed`, e instanceof Error ? e.message : e);
    return { state: "error" };
  }
}
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The availability check recorded on the enquiry a project came from, with what changed since (inv_project_sales_check). */
export const loadProjectCheck = (projectId: string): Promise<Read<ProjectCheckView>> => call("inv_project_sales_check", { p_project_id: projectId }, projectCheckView);

/** Run-specific equipment status of one project (inv_project_run_cover). */
export const loadRunCover = (projectId: string): Promise<Read<RunCoverRow[]>> => call("inv_project_run_cover", { p_project_id: projectId }, (d) => parseRunCover(record(d).rows));

export interface CompanyRunCover { projectId: string; reference: string; name: string; rows: RunCoverRow[] }
/** The same for every live project of a company, for the Operations Overview (inv_company_run_cover). */
export const loadCompanyRunCover = (companyId: string): Promise<Read<CompanyRunCover[]>> => call("inv_company_run_cover", { p_company_id: companyId }, (d) => {
  const projects = record(d).projects;
  if (!Array.isArray(projects)) return null;
  return projects.map(record).map((p) => ({ projectId: String(p.project_id ?? ""), reference: String(p.reference ?? ""), name: String(p.name ?? ""), rows: parseRunCover(p.rows) }));
});

/**
 * The project's site runs as the request form offers them, in date order. Read from the Site schedule's own table through the person's own access: someone who
 * cannot read the project's plan gets none, and the form then offers the runs the request is already linked to (named by the run cover read).
 */
export async function loadSiteRunOptions(projectId: string, zone: string, cover: readonly RunCoverRow[] = []): Promise<RunOption[]> {
  const db = await createClient();
  type RunRow = { id: string; title: string; activity_kind?: string | null; run_label?: string | null; location?: string | null; start_date: string | null; end_date: string | null; starts_at: string | null; ends_at: string | null };
  const { data, error } = await db.from("proj_plan_items").select("*").eq("project_id", projectId).eq("plan", "site").neq("status", "cancelled").limit(200);
  const out: RunOption[] = error ? [] : ((data ?? []) as unknown as RunRow[]).map((a) => runOption({ id: a.id, title: a.title, kind: a.activity_kind, run_label: a.run_label, location: a.location, start_date: a.start_date, end_date: a.end_date, starts_at: a.starts_at, ends_at: a.ends_at }, zone));
  for (const r of cover) if (!out.some((o) => o.id === r.runId)) out.push(runOption({ id: r.runId, title: r.runTitle, kind: r.runKind, run_label: r.runLabel, starts_at: r.runStart, ends_at: r.runEnd }, zone));
  return out.sort((a, b) => (a.startDay ?? "9999").localeCompare(b.startDay ?? "9999") || a.title.localeCompare(b.title));
}
