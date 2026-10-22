import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import type { InvLocationRow, InvRequestLineRow, InvRequestRow, InvTechnologyComponentRow, InvTechnologyRow } from "@/types/inventory";
import {
  asArray, asRecord, lineProgress, num, str, summariseRequest, parseRange, substitutionInfo,
  type LineProgress, type ReservationLite, type RequestListRow, type SubstitutionInfo,
} from "./planning";

/** Reads for the planning pages. Everything is read through the signed-in person's own session, so what comes back is what RLS lets them see. */
type Db = Awaited<ReturnType<typeof createClient>>;

const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** The data service answers at most 1000 rows at a time: read every page so a long list is never silently cut short. */
async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

export const MAX_REQUESTS = 500;

export interface RequestList { rows: RequestListRow[]; limited: boolean; total: number }

async function namesOf(db: Db, table: "profiles", ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  for (const part of chunk(ids, 100)) {
    const { data } = await db.from(table).select("id, full_name").in("id", part);
    for (const p of data ?? []) map.set(p.id, p.full_name?.trim() || "Unnamed");
  }
  return map;
}

/** Names of employees the person may read (HR, the line manager, the person themselves). Anyone else is simply not named. */
export async function loadEmployeeNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (const part of chunk(unique, 100)) {
    const { data } = await db.from("employees").select("id, first_name, last_name, employee_number").in("id", part);
    for (const e of data ?? []) map.set(e.id, `${e.first_name} ${e.last_name}`.trim());
  }
  return map;
}

export async function loadRequestList(userId: string): Promise<RequestList> {
  const db = await createClient();
  const { data: reqs, error } = await db.from("inv_requests").select("*").order("created_at", { ascending: false }).limit(MAX_REQUESTS + 1);
  if (error) throw new Error(error.message);
  const limited = (reqs ?? []).length > MAX_REQUESTS;
  const requests = (reqs ?? []).slice(0, MAX_REQUESTS) as InvRequestRow[];
  if (requests.length === 0) return { rows: [], limited: false, total: 0 };

  const lineChunks = await Promise.all(chunk(requests.map((r) => r.id), 100).map((ids) => selectAll<Pick<InvRequestLineRow, "id" | "request_id" | "qty" | "status">>((a, b) => db.from("inv_request_lines").select("id, request_id, qty, status").in("request_id", ids).range(a, b))));
  const lines = lineChunks.flat();
  const live = new Set(requests.filter((r) => r.status === "submitted" || r.status === "in_progress").map((r) => r.id));
  const liveLineIds = lines.filter((l) => live.has(l.request_id) && l.status === "open").map((l) => l.id);
  const resChunks = await Promise.all(chunk(liveLineIds, 100).map((ids) => selectAll<ReservationLite & { reserved_during: string }>((a, b) =>
    db.from("inv_reservations").select("id, request_line_id, unit_id, qty, dispatched_qty, returned_qty, status, reserved_during").in("request_line_id", ids).in("status", ["active", "completed"]).range(a, b) as never)));
  const reservations = resChunks.flat();

  const projectIds = [...new Set(requests.map((r) => r.project_id).filter((x): x is string => !!x))];
  const employeeIds = requests.map((r) => r.employee_id).filter((x): x is string => !!x);
  const [projects, employees, people] = await Promise.all([
    (async () => {
      const m = new Map<string, string>();
      for (const part of chunk(projectIds, 100)) {
        const { data } = await db.from("proj_projects").select("id, name").in("id", part);
        for (const p of data ?? []) m.set(p.id, p.name);
      }
      return m;
    })(),
    loadEmployeeNames(db, employeeIds),
    namesOf(db, "profiles", [...new Set(requests.map((r) => r.requested_by))]),
  ]);

  const linesBy = new Map<string, typeof lines>();
  for (const l of lines) linesBy.set(l.request_id, [...(linesBy.get(l.request_id) ?? []), l]);
  const resByLine = new Map<string, ReservationLite[]>();
  for (const r of reservations) resByLine.set(r.request_line_id, [...(resByLine.get(r.request_line_id) ?? []), r]);

  const rows = requests.map((r): RequestListRow => {
    const own = linesBy.get(r.id) ?? [];
    const sum = summariseRequest(r, own, own.flatMap((l) => resByLine.get(l.id) ?? []));
    return {
      id: r.id, code: r.code, kind: r.kind, title: r.title, status: r.status, projectId: r.project_id, employeeId: r.employee_id,
      forLabel: r.kind === "project" ? (projects.get(r.project_id ?? "") ?? "A project you cannot see") : (employees.get(r.employee_id ?? "") ?? r.title ?? "An employee"),
      destination: r.destination, timezone: r.timezone, needed_from: r.needed_from, needed_until: r.needed_until, pickup_location_id: r.pickup_location_id,
      requestedByName: r.requested_by === userId ? "You" : (people.get(r.requested_by) ?? "—"), done: sum.done, total: sum.total, shortageLines: sum.shortageLines, created_at: r.created_at,
    };
  });
  return { rows, limited, total: requests.length };
}

// ---------------------------------------------------------------------------------------------------------------
// One request, with everything the editor shows
// ---------------------------------------------------------------------------------------------------------------
export interface ItemInfo { name: string; model: string | null; tracking: string; unit: string; scale: number }
export interface SubstituteOption { itemId: string; name: string; qty: number | null }
export interface LineModel {
  id: string; itemId: string; itemName: string; itemModel: string | null; tracking: string; unit: string; scale: number;
  qty: number; note: string | null; status: "open" | "cancelled" | "closed"; version: number | undefined;
  technologyName: string | null; altGroup: string | null; isOptional: boolean;
  originalItemId: string | null; originalItemName: string | null; substitution: SubstitutionInfo; substitutionNote: string | null;
  substituteOptions: SubstituteOption[];
  shortageAction: string; shortageNote: string | null; rentalReference: string | null;
  progress: LineProgress; reservations: ReservationLite[];
}
export interface RequestModel {
  request: InvRequestRow;
  forLabel: string;
  requestedByName: string;
  lines: LineModel[];
  /** Equipment already dispatched and not yet back, over every non-cancelled line. */
  outstanding: number;
}
export interface TechnologyOption { id: string; name: string; version: number; components: Pick<InvTechnologyComponentRow, "id" | "item_id" | "qty" | "alt_group" | "is_optional" | "sort_order">[]; itemNames: Record<string, string> }

export async function loadVisibleLocations(): Promise<InvLocationRow[]> {
  const db = await createClient();
  const { data, error } = await db.from("inv_locations").select("*").eq("is_active", true).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as InvLocationRow[];
}

export async function loadTechnologies(companyId: string): Promise<TechnologyOption[]> {
  const db = await createClient();
  const { data: techs, error } = await db.from("inv_technologies").select("*").eq("company_id", companyId).eq("status", "complete").order("name");
  if (error) throw new Error(error.message);
  const list = (techs ?? []) as InvTechnologyRow[];
  if (list.length === 0) return [];
  const { data: comps, error: ce } = await db.from("inv_technology_components").select("id, technology_id, item_id, qty, alt_group, is_optional, sort_order").in("technology_id", list.map((t) => t.id));
  if (ce) throw new Error(ce.message);
  const itemIds = [...new Set((comps ?? []).map((c) => c.item_id))];
  const names: Record<string, string> = {};
  for (const part of chunk(itemIds, 100)) {
    const { data } = await db.from("inv_items").select("id, name").in("id", part);
    for (const i of data ?? []) names[i.id] = i.name;
  }
  return list.map((t) => ({
    id: t.id, name: t.name, version: t.version,
    components: (comps ?? []).filter((c) => c.technology_id === t.id).map(({ id, item_id, qty, alt_group, is_optional, sort_order }) => ({ id, item_id, qty, alt_group, is_optional, sort_order })),
    itemNames: Object.fromEntries((comps ?? []).filter((c) => c.technology_id === t.id).map((c) => [c.item_id, names[c.item_id] ?? "Item"])),
  }));
}

/**
 * Builds the editor's model for the requests with these ids. `unitInfo` can supply unit codes and serial numbers the person's own
 * reads cannot show (the project page gets them from inv_project_equipment); `progressOverride` takes the database's own progress
 * numbers where the page already has them.
 */
export async function loadRequestModels(
  where: { ids: string[] } | { projectId: string },
  userId: string,
  extra: { unitInfo?: Map<string, { code: string | null; serial: string | null }> } = {},
): Promise<RequestModel[]> {
  const db = await createClient();
  const q = db.from("inv_requests").select("*");
  const { data: reqRows, error } = "ids" in where ? await q.in("id", where.ids) : await q.eq("project_id", where.projectId).order("created_at");
  if (error) throw new Error(error.message);
  const requests = (reqRows ?? []) as InvRequestRow[];
  if (requests.length === 0) return [];
  const lineRows = (await selectAll<InvRequestLineRow>((a, b) => db.from("inv_request_lines").select("*").in("request_id", requests.map((r) => r.id)).order("sort_order").range(a, b))) as InvRequestLineRow[];
  const resRows = lineRows.length === 0 ? [] : (await Promise.all(chunk(lineRows.map((l) => l.id), 100).map((ids) => selectAll<ReservationLite & { reserved_during: string }>((a, b) =>
    db.from("inv_reservations").select("id, request_line_id, unit_id, location_id, qty, dispatched_qty, returned_qty, status, reserved_during, released_reason").in("request_line_id", ids).order("made_at").range(a, b) as never)))).flat();

  const itemIds = new Set<string>();
  for (const l of lineRows) {
    itemIds.add(l.item_id);
    if (l.original_item_id) itemIds.add(l.original_item_id);
    const std = str(asRecord(l.technology_snapshot).standard_item_id);
    if (std) itemIds.add(std);
  }
  const items = new Map<string, ItemInfo>();
  for (const part of chunk([...itemIds], 100)) {
    const { data } = await db.from("inv_items").select("id, name, model, tracking, unit_of_measure, quantity_scale").in("id", part);
    for (const i of data ?? []) items.set(i.id, { name: i.name, model: i.model, tracking: i.tracking, unit: i.unit_of_measure, scale: i.quantity_scale });
  }
  // Unit codes: warehouse people and stock readers can read them; for everyone else the numbers still show, without a code.
  const unitIds = [...new Set(resRows.map((r) => r.unit_id).filter((x): x is string => !!x))];
  const units = new Map<string, { code: string | null; serial: string | null }>(extra.unitInfo ?? []);
  for (const part of chunk(unitIds.filter((u) => !units.has(u)), 100)) {
    const { data } = await db.from("inv_units").select("id, code, serial_number").in("id", part);
    for (const u of data ?? []) units.set(u.id, { code: u.code, serial: u.serial_number });
  }
  const projectIds = [...new Set(requests.map((r) => r.project_id).filter((x): x is string => !!x))];
  const projects = new Map<string, string>();
  for (const part of chunk(projectIds, 100)) {
    const { data } = await db.from("proj_projects").select("id, name").in("id", part);
    for (const p of data ?? []) projects.set(p.id, p.name);
  }
  const [employees, people] = await Promise.all([
    loadEmployeeNames(db, requests.map((r) => r.employee_id).filter((x): x is string => !!x)),
    namesOf(db, "profiles", [...new Set(requests.map((r) => r.requested_by))]),
  ]);

  return requests.map((request) => {
    const own = lineRows.filter((l) => l.request_id === request.id);
    const lines = own.map((l): LineModel => {
      const info = items.get(l.item_id);
      const orig = l.original_item_id ? items.get(l.original_item_id) : undefined;
      const snap = asRecord(l.technology_snapshot);
      const stdId = str(snap.standard_item_id);
      const options: SubstituteOption[] = [];
      if (l.alt_group && l.technology_id) {
        if (stdId && stdId !== l.item_id) options.push({ itemId: stdId, name: items.get(stdId)?.name ?? "Standard item", qty: null });
        for (const a of asArray(snap.alternatives)) {
          const x = asRecord(a);
          const id = str(x.item_id);
          if (id && id !== l.item_id) options.push({ itemId: id, name: str(x.item_name) ?? "Alternative", qty: num(x.qty) });
        }
      }
      const reservations = resRows.filter((r) => r.request_line_id === l.id).map((r): ReservationLite => {
        const range = parseRange(r.reserved_during);
        const unit = r.unit_id ? units.get(r.unit_id) : undefined;
        return { ...r, reserved_during: undefined, from: range.from, until: range.until, unit_code: unit?.code ?? null, serial_number: unit?.serial ?? null };
      });
      return {
        id: l.id, itemId: l.item_id, itemName: info?.name ?? "Item", itemModel: info?.model ?? null, tracking: info?.tracking ?? "quantity", unit: info?.unit ?? "each",
        scale: info?.scale ?? 0, qty: num(l.qty), note: l.note, status: l.status, version: l.version,
        technologyName: l.technology_id ? (str(snap.name) ?? "Technology") : null, altGroup: l.alt_group, isOptional: l.is_optional,
        originalItemId: l.original_item_id, originalItemName: orig?.name ?? null,
        substitution: substitutionInfo({ substitution_status: l.substitution_status, original_item_name: orig?.name ?? null, item_name: info?.name ?? null }),
        substitutionNote: l.substitution_note, substituteOptions: options,
        shortageAction: l.shortage_action, shortageNote: l.shortage_note, rentalReference: l.rental_reference,
        progress: lineProgress(l, request, reservations), reservations,
      };
    });
    return {
      request, lines,
      forLabel: request.kind === "project" ? (projects.get(request.project_id ?? "") ?? "A project") : (employees.get(request.employee_id ?? "") ?? request.title ?? "An employee"),
      requestedByName: request.requested_by === userId ? "You" : (people.get(request.requested_by) ?? "—"),
      outstanding: lines.reduce((s, l) => s + l.progress.outstanding, 0),
    };
  });
}

/**
 * May the person manage this project (the project manager, an acting project manager or a Projects founder)? Mirrors proj_can_manage
 * for what the page offers; the database makes the real decision. A failed lookup means "no": nothing extra is shown.
 */
export async function canManageProjectEquipment(projectId: string): Promise<boolean> {
  try {
    const ctx = await getProjectsContext();
    if (!ctx) return false;
    const view = await loadProjectView(ctx, projectId);
    return !!view && view.canManage;
  } catch {
    return false;
  }
}

/** Names of the complete technology templates the person may browse (for the Availability dialog's picker). */
export async function loadTechnologyNames(): Promise<{ id: string; name: string; companyId: string }[]> {
  const db = await createClient();
  const { data, error } = await db.from("inv_technologies").select("id, name, company_id").eq("status", "complete").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({ id: t.id, name: t.name, companyId: t.company_id }));
}

/** Live projects the person can see, with what the quick-add forms need (the company decides which locations apply). */
export async function loadLiveProjects(): Promise<{ id: string; name: string; reference: string; companyId: string; pmUserId: string }[]> {
  const db = await createClient();
  const { data, error } = await db.from("proj_projects").select("id, name, reference, company_id, pm_user_id, status").not("status", "in", "(completed,archived)").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, reference: p.reference, companyId: p.company_id, pmUserId: p.pm_user_id }));
}
