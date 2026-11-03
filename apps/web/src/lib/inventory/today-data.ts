import "server-only";
import type { InventoryContext } from "@/lib/inventory/context";
import { createClient } from "@/lib/supabase/server";
import { loadEmployeeNames, loadRequestModels, type RequestModel } from "@/lib/inventory/planning-data";
import type { PendingSalesCheck } from "@/lib/inventory/planning";
import { loadOpenDifferences } from "@/lib/inventory/project-notes-data";
import {
  differenceRows, heldRows, requestRows, returnRows, safeZone, salesCheckInScope, salesRows, settleSources, transferRows,
  type HeldEntry, type HeldUnitInput, type ProjectRequestLink, type QueueRow, type RequestInput, type SalesInput, type SourceKey, type TransferInput,
} from "@/lib/inventory/today";

/**
 * The loaders behind Today. Everything is read through the signed-in person's own session, so RLS decides what is visible. Each source
 * is loaded on its own: one that fails is named in `failed` (and logged) and the other sources still show. A failed source is never
 * turned into an empty list.
 */
type Db = Awaited<ReturnType<typeof createClient>>;

export interface TodayData {
  rows: QueueRow[];
  failed: SourceKey[];
  /** Plain-language limits worth saying out loud (a cap that was hit). */
  notes: string[];
  /** The moment the queue was read, so the page groups by the same "today". */
  nowIso: string;
}

/** How many live requests are read at most. More than this is said, not silently cut. */
export const MAX_LIVE_REQUESTS = 400;
const RETURN_HORIZON_DAYS = 9; // a little over 7 so a late-evening date in a zone ahead of UTC is never missed; the exact cut is by calendar day.

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

const n = (v: unknown): number => { const x = typeof v === "number" ? v : Number(v); return Number.isFinite(x) ? x : 0; };

export async function loadToday(ctx: InventoryContext, scope: { locationId: string | null }, now: Date = new Date()): Promise<TodayData> {
  const notes: string[] = [];
  const activeLocations = ctx.locations.filter((l) => l.is_active);
  const zoneOf = new Map(ctx.locations.map((l) => [l.id, safeZone(l.timezone)]));
  const here = scope.locationId ? activeLocations.find((l) => l.id === scope.locationId) ?? ctx.locations.find((l) => l.id === scope.locationId) : undefined;
  const fallbackZone = here ? safeZone(here.timezone) : safeZone(activeLocations[0]?.timezone);
  const zone = (id: string | null | undefined) => (id ? zoneOf.get(id) : undefined) ?? fallbackZone;
  const build = { now };

  const [requests, returns, transfers, sales, held, differences] = await Promise.allSettled([
    loadRequestRows(ctx, scope.locationId, build, notes),
    loadReturnRows(scope.locationId, build, zone, fallbackZone),
    loadTransferRows(ctx, scope.locationId, build, zone),
    loadSalesRows(scope.locationId, build, zone),
    loadHeldRows(ctx, scope.locationId, notes),
    loadDifferenceRows(scope.locationId, build),
  ]);
  for (const [name, r] of [["requests", requests], ["returns", returns], ["transfers", transfers], ["sales", sales], ["held", held], ["differences", differences]] as const) {
    if (r.status === "rejected") console.error(`[inventory] today: ${name} could not be loaded`, r.reason instanceof Error ? r.reason.message : r.reason);
  }
  const { rows, failed } = settleSources({ requests, returns, transfers, sales, held, differences });
  return { rows, failed, notes, nowIso: now.toISOString() };
}

/* ---------- differences reported on dispatch notes and return checklists ---------- */

/** Notes whose Project Manager reported a difference the warehouse has not answered yet (read through the person's own access; empty while notes are not installed or none exist). */
async function loadDifferenceRows(locationId: string | null, build: { now: Date }): Promise<QueueRow[]> {
  return differenceRows(await loadOpenDifferences(locationId), build);
}

/* ---------- requests (prepare / send) ---------- */

function toRequestInput(m: RequestModel): RequestInput {
  const r = m.request;
  return {
    id: r.id, code: r.code, kind: r.kind, forLabel: m.forLabel, timezone: r.timezone, plan: r.plan, neededFrom: r.needed_from,
    lines: m.lines.map((l) => ({
      status: l.status, reserved: l.progress.reserved, dispatched: l.progress.dispatched, toReserve: l.progress.toReserve,
      shortageAction: l.shortageAction, itemName: l.itemName, qty: l.qty, rentalReference: l.rentalReference,
    })),
  };
}

async function loadRequestRows(ctx: InventoryContext, locationId: string | null, build: { now: Date }, notes: string[]): Promise<QueueRow[]> {
  const db = await createClient();
  let q = db.from("inv_requests").select("id").in("status", ["submitted", "in_progress"]);
  // A request that names a pickup warehouse belongs to it; one that names none is for every warehouse. `locationId` is one of the person's own location ids.
  if (locationId) q = q.or(`pickup_location_id.eq.${locationId},pickup_location_id.is.null`);
  const { data, error } = await q.order("needed_from", { ascending: true, nullsFirst: false }).order("id").limit(MAX_LIVE_REQUESTS + 1);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length > MAX_LIVE_REQUESTS) notes.push(`Only the first ${MAX_LIVE_REQUESTS} live requests were checked (the earliest by date). Open Requests to see the rest.`);
  const models = (await Promise.all(chunk(ids.slice(0, MAX_LIVE_REQUESTS), 50).map((part) => loadRequestModels({ ids: part }, ctx.userId)))).flat();
  return requestRows(models.map(toRequestInput), build);
}

/* ---------- returns ---------- */

async function loadReturnRows(locationId: string | null, build: { now: Date }, zone: (id: string | null) => string, fallbackZone: string): Promise<QueueRow[]> {
  const db = await createClient();
  const horizon = new Date(build.now.getTime() + RETURN_HORIZON_DAYS * 86_400_000).toISOString();
  let uq = db.from("inv_units").select("id, custody_kind, employee_id, project_id, location_id, expected_return_at")
    .in("custody_kind", ["project", "employee"]).eq("lifecycle", "active").not("expected_return_at", "is", null).lte("expected_return_at", horizon);
  if (locationId) uq = uq.eq("location_id", locationId);
  // Counted stock that is out is held by a project or an employee with no location (the database does not split it by warehouse), so it can
  // only be listed when every warehouse is shown: attributing it to one warehouse would be a guess.
  const bq = locationId ? null : db.from("inv_balances").select("id, item_id, holder_kind, employee_id, project_id, expected_return_at")
    .in("holder_kind", ["project", "employee"]).gt("qty", 0).not("expected_return_at", "is", null).lte("expected_return_at", horizon);
  const [units, balances] = await Promise.all([
    selectAll((a, b) => uq.order("id").range(a, b)),
    bq ? selectAll((a, b) => bq.order("id").range(a, b)) : Promise.resolve([]),
  ]);

  const entries: HeldEntry[] = [];
  for (const u of units) {
    const holderId = u.custody_kind === "project" ? u.project_id : u.employee_id;
    if (!holderId || (u.custody_kind !== "project" && u.custody_kind !== "employee")) continue;
    entries.push({ holderKind: u.custody_kind, holderId, dueAt: u.expected_return_at, zone: zone(u.location_id), key: `unit:${u.id}` });
  }
  for (const b of balances) {
    const holderId = b.holder_kind === "project" ? b.project_id : b.employee_id;
    if (!holderId || (b.holder_kind !== "project" && b.holder_kind !== "employee")) continue;
    entries.push({ holderKind: b.holder_kind, holderId, dueAt: b.expected_return_at, zone: fallbackZone, key: `item:${b.item_id}` });
  }
  if (entries.length === 0) return [];

  const projectIds = [...new Set(entries.filter((e) => e.holderKind === "project").map((e) => e.holderId))];
  const employeeIds = [...new Set(entries.filter((e) => e.holderKind === "employee").map((e) => e.holderId))];
  // Names and the request link only make a row friendlier: if they cannot be read, the row still shows (with a general name and the Stock panel link).
  const [project, employee, links] = await Promise.all([
    projectNames(db, projectIds).catch(() => new Map<string, string>()),
    loadEmployeeNames(db, employeeIds).catch(() => new Map<string, string>()),
    projectRequestLinks(db, projectIds).catch((e) => { console.error("[inventory] today: request links for returns could not be read", e instanceof Error ? e.message : e); return new Map<string, ProjectRequestLink>(); }),
  ]);
  return returnRows(entries, { project, employee }, links, build);
}

async function projectNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const part of chunk(ids, 100)) {
    const { data } = await db.from("proj_projects").select("id, name").in("id", part);
    for (const p of data ?? []) m.set(p.id, p.name);
  }
  return m;
}

/** For each project: the request that still has equipment out (an active reservation sent but not fully returned), the earliest reservation first. */
async function projectRequestLinks(db: Db, projectIds: string[]): Promise<Map<string, ProjectRequestLink>> {
  const out = new Map<string, ProjectRequestLink>();
  if (projectIds.length === 0) return out;
  const requests: { id: string; code: string; project_id: string }[] = [];
  for (const part of chunk(projectIds, 100)) {
    const { data, error } = await db.from("inv_requests").select("id, code, project_id").in("project_id", part);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (r.project_id) requests.push({ id: r.id, code: r.code, project_id: r.project_id });
  }
  if (requests.length === 0) return out;
  const requestOf = new Map(requests.map((r) => [r.id, r]));
  const lines = (await Promise.all(chunk(requests.map((r) => r.id), 100).map((ids) => selectAll<{ id: string; request_id: string }>((a, b) => db.from("inv_request_lines").select("id, request_id").in("request_id", ids).order("id").range(a, b))))).flat();
  const lineRequest = new Map(lines.map((l) => [l.id, l.request_id]));
  const reservations = (await Promise.all(chunk(lines.map((l) => l.id), 100).map((ids) => selectAll<{ request_line_id: string; dispatched_qty: number | string; returned_qty: number | string; made_at: string }>((a, b) =>
    db.from("inv_reservations").select("request_line_id, dispatched_qty, returned_qty, made_at").in("request_line_id", ids).eq("status", "active").order("made_at").order("id").range(a, b))))).flat();
  for (const r of reservations.filter((x) => n(x.dispatched_qty) > n(x.returned_qty)).sort((a, b) => a.made_at.localeCompare(b.made_at))) {
    const req = requestOf.get(lineRequest.get(r.request_line_id) ?? "");
    if (req && !out.has(req.project_id)) out.set(req.project_id, { requestId: req.id, code: req.code });
  }
  return out;
}

/* ---------- transfers ---------- */

async function loadTransferRows(ctx: InventoryContext, locationId: string | null, build: { now: Date }, zone: (id: string | null) => string): Promise<QueueRow[]> {
  const db = await createClient();
  const toIds = locationId ? [locationId] : ctx.locations.filter((l) => l.is_active).map((l) => l.id);
  if (toIds.length === 0) return [];
  const { data, error } = await db.from("inv_transfers").select("id, code, from_location_id, to_location_id, expected_at")
    .eq("status", "in_transit").in("to_location_id", toIds).order("expected_at", { ascending: true, nullsFirst: false }).order("id").limit(200);
  if (error) throw new Error(error.message);
  const transfers = data ?? [];
  if (transfers.length === 0) return [];

  // How many things are on each: a count of units plus counted lines, never a sum of quantities. If this cannot be read the row still shows without a count.
  const counts = new Map<string, Set<string>>();
  try {
    const ids = transfers.map((t) => t.id);
    const [units, balances] = await Promise.all([
      db.from("inv_units").select("id, transfer_id").in("transfer_id", ids).eq("custody_kind", "transit"),
      db.from("inv_balances").select("item_id, transfer_id").in("transfer_id", ids).eq("holder_kind", "transit").gt("qty", 0),
    ]);
    if (units.error || balances.error) throw new Error((units.error ?? balances.error)!.message);
    const add = (t: string | null, key: string) => { if (t) counts.set(t, (counts.get(t) ?? new Set<string>()).add(key)); };
    for (const u of units.data ?? []) add(u.transfer_id, `unit:${u.id}`);
    for (const b of balances.data ?? []) add(b.transfer_id, `item:${b.item_id}`);
  } catch (e) {
    console.error("[inventory] today: transfer contents could not be read", e instanceof Error ? e.message : e);
    counts.clear();
    for (const t of transfers) counts.set(t.id, new Set(["?"]));
  }
  const unknown = (t: string) => counts.get(t)?.has("?") ?? false;
  const inputs: TransferInput[] = transfers.map((t) => ({
    id: t.id, code: t.code, fromName: ctx.locationName(t.from_location_id), toName: ctx.locationName(t.to_location_id), expectedAt: t.expected_at,
    zone: zone(t.to_location_id), items: unknown(t.id) ? null : (counts.get(t.id)?.size ?? 0),
  }));
  return transferRows(inputs, build, { here: locationId !== null });
}

/* ---------- Sales checks ---------- */

async function loadSalesRows(locationId: string | null, build: { now: Date }, zone: (id: string | null) => string): Promise<QueueRow[]> {
  const db = await createClient();
  const { data, error } = await db.rpc("inv_pending_sales_checks");
  if (error) {
    // The function is new or the person may not answer checks: nothing to show, which is not a failure (the Sales checks list says the same).
    if (/does not exist|not found|42883|42501|PGRST202/i.test(`${error.code ?? ""} ${error.message}`)) return [];
    throw new Error(error.message);
  }
  const checks = (Array.isArray(data) ? data : []) as PendingSalesCheck[];
  // Only what the Sales checks list shows is copied out: never the enquiry's title, client, value or notes.
  const inputs: SalesInput[] = checks.filter((c) => salesCheckInScope(c, locationId)).map((c) => ({
    checkId: c.check_id, opportunityId: c.opportunity_id, companyId: c.company_id, reference: c.reference, requestedAt: c.requested_at,
    locationId: c.location_id, locationName: c.location_name, installStart: c.install_start, eventStart: c.event_start, eventEnd: c.event_end,
    technologies: (c.technologies ?? []).map((t) => ({ name: t.name, qty: t.qty })), zone: zone(c.location_id ?? locationId),
  }));
  return salesRows(inputs, build);
}

/* ---------- units held for checking ---------- */

/** How many held units are listed at most. More than this is said, not silently cut. */
export const MAX_HELD_UNITS = 100;

async function loadHeldRows(ctx: InventoryContext, locationId: string | null, notes: string[]): Promise<QueueRow[]> {
  const db = await createClient();
  let q = db.from("inv_units").select("id, code, item_id, condition, location_id")
    .eq("custody_kind", "warehouse").eq("lifecycle", "active").in("condition", ["needs_inspection", "damaged"]);
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q.order("code").order("id").limit(MAX_HELD_UNITS + 1);
  if (error) throw new Error(error.message);
  const all = data ?? [];
  if (all.length > MAX_HELD_UNITS) notes.push(`Only the first ${MAX_HELD_UNITS} held units are listed. Open Stock to see the rest.`);
  const units = all.slice(0, MAX_HELD_UNITS);
  if (units.length === 0) return [];

  // Names make a row friendlier: if they cannot be read the row still shows. Which request still holds a reservation on the unit is read separately and
  // said as unknown when it fails, never as "none".
  const itemIds = [...new Set(units.map((u) => u.item_id))];
  const names = new Map<string, string>();
  for (const part of chunk(itemIds, 100)) {
    const { data: items } = await db.from("inv_items").select("id, name").in("id", part);
    for (const i of items ?? []) names.set(i.id, i.name);
  }
  let reservedBy: Map<string, { requestId: string; code: string }[]> | null = new Map();
  try {
    reservedBy = await liveReservationsOf(db, units.map((u) => u.id));
  } catch (e) {
    console.error("[inventory] today: reservations on held units could not be read", e instanceof Error ? e.message : e);
    reservedBy = null;
  }
  const inputs: HeldUnitInput[] = units.map((u) => ({
    id: u.id, code: u.code, itemName: names.get(u.item_id) ?? "Equipment", condition: u.condition,
    locationName: u.location_id ? ctx.locationName(u.location_id) : null, reservedFor: reservedBy === null ? null : (reservedBy.get(u.id) ?? []),
  }));
  return heldRows(inputs);
}

/** For each unit: the live requests (submitted or in progress) that still hold an active reservation on it. */
async function liveReservationsOf(db: Db, unitIds: string[]): Promise<Map<string, { requestId: string; code: string }[]>> {
  const out = new Map<string, { requestId: string; code: string }[]>();
  const res: { request_line_id: string; unit_id: string }[] = [];
  for (const part of chunk(unitIds, 100)) {
    const { data, error } = await db.from("inv_reservations").select("request_line_id, unit_id").in("unit_id", part).eq("status", "active");
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (r.unit_id) res.push({ request_line_id: r.request_line_id, unit_id: r.unit_id });
  }
  if (res.length === 0) return out;
  const lines = new Map<string, string>();
  for (const part of chunk([...new Set(res.map((r) => r.request_line_id))], 100)) {
    const { data, error } = await db.from("inv_request_lines").select("id, request_id").in("id", part);
    if (error) throw new Error(error.message);
    for (const l of data ?? []) lines.set(l.id, l.request_id);
  }
  const requests = new Map<string, { id: string; code: string }>();
  for (const part of chunk([...new Set(lines.values())], 100)) {
    const { data, error } = await db.from("inv_requests").select("id, code, status").in("id", part).in("status", ["submitted", "in_progress"]);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) requests.set(r.id, { id: r.id, code: r.code });
  }
  for (const r of res) {
    const req = requests.get(lines.get(r.request_line_id) ?? "");
    if (!req) continue;
    const list = out.get(r.unit_id) ?? [];
    if (!list.some((x) => x.requestId === req.id)) list.push({ requestId: req.id, code: req.code });
    out.set(r.unit_id, list);
  }
  return out;
}
