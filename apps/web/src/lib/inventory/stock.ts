import "server-only";
import { canOperateLocation, canSeeCosts, canViewStock, parseInventoryScan, canManageCatalogue, canConfirmStock } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { parseRecordId } from "@/components/workspace/url-state";
import type { InventoryContext } from "./context";
import {
  buildStockRows, categoryPath, num, type BalanceLite, type ReservationLite, type StockRow, type UnitLite,
} from "./stock-list";
import { candidateBase, candidateMatches, cleanSearch, whereText, type Candidate, type FormContext, type FormLocation, type FormRental, type FormRequest, type FormTransfer, type ScanResolution } from "./stock-candidates";
export type { ScanResolution, FormContext, FormLocation, FormProject, FormRental, FormRequest, FormTransfer } from "./stock-candidates";
import { sourceFor, type AdjustAction, type MovementKind } from "./stock-movements";
import type {
  InvBalanceRow, InvBinRow, InvCategoryRow, InvCustody, InvItemRow, InvKitContentRow, InvLocationRow, InvMovementKind, InvMovementRow, InvRentalRow, InvTracking, InvTransferRow, InvUnitRow,
} from "@/types/inventory";

/**
 * Server-side reading for the Inventory stock pages (list, item and unit panels, movements, movement forms). Everything is read through the
 * signed-in person's own session: row-level security decides what comes back (the catalogue for anyone with Inventory access, units,
 * balances and movements only for people who may view stock, costs only with view_costs). A failed read throws so the page can say
 * "could not load", never "nothing here". Nothing in this file writes.
 */

type Db = Awaited<ReturnType<typeof createClient>>;
type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>;

const PAGE = 1000;

/** PostgREST returns at most 1000 rows a call: read page after page (up to `max`) and say if there was more. */
export async function fetchAll<T>(page: (from: number, to: number) => PageResult<T>, max = 20000): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

/** A text value safe to put inside a PostgREST filter. */
const safe = (q: string) => cleanSearch(q);

// ---------------------------------------------------------------------------------------------------------------
// Names (employees, projects, people, requests): only what the person may see; a missing name is shown as a plain word, never guessed
// ---------------------------------------------------------------------------------------------------------------

export interface Names {
  employees: Map<string, string>;
  projects: Map<string, { reference: string; name: string; companyId: string }>;
  users: Map<string, string>;
  requests: Map<string, { code: string; title: string | null; kind: string }>;
  employee: (id: string | null | undefined) => string;
  project: (id: string | null | undefined) => string;
  user: (id: string | null | undefined) => string;
  request: (id: string | null | undefined) => string;
}

export async function loadNames(db: Db, ctx: InventoryContext, want: { employeeIds?: Iterable<string>; projectIds?: Iterable<string>; userIds?: Iterable<string>; requestIds?: Iterable<string>; companyIds?: Iterable<string> }): Promise<Names> {
  const emp = new Set([...(want.employeeIds ?? [])].filter(Boolean));
  const prj = new Set([...(want.projectIds ?? [])].filter(Boolean));
  const usr = new Set([...(want.userIds ?? [])].filter(Boolean));
  const req = new Set([...(want.requestIds ?? [])].filter(Boolean));
  const employees = new Map<string, string>();
  const projects = new Map<string, { reference: string; name: string; companyId: string }>();
  const users = new Map<string, string>();
  const requests = new Map<string, { code: string; title: string | null; kind: string }>();

  await Promise.all([
    (async () => {
      if (emp.size === 0) return;
      // The employee lookup the database offers to warehouse operators lists who holds what; a person who may not use it simply sees no names.
      const companyIds = [...new Set(want.companyIds ?? ctx.companies.map((c) => c.id))];
      await Promise.all(companyIds.map(async (companyId) => {
        const only = emp.size === 1 ? [...emp][0]! : null;
        const { data } = await db.rpc("inv_employee_outstanding", { p_company_id: companyId, p_employee_id: only, p_include_inactive: true });
        for (const r of data ?? []) if (emp.has(r.employee_id)) employees.set(r.employee_id, r.display_name);
      }));
      const missing = [...emp].filter((id) => !employees.has(id)).slice(0, 100);
      if (missing.length > 0) {
        const { data } = await db.from("employees").select("id, first_name, last_name").in("id", missing);
        for (const e of data ?? []) employees.set(e.id, `${e.first_name} ${e.last_name}`.trim());
      }
    })().catch(() => undefined),
    (async () => {
      if (prj.size === 0) return;
      const { data } = await db.from("proj_projects").select("id, company_id, reference, name").in("id", [...prj].slice(0, 200));
      for (const p of data ?? []) projects.set(p.id, { reference: p.reference, name: p.name, companyId: p.company_id });
    })().catch(() => undefined),
    (async () => {
      if (usr.size === 0) return;
      const { data } = await db.rpc("inv_staff_directory");
      for (const u of data ?? []) users.set(u.user_id, u.full_name || u.email || "A colleague");
    })().catch(() => undefined),
    (async () => {
      if (req.size === 0) return;
      const { data } = await db.from("inv_requests").select("id, code, title, kind").in("id", [...req].slice(0, 200));
      for (const r of data ?? []) requests.set(r.id, { code: r.code, title: r.title, kind: r.kind });
    })().catch(() => undefined),
  ]);
  return {
    employees, projects, users, requests,
    employee: (id) => (id ? (employees.get(id) ?? "An employee") : "—"),
    project: (id) => { const p = id ? projects.get(id) : null; return p ? `${p.reference} ${p.name}` : id ? "A project" : "—"; },
    user: (id) => (id ? (users.get(id) ?? "A colleague") : "—"),
    request: (id) => { const r = id ? requests.get(id) : null; return r ? r.code : id ? "A request" : "—"; },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------------------------

export interface StockList {
  rows: StockRow[];
  categories: InvCategoryRow[];
  /** Locations of the companies the rows belong to (for the Location filter). */
  locations: InvLocationRow[];
  companies: { id: string; name: string }[];
  detailCompanyIds: ReadonlySet<string>;
  costCompanyIds: ReadonlySet<string>;
  truncated: boolean;
}

export async function loadStockList(ctx: InventoryContext, opts: { locationId: string; withCosts: boolean }): Promise<StockList> {
  const db = await createClient();
  const [items, cats] = await Promise.all([
    fetchAll<InvItemRow>((a, b) => db.from("inv_items").select("*").order("name").range(a, b)),
    fetchAll<InvCategoryRow>((a, b) => db.from("inv_categories").select("*").order("sort_order").order("name").range(a, b)),
  ]);
  const companyIds = [...new Set(items.rows.map((i) => i.company_id))];
  const detail = new Set(companyIds.filter((id) => canViewStock(ctx.grants, id)));
  const costIds = new Set(companyIds.filter((id) => canSeeCosts(ctx.grants, id)));
  const detailIds = [...detail];
  const costList = [...costIds];

  const [units, balances, reservations, costs, locs, companyRows] = await Promise.all([
    detailIds.length === 0 ? { rows: [] as UnitLite[], truncated: false } : fetchAll<UnitLite>((a, b) => db.from("inv_units").select("item_id, code, serial_number, lifecycle, condition, custody_kind, location_id, in_kit_id, ownership").in("company_id", detailIds).order("code").range(a, b)),
    detailIds.length === 0 ? { rows: [] as BalanceLite[], truncated: false } : fetchAll<BalanceLite>((a, b) => db.from("inv_balances").select("item_id, holder_kind, location_id, condition, qty, label_code, rental_id").in("company_id", detailIds).gt("qty", 0).order("id").range(a, b)),
    detailIds.length === 0 ? { rows: [] as ReservationLite[], truncated: false } : fetchAll<ReservationLite>((a, b) => db.from("inv_reservations").select("item_id, unit_id, location_id, qty, dispatched_qty, reserved_during, status").in("company_id", detailIds).eq("status", "active").order("id").range(a, b)),
    opts.withCosts && costList.length > 0 ? fetchAll<{ item_id: string; unit_cost: number | string | null; currency: string | null; entered_at: string }>((a, b) => db.from("inv_costs").select("item_id, unit_cost, currency, entered_at").in("company_id", costList).not("unit_cost", "is", null).order("entered_at", { ascending: false }).range(a, b), 5000) : { rows: [], truncated: false },
    companyIds.length === 0 ? { rows: [] as InvLocationRow[], truncated: false } : fetchAll<InvLocationRow>((a, b) => db.from("inv_locations").select("*").in("company_id", companyIds).order("name").range(a, b), 1000),
    companyIds.length === 0 ? { data: [] as { id: string; legal_name: string }[] } : db.from("companies").select("id, legal_name").in("id", companyIds).order("legal_name"),
  ]);

  const costMap = new Map<string, { amount: number; currency: string }>();
  for (const c of costs.rows) if (!costMap.has(c.item_id) && c.unit_cost !== null && c.currency) costMap.set(c.item_id, { amount: num(c.unit_cost), currency: c.currency });

  const rows = buildStockRows({
    items: items.rows, categories: cats.rows, units: units.rows, balances: balances.rows, reservations: reservations.rows,
    detailCompanyIds: detail, locationId: opts.locationId, now: new Date(), costs: costMap,
  });
  const names = new Map((companyRows.data ?? []).map((c) => [c.id, c.legal_name]));
  return {
    rows, categories: cats.rows, locations: locs.rows,
    companies: companyIds.map((id) => ({ id, name: names.get(id) ?? ctx.companyName(id) })).sort((a, b) => a.name.localeCompare(b.name)),
    detailCompanyIds: detail, costCompanyIds: costIds,
    truncated: items.truncated || units.truncated || balances.truncated,
  };
}

/** For people who cannot view stock: the number usable now comes from the database's own availability function, location by location. */
export async function fillSummaryUsable(rows: readonly StockRow[], locations: readonly InvLocationRow[], locationId: string): Promise<StockRow[]> {
  const db = await createClient();
  const from = new Date();
  const until = new Date(from.getTime() + 24 * 3600 * 1000);
  const out = [...rows];
  const todo = out.map((r, i) => ({ r, i })).filter((x) => !x.r.detail && x.r.status === "active");
  const calls = todo.flatMap(({ r, i }) => locations.filter((l) => l.company_id === r.companyId && l.is_active && (locationId === "" || l.id === locationId)).map((l) => ({ i, itemId: r.id, locationId: l.id })));
  const totals = new Map<number, number>();
  for (let k = 0; k < calls.length; k += 12) {
    await Promise.all(calls.slice(k, k + 12).map(async (c) => {
      const { data, error } = await db.rpc("inv_availability", { p_item_id: c.itemId, p_location_id: c.locationId, p_from: from.toISOString(), p_until: until.toISOString() });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) return;
      totals.set(c.i, (totals.get(c.i) ?? 0) + num((data as Record<string, unknown>).usable_now as number));
    }));
  }
  for (const { i } of todo) out[i] = { ...out[i]!, usable: totals.get(i) ?? 0 };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// One item
// ---------------------------------------------------------------------------------------------------------------

export interface UnitView extends InvUnitRow {
  where: string;
  employeeName: string | null;
  projectName: string | null;
  binLabel: string | null;
  locationName: string | null;
  cost: { amount: number; currency: string } | null;
  /** Out (with an employee, on a project, in transit, at the repairer) and past its expected return. */
  overdue: boolean;
}
export interface BalanceView extends InvBalanceRow {
  locationName: string | null;
  binLabel: string | null;
  holderText: string;
}
export interface MovementBrief {
  id: string; code: string; kind: InvMovementRow["kind"]; occurred_at: string; performed_by: string; note: string | null; reason: string | null;
  project_id: string | null; employee_id: string | null; request_id: string | null; from_location_id: string | null; to_location_id: string | null; corrects_movement_id: string | null;
  lines: { id: string; item_id: string; unit_id: string | null; qty: number | string; from_kind: string; to_kind: string; from_location_id: string | null; to_location_id: string | null;
    from_bin_id: string | null; to_bin_id: string | null; from_employee_id: string | null; to_employee_id: string | null; from_project_id: string | null; to_project_id: string | null;
    from_balance_id: string | null; to_balance_id: string | null; condition_from: string | null; condition_to: string | null; exception_note: string | null; corrects_line_id: string | null }[];
}
const MOVEMENT_COLUMNS = "id, code, kind, occurred_at, performed_by, note, reason, project_id, employee_id, request_id, from_location_id, to_location_id, corrects_movement_id";
const LINE_COLUMNS = "id, item_id, unit_id, qty, from_kind, to_kind, from_location_id, to_location_id, from_bin_id, to_bin_id, from_employee_id, to_employee_id, from_project_id, to_project_id, from_balance_id, to_balance_id, condition_from, condition_to, exception_note, corrects_line_id";

export interface KitView extends InvKitContentRow { itemName: string; itemTracking: InvTracking; itemUom: string; itemScale: number; substituteName: string | null; contentCode: string | null }

export interface ItemDetail {
  item: InvItemRow;
  categoryName: string | null;
  companyName: string;
  detail: boolean;
  canEdit: boolean;
  canSeeCosts: boolean;
  canConfirm: boolean;
  counts: StockRow;
  categories: InvCategoryRow[];
  units: UnitView[];
  unitsTruncated: boolean;
  balances: BalanceView[];
  kits: Map<string, { required: number; presentRequired: number; items: number; present: number }>;
  movements: MovementBrief[];
  locations: InvLocationRow[];
  bins: InvBinRow[];
  summaryAvailability: { locationId: string; name: string; usableNow: number }[];
  names: Names;
  replacedBy: { id: string; name: string } | null;
}

const isOverdue = (u: Pick<InvUnitRow, "expected_return_at" | "custody_kind" | "lifecycle">): boolean =>
  !!u.expected_return_at && u.lifecycle === "active" && ["employee", "project", "transit", "repair"].includes(u.custody_kind) && new Date(u.expected_return_at).getTime() < Date.now();

async function companyNameOf(db: Db, ctx: InventoryContext, companyId: string): Promise<string> {
  const known = ctx.companyName(companyId);
  if (known !== "Unknown") return known;
  const { data } = await db.from("companies").select("legal_name").eq("id", companyId).maybeSingle();
  return data?.legal_name ?? "Unknown company";
}

export async function loadItemDetail(ctx: InventoryContext, itemId: string): Promise<ItemDetail | null> {
  const db = await createClient();
  const { data: item, error } = await db.from("inv_items").select("*").eq("id", itemId).maybeSingle();
  fail("item", error);
  if (!item) return null;
  const detail = canViewStock(ctx.grants, item.company_id);
  const costs = canSeeCosts(ctx.grants, item.company_id);
  const [cat, locs, bins, companyName, replaced] = await Promise.all([
    item.category_id ? db.from("inv_categories").select("*").eq("company_id", item.company_id) : Promise.resolve({ data: [] as InvCategoryRow[], error: null }),
    db.from("inv_locations").select("*").eq("company_id", item.company_id).order("name"),
    db.from("inv_bins").select("*").eq("company_id", item.company_id).eq("is_active", true).order("code"),
    companyNameOf(db, ctx, item.company_id),
    item.replaced_by_item_id ? db.from("inv_items").select("id, name").eq("id", item.replaced_by_item_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  fail("locations", locs.error);
  const categories = (cat.data ?? []) as InvCategoryRow[];
  const locations = (locs.data ?? []) as InvLocationRow[];
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const binLabel = new Map((bins.data ?? []).map((b) => [b.id, b.label?.trim() ? `${b.code} (${b.label})` : b.code]));

  let units: InvUnitRow[] = [];
  let unitsTruncated = false;
  let balances: InvBalanceRow[] = [];
  let reservations: ReservationLite[] = [];
  let kitRows: InvKitContentRow[] = [];
  let movements: MovementBrief[] = [];
  let costRows: { unit_id: string | null; unit_cost: number | string | null; currency: string | null }[] = [];
  const summaryAvailability: ItemDetail["summaryAvailability"] = [];
  if (detail) {
    const [u, b, r] = await Promise.all([
      fetchAll<InvUnitRow>((a, z) => db.from("inv_units").select("*").eq("item_id", itemId).order("code").range(a, z), 3000),
      fetchAll<InvBalanceRow>((a, z) => db.from("inv_balances").select("*").eq("item_id", itemId).gt("qty", 0).order("id").range(a, z), 3000),
      db.from("inv_reservations").select("item_id, unit_id, location_id, qty, dispatched_qty, reserved_during, status").eq("item_id", itemId).eq("status", "active"),
    ]);
    units = u.rows; unitsTruncated = u.truncated; balances = b.rows;
    reservations = (r.data ?? []) as ReservationLite[];
    if (item.tracking === "kit" && units.length > 0) {
      const k = await fetchAll<InvKitContentRow>((a, z) => db.from("inv_kit_contents").select("*").in("kit_unit_id", units.map((x) => x.id).slice(0, 300)).range(a, z), 5000);
      kitRows = k.rows;
    }
    const m = await db.from("inv_movements").select(`${MOVEMENT_COLUMNS}, inv_movement_lines!inner(${LINE_COLUMNS})`).eq("inv_movement_lines.item_id", itemId).order("occurred_at", { ascending: false }).limit(10);
    fail("movements", m.error);
    movements = ((m.data ?? []) as unknown as (Omit<MovementBrief, "lines"> & { inv_movement_lines: MovementBrief["lines"] })[]).map(({ inv_movement_lines, ...rest }) => ({ ...rest, lines: inv_movement_lines }));
    if (costs && units.length > 0) {
      const c = await db.from("inv_costs").select("unit_id, unit_cost, currency").eq("item_id", itemId).not("unit_id", "is", null);
      costRows = (c.data ?? []) as typeof costRows;
    }
  } else {
    const from = new Date();
    const until = new Date(from.getTime() + 24 * 3600 * 1000);
    await Promise.all(locations.filter((l) => l.is_active).map(async (l) => {
      const { data } = await db.rpc("inv_availability", { p_item_id: itemId, p_location_id: l.id, p_from: from.toISOString(), p_until: until.toISOString() });
      if (data && typeof data === "object" && !Array.isArray(data)) summaryAvailability.push({ locationId: l.id, name: l.name, usableNow: num((data as Record<string, unknown>).usable_now as number) });
    }));
  }

  const names = await loadNames(db, ctx, {
    employeeIds: [...units.map((x) => x.employee_id), ...balances.map((x) => x.employee_id), ...movements.map((x) => x.employee_id), ...movements.flatMap((x) => x.lines.flatMap((l) => [l.from_employee_id, l.to_employee_id]))].filter((x): x is string => !!x),
    projectIds: [...units.map((x) => x.project_id), ...balances.map((x) => x.project_id), ...movements.map((x) => x.project_id)].filter((x): x is string => !!x),
    userIds: movements.map((x) => x.performed_by),
    requestIds: movements.map((x) => x.request_id).filter((x): x is string => !!x),
    companyIds: [item.company_id],
  });
  const costByUnit = new Map(costRows.filter((c) => c.unit_id && c.unit_cost !== null && c.currency).map((c) => [c.unit_id!, { amount: num(c.unit_cost), currency: c.currency! }]));
  const unitViews: UnitView[] = units.map((u) => {
    const employeeName = u.employee_id ? names.employee(u.employee_id) : null;
    const projectName = u.project_id ? names.project(u.project_id) : null;
    const bin = u.bin_id ? (binLabel.get(u.bin_id) ?? null) : null;
    return {
      ...u, employeeName, projectName, binLabel: bin, locationName: u.location_id ? (locName.get(u.location_id) ?? null) : null, cost: costByUnit.get(u.id) ?? null, overdue: isOverdue(u),
      where: whereText({ custody: u.custody_kind, lifecycle: u.lifecycle, binLabel: bin, employeeName, projectName, repairReference: u.repair_reference, inKit: !!u.in_kit_id }, u.location_id ? locName.get(u.location_id) : null),
    };
  });
  const balanceViews: BalanceView[] = balances.map((b) => ({
    ...b, locationName: b.location_id ? (locName.get(b.location_id) ?? null) : null, binLabel: b.bin_id ? (binLabel.get(b.bin_id) ?? null) : null,
    holderText: b.holder_kind === "employee" ? names.employee(b.employee_id) : b.holder_kind === "project" ? names.project(b.project_id) : b.holder_kind === "repair" ? `At the repairer (${b.repair_reference})` : b.holder_kind === "transit" ? "In transit" : b.holder_kind === "kit" ? "Inside a kit" : "On the shelf",
  }));
  const kits = new Map<string, { required: number; presentRequired: number; items: number; present: number }>();
  for (const k of kitRows) {
    const e = kits.get(k.kit_unit_id) ?? { required: 0, presentRequired: 0, items: 0, present: 0 };
    e.items += 1;
    if (k.status !== "missing") e.present += 1;
    if (k.is_required) { e.required += 1; if (k.status !== "missing") e.presentRequired += 1; }
    kits.set(k.kit_unit_id, e);
  }
  const counts = buildStockRows({
    items: [item], categories, units: units, balances: balances, reservations, detailCompanyIds: detail ? new Set([item.company_id]) : new Set(), locationId: "", now: new Date(),
  })[0]!;
  return {
    item, categoryName: categoryPath(categories, item.category_id), companyName, detail,
    canEdit: canManageCatalogue(ctx.grants, item.company_id), canSeeCosts: costs, canConfirm: canConfirmStock(ctx.grants, item.company_id),
    counts, categories, units: unitViews, unitsTruncated, balances: balanceViews, kits, movements, locations, bins: (bins.data ?? []) as InvBinRow[], summaryAvailability, names,
    replacedBy: replaced.data ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// One unit (by id, or by its equipment ID such as UAE-E-00042)
// ---------------------------------------------------------------------------------------------------------------

export interface UnitDetail {
  unit: UnitView;
  item: InvItemRow;
  companyName: string;
  canOperate: boolean;
  canEdit: boolean;
  canSeeCosts: boolean;
  kit: KitView[];
  /** Units that could be packed into this kit right now (same company, on the shelf here, not in a kit), by item. */
  packable: Candidate[];
  rental: InvRentalRow | null;
  history: MovementBrief[];
  historyTruncated: boolean;
  names: Names;
  locations: InvLocationRow[];
  bins: InvBinRow[];
  inKitCode: string | null;
}

export async function loadUnitDetail(ctx: InventoryContext, idOrCode: string): Promise<UnitDetail | null> {
  const db = await createClient();
  const id = parseRecordId(idOrCode);
  let q = db.from("inv_units").select("*");
  if (id) q = q.eq("id", id);
  else {
    const parsed = parseInventoryScan(idOrCode);
    if (!parsed.ok || parsed.kind !== "unit") return null;
    q = q.eq("code", parsed.code);
  }
  const { data: u, error } = await q.maybeSingle();
  fail("unit", error);
  if (!u) return null;
  const [{ data: item }, locs, bins, companyName] = await Promise.all([
    db.from("inv_items").select("*").eq("id", u.item_id).maybeSingle(),
    db.from("inv_locations").select("*").eq("company_id", u.company_id).order("name"),
    db.from("inv_bins").select("*").eq("company_id", u.company_id).eq("is_active", true).order("code"),
    companyNameOf(db, ctx, u.company_id),
  ]);
  if (!item) return null;
  const locations = (locs.data ?? []) as InvLocationRow[];
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const binMap = new Map((bins.data ?? []).map((b) => [b.id, b.label?.trim() ? `${b.code} (${b.label})` : b.code]));
  const costs = canSeeCosts(ctx.grants, u.company_id);

  const [hist, kitRows, costRow, rental, inKit] = await Promise.all([
    db.from("inv_movements").select(`${MOVEMENT_COLUMNS}, inv_movement_lines!inner(${LINE_COLUMNS})`).eq("inv_movement_lines.unit_id", u.id).order("occurred_at", { ascending: false }).limit(200),
    item.tracking === "kit" ? db.from("inv_kit_contents").select("*").eq("kit_unit_id", u.id) : Promise.resolve({ data: [] as InvKitContentRow[], error: null }),
    costs ? db.from("inv_costs").select("unit_cost, currency").eq("unit_id", u.id).not("unit_cost", "is", null).order("entered_at", { ascending: false }).limit(1) : Promise.resolve({ data: [] as { unit_cost: number | string | null; currency: string | null }[], error: null }),
    u.rental_id ? db.from("inv_rentals").select("*").eq("id", u.rental_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    u.in_kit_id ? db.from("inv_units").select("code").eq("id", u.in_kit_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  fail("history", hist.error);
  const history = ((hist.data ?? []) as unknown as (Omit<MovementBrief, "lines"> & { inv_movement_lines: MovementBrief["lines"] })[]).map(({ inv_movement_lines, ...rest }) => ({ ...rest, lines: inv_movement_lines }));
  const kitData = (kitRows.data ?? []) as InvKitContentRow[];
  const itemIds = [...new Set([...kitData.map((k) => k.item_id), ...kitData.map((k) => k.substitute_item_id).filter((x): x is string => !!x)])];
  const contentIds = kitData.map((k) => k.content_unit_id).filter((x): x is string => !!x);
  const [itemNames, contentUnits] = await Promise.all([
    itemIds.length > 0 ? db.from("inv_items").select("id, name, tracking, unit_of_measure, quantity_scale").in("id", itemIds) : Promise.resolve({ data: [] as { id: string; name: string; tracking: InvTracking; unit_of_measure: string; quantity_scale: number }[] }),
    contentIds.length > 0 ? db.from("inv_units").select("id, code").in("id", contentIds) : Promise.resolve({ data: [] as { id: string; code: string }[] }),
  ]);
  const nameOf = new Map((itemNames.data ?? []).map((i) => [i.id, i.name]));
  const infoOf = new Map((itemNames.data ?? []).map((i) => [i.id, i]));
  const codeOf = new Map((contentUnits.data ?? []).map((c) => [c.id, c.code]));
  const names = await loadNames(db, ctx, {
    employeeIds: [u.employee_id, ...history.flatMap((m) => [m.employee_id, ...m.lines.flatMap((l) => [l.from_employee_id, l.to_employee_id])])].filter((x): x is string => !!x),
    projectIds: [u.project_id, ...history.flatMap((m) => [m.project_id, ...m.lines.flatMap((l) => [l.from_project_id, l.to_project_id])])].filter((x): x is string => !!x),
    userIds: history.map((m) => m.performed_by), requestIds: history.map((m) => m.request_id).filter((x): x is string => !!x), companyIds: [u.company_id],
  });
  const employeeName = u.employee_id ? names.employee(u.employee_id) : null;
  const projectName = u.project_id ? names.project(u.project_id) : null;
  const bin = u.bin_id ? (binMap.get(u.bin_id) ?? null) : null;
  const unit: UnitView = {
    ...u, employeeName, projectName, binLabel: bin, locationName: u.location_id ? (locName.get(u.location_id) ?? null) : null, overdue: isOverdue(u),
    cost: costRow.data?.[0]?.unit_cost != null && costRow.data[0].currency ? { amount: num(costRow.data[0].unit_cost), currency: costRow.data[0].currency } : null,
    where: whereText({ custody: u.custody_kind, lifecycle: u.lifecycle, binLabel: bin, employeeName, projectName, repairReference: u.repair_reference, inKit: !!u.in_kit_id }, u.location_id ? locName.get(u.location_id) : null),
  };

  // Units that could be packed into this kit: on the shelf at the kit's location, usable, not already in a kit, of an item named by the checklist.
  let packable: Candidate[] = [];
  if (item.tracking === "kit" && u.location_id && kitData.length > 0) {
    const wanted = [...new Set([...kitData.map((k) => k.item_id)])];
    const { data: avail } = await db.from("inv_units").select("*").in("item_id", wanted).eq("location_id", u.location_id).eq("custody_kind", "warehouse").eq("lifecycle", "active").is("in_kit_id", null).limit(500);
    packable = (avail ?? []).map((x) => candidateBase({
      key: `unit-${x.id}`, type: "unit", unitId: x.id, code: x.code, serial: x.serial_number, itemId: x.item_id, itemName: nameOf.get(x.item_id) ?? "Item", condition: x.condition,
      lifecycle: x.lifecycle, custody: x.custody_kind, locationId: x.location_id, where: whereText({ custody: x.custody_kind, lifecycle: x.lifecycle, binLabel: null, employeeName: null, projectName: null, repairReference: null, inKit: false }, locName.get(x.location_id ?? "")),
    }));
  }
  return {
    unit, item, companyName,
    canOperate: u.location_id ? canOperateLocation(ctx.grants, u.company_id, u.location_id, ctx.assignedLocationIds) : false,
    canEdit: canManageCatalogue(ctx.grants, u.company_id), canSeeCosts: costs,
    kit: kitData.map((k) => ({ ...k, itemName: nameOf.get(k.item_id) ?? "Item", itemTracking: infoOf.get(k.item_id)?.tracking ?? "individual", itemUom: infoOf.get(k.item_id)?.unit_of_measure ?? "each", itemScale: infoOf.get(k.item_id)?.quantity_scale ?? 0, substituteName: k.substitute_item_id ? (nameOf.get(k.substitute_item_id) ?? "Item") : null, contentCode: k.content_unit_id ? (codeOf.get(k.content_unit_id) ?? null) : null })),
    packable, rental: (rental.data ?? null) as InvRentalRow | null, history, historyTruncated: history.length >= 200, names, locations, bins: (bins.data ?? []) as InvBinRow[],
    inKitCode: inKit.data?.code ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Finding things to put on a list, and reading a scanned code
// ---------------------------------------------------------------------------------------------------------------

type UnitSelect = InvUnitRow;

function unitCandidate(u: UnitSelect, itemName: string, detail: string | null, locName: Map<string, string>, binMap: Map<string, string>, names?: Names): Candidate {
  const employeeName = u.employee_id ? (names?.employee(u.employee_id) ?? null) : null;
  const projectName = u.project_id ? (names?.project(u.project_id) ?? null) : null;
  const bin = u.bin_id ? (binMap.get(u.bin_id) ?? null) : null;
  return candidateBase({
    key: `unit-${u.id}`, type: "unit", unitId: u.id, code: u.code, serial: u.serial_number, itemId: u.item_id, itemName, detail, condition: u.condition, lifecycle: u.lifecycle,
    custody: u.custody_kind, locationId: u.location_id, binId: u.bin_id, binLabel: bin, rentalId: u.rental_id, repairReference: u.repair_reference, inKit: !!u.in_kit_id,
    employeeId: u.employee_id, employeeName, projectId: u.project_id, projectName,
    where: whereText({ custody: u.custody_kind, lifecycle: u.lifecycle, binLabel: bin, employeeName, projectName, repairReference: u.repair_reference, inKit: !!u.in_kit_id }, u.location_id ? locName.get(u.location_id) : null),
  });
}

const itemDetailText = (i: Pick<InvItemRow, "model" | "specification">) => [i.model, i.specification].filter(Boolean).join(" · ") || null;

function balanceCandidate(b: InvBalanceRow, item: InvItemRow, locName: Map<string, string>, binMap: Map<string, string>, names?: Names): Candidate {
  const bin = b.bin_id ? (binMap.get(b.bin_id) ?? null) : null;
  const employeeName = b.employee_id ? (names?.employee(b.employee_id) ?? null) : null;
  const projectName = b.project_id ? (names?.project(b.project_id) ?? null) : null;
  const where = b.holder_kind === "warehouse" ? `On the shelf${b.location_id ? `: ${locName.get(b.location_id) ?? ""}` : ""}${bin ? `, bin ${bin}` : ""}${b.rental_id ? " (rented)" : ""}`
    : whereText({ custody: b.holder_kind, lifecycle: "active", binLabel: bin, employeeName, projectName, repairReference: b.repair_reference, inKit: false }, null);
  return candidateBase({
    key: `bal-${b.id}`, type: "counted", code: b.label_code, itemId: item.id, itemName: item.name, detail: itemDetailText(item), tracking: item.tracking, uom: item.unit_of_measure,
    scale: item.quantity_scale, condition: b.condition, custody: b.holder_kind, qty: num(b.qty), binId: b.bin_id, binLabel: bin, locationId: b.location_id, rentalId: b.rental_id,
    repairReference: b.repair_reference, employeeId: b.employee_id, employeeName, projectId: b.project_id, projectName, where,
  });
}

async function locationAndBinMaps(db: Db, companyId: string) {
  const [locs, bins] = await Promise.all([
    db.from("inv_locations").select("id, name").eq("company_id", companyId),
    db.from("inv_bins").select("id, code, label").eq("company_id", companyId),
  ]);
  return {
    locName: new Map((locs.data ?? []).map((l) => [l.id, l.name])),
    binMap: new Map((bins.data ?? []).map((b) => [b.id, b.label?.trim() ? `${b.code} (${b.label})` : b.code])),
  };
}

/** Items of a company the person is working with (the catalogue), matched by name, model, specification or manufacturer. */
async function matchingItems(db: Db, companyId: string, q: string, tracking?: readonly InvTracking[]): Promise<InvItemRow[]> {
  const t = safe(q);
  let query = db.from("inv_items").select("*").eq("company_id", companyId).eq("status", "active").order("name").limit(40);
  if (tracking) query = query.in("tracking", [...tracking]);
  if (t) {
    const like = `%${t.replace(/ /g, "%")}%`;
    query = query.or(`name.ilike.${like},model.ilike.${like},specification.ilike.${like},manufacturer.ilike.${like}`);
  }
  const { data, error } = await query;
  fail("items", error);
  return (data ?? []) as InvItemRow[];
}

export interface SearchParams { companyId: string; locationId: string | null; kind: MovementKind; q: string; rentalId?: string | null; adjustAction?: AdjustAction }

/**
 * What a person can add to a list: units and counted stock found by a search, for the chosen kind of movement. Row-level security limits
 * this to what the person may read, so someone without stock access gets nothing. Never offers a quantity: it is always typed.
 */
export async function searchCandidates(p: SearchParams): Promise<Candidate[]> {
  const db = await createClient();
  const source = sourceFor(p.kind, p.adjustAction);
  const q = safe(p.q);
  const { locName, binMap } = await locationAndBinMaps(db, p.companyId);
  const out: Candidate[] = [];

  if (source === "catalogue") {
    const consumable = p.kind === "return_unused";
    const items = await matchingItems(db, p.companyId, q, consumable ? ["consumable" as const] : undefined);
    return items.map((i) => candidateBase({
      key: `item-${i.id}`, type: "item", itemId: i.id, itemName: i.name, detail: itemDetailText(i), tracking: i.tracking, uom: i.unit_of_measure, scale: i.quantity_scale, where: "",
    }));
  }

  const tracking: InvTracking[] | undefined = p.kind === "consume" ? ["consumable"] : p.kind === "issue" || p.kind === "dispatch" ? ["individual", "kit", "quantity"] : undefined;
  const items = q ? await matchingItems(db, p.companyId, q, tracking) : [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const unitMode = p.kind !== "consume" && p.kind !== "return_unused";

  if (unitMode) {
    let uq = db.from("inv_units").select("*").eq("company_id", p.companyId).limit(60).order("code");
    if (p.locationId) uq = uq.eq("location_id", p.locationId);
    if (source === "shelf") uq = uq.eq("custody_kind", "warehouse").eq("lifecycle", "active");
    else if (source === "shelf_any") uq = uq.eq("custody_kind", "warehouse").in("lifecycle", p.kind === "adjust" ? ["active", "missing"] : ["active"]);
    else if (source === "repair") uq = uq.eq("custody_kind", "repair");
    else if (source === "missing") uq = uq.eq("lifecycle", "missing");
    else if (source === "rental") uq = uq.eq("custody_kind", "warehouse").eq("lifecycle", "active").not("rental_id", "is", null);
    if (p.rentalId) uq = uq.eq("rental_id", p.rentalId);
    const or = [q ? `code.ilike.%${q.replace(/ /g, "%")}%` : null, q ? `serial_number.ilike.%${q.replace(/ /g, "%")}%` : null, items.length > 0 ? `item_id.in.(${items.map((i) => i.id).join(",")})` : null].filter(Boolean);
    if (or.length > 0) uq = uq.or(or.join(","));
    else if (!q) uq = uq.limit(30);
    const { data, error } = await uq;
    fail("units", error);
    const missingItems = [...new Set((data ?? []).map((u) => u.item_id).filter((id) => !itemById.has(id)))];
    if (missingItems.length > 0) {
      const { data: more } = await db.from("inv_items").select("*").in("id", missingItems);
      for (const i of (more ?? []) as InvItemRow[]) itemById.set(i.id, i);
    }
    for (const u of data ?? []) {
      const i = itemById.get(u.item_id);
      if (!i) continue;
      if (tracking && !tracking.includes(i.tracking)) continue;
      out.push(unitCandidate(u as UnitSelect, i.name, itemDetailText(i), locName, binMap));
    }
  }

  if (source === "shelf" || source === "shelf_any" || source === "rental" || source === "missing") {
    // Counted rows are found through their item (or the bin label typed): one row per item, bin and condition.
    let bq = db.from("inv_balances").select("*").eq("company_id", p.companyId).eq("holder_kind", "warehouse").gt("qty", 0).limit(80).order("id");
    if (p.locationId) bq = bq.eq("location_id", p.locationId);
    if (source === "shelf") bq = bq.eq("condition", "good");
    // Rented stock can be issued, dispatched and sent on like owned stock; everything else works on what the company owns.
    if (source === "rental") bq = bq.not("rental_id", "is", null);
    else if (source !== "shelf_any" && source !== "missing" && !(p.kind === "issue" || p.kind === "dispatch" || p.kind === "transfer")) bq = bq.is("rental_id", null);
    if (p.rentalId) bq = bq.eq("rental_id", p.rentalId);
    const or = [q ? `label_code.ilike.%${q.replace(/ /g, "%")}%` : null, items.length > 0 ? `item_id.in.(${items.map((i) => i.id).join(",")})` : null].filter(Boolean);
    if (or.length > 0) bq = bq.or(or.join(","));
    if (or.length > 0 || !q) {
      const { data, error } = await bq;
      fail("stock", error);
      const need = [...new Set((data ?? []).map((b) => b.item_id).filter((id) => !itemById.has(id)))];
      if (need.length > 0) {
        const { data: more } = await db.from("inv_items").select("*").in("id", need);
        for (const i of (more ?? []) as InvItemRow[]) itemById.set(i.id, i);
      }
      for (const b of (data ?? []) as InvBalanceRow[]) {
        const i = itemById.get(b.item_id);
        if (!i) continue;
        if (tracking && !tracking.includes(i.tracking)) continue;
        if (p.kind === "issue" && i.tracking === "consumable") continue;
        out.push(balanceCandidate(b, i, locName, binMap));
      }
    }
    if (source === "missing" && items.length > 0) {
      // Found stock that is counted: pick the item and type how many.
      for (const i of items.filter((x) => x.tracking === "quantity" || x.tracking === "consumable")) {
        if (!out.some((c) => c.type === "counted" && c.itemId === i.id)) out.push(candidateBase({ key: `item-${i.id}`, type: "item", itemId: i.id, itemName: i.name, detail: itemDetailText(i), tracking: i.tracking, uom: i.unit_of_measure, scale: i.quantity_scale }));
      }
    }
  }
  return out.filter((c) => candidateMatches(c, c.type === "unit" || c.type === "counted" ? "" : q)).slice(0, 60);
}

/** Everything one employee or one project holds (units and counted stock): the list a return starts from. */
export async function loadHeld(ctx: InventoryContext, p: { companyId: string; employeeId?: string | null; projectId?: string | null }): Promise<Candidate[]> {
  const db = await createClient();
  const holder: { col: "employee_id" | "project_id"; id: string; kind: InvCustody } | null = p.employeeId ? { col: "employee_id", id: p.employeeId, kind: "employee" } : p.projectId ? { col: "project_id", id: p.projectId, kind: "project" } : null;
  if (!holder) return [];
  const [units, balances] = await Promise.all([
    fetchAll<InvUnitRow>((a, z) => db.from("inv_units").select("*").eq(holder.col, holder.id).eq("custody_kind", holder.kind).neq("lifecycle", "retired").order("code").range(a, z), 2000),
    fetchAll<InvBalanceRow>((a, z) => db.from("inv_balances").select("*").eq(holder.col, holder.id).eq("holder_kind", holder.kind).gt("qty", 0).order("id").range(a, z), 2000),
  ]);
  const itemIds = [...new Set([...units.rows.map((u) => u.item_id), ...balances.rows.map((b) => b.item_id)])];
  const { data: items } = itemIds.length > 0 ? await db.from("inv_items").select("*").in("id", itemIds.slice(0, 300)) : { data: [] as InvItemRow[] };
  const itemById = new Map(((items ?? []) as InvItemRow[]).map((i) => [i.id, i]));
  const { locName, binMap } = await locationAndBinMaps(db, p.companyId);
  const names = await loadNames(db, ctx, { employeeIds: p.employeeId ? [p.employeeId] : [], projectIds: p.projectId ? [p.projectId] : [], companyIds: [p.companyId] });
  const out: Candidate[] = [];
  for (const u of units.rows) {
    const i = itemById.get(u.item_id);
    if (i) out.push(unitCandidate(u, i.name, itemDetailText(i), locName, binMap, names));
  }
  for (const b of balances.rows) {
    const i = itemById.get(b.item_id);
    if (i) out.push(balanceCandidate(b, i, locName, binMap, names));
  }
  return out;
}

export const NOT_FOUND_MESSAGE = "No equipment or stock with that code was found, or you do not have access to it.";

/** Reads a scanned or typed code. Never changes anything: it only says what the code is, for the people who may see it. */
export async function resolveCode(ctx: InventoryContext, raw: string): Promise<ScanResolution> {
  const parsed = parseInventoryScan(raw);
  if (!parsed.ok) {
    return { ok: false, message: parsed.problem === "empty" ? "Nothing was read. Scan a label or type the code." : "That is not an Inventory label. Scan the QR code on a unit or a bin label, or type the ID, for example UAE-E-00042." };
  }
  const db = await createClient();
  if (parsed.kind === "unit") {
    const { data: u, error } = await db.from("inv_units").select("*").eq("code", parsed.code).maybeSingle();
    if (error) return { ok: false, message: "The code could not be looked up right now. Try again." };
    if (!u) return { ok: false, message: NOT_FOUND_MESSAGE };
    const { data: item } = await db.from("inv_items").select("*").eq("id", u.item_id).maybeSingle();
    if (!item) return { ok: false, message: NOT_FOUND_MESSAGE };
    const { locName, binMap } = await locationAndBinMaps(db, u.company_id);
    const names = await loadNames(db, ctx, { employeeIds: u.employee_id ? [u.employee_id] : [], projectIds: u.project_id ? [u.project_id] : [], companyIds: [u.company_id] });
    return { ok: true, kind: "unit", unitId: u.id, itemId: u.item_id, code: u.code, candidate: unitCandidate(u, item.name, itemDetailText(item as InvItemRow), locName, binMap, names) };
  }
  const { data: b, error } = await db.from("inv_balances").select("*").eq("label_code", parsed.code).maybeSingle();
  if (error) return { ok: false, message: "The code could not be looked up right now. Try again." };
  if (!b) return { ok: false, message: NOT_FOUND_MESSAGE };
  const { data: item } = await db.from("inv_items").select("*").eq("id", b.item_id).maybeSingle();
  if (!item) return { ok: false, message: NOT_FOUND_MESSAGE };
  const { locName, binMap } = await locationAndBinMaps(db, b.company_id);
  return { ok: true, kind: "stock", itemId: b.item_id, code: parsed.code, candidate: balanceCandidate(b as InvBalanceRow, item as InvItemRow, locName, binMap) };
}

/** Several codes at once (`codes=` in an address): units by ID and bin labels, in the order given, skipping anything not found. */
export async function resolveCodes(ctx: InventoryContext, rawCodes: string[]): Promise<Candidate[]> {
  const parsed = rawCodes.slice(0, 60).map((c) => parseInventoryScan(c)).flatMap((p) => (p.ok ? [p] : []));
  const seen = new Set<string>();
  const unique = parsed.filter((p) => (seen.has(p.code) ? false : (seen.add(p.code), true)));
  const results = await Promise.all(unique.map((p) => resolveCode(ctx, p.code)));
  return results.flatMap((r) => (r.ok ? [r.candidate] : []));
}

// ---------------------------------------------------------------------------------------------------------------
// What the movement forms need
// ---------------------------------------------------------------------------------------------------------------

export async function loadFormContext(ctx: InventoryContext, needs: { projects?: boolean; requests?: boolean; transfers?: boolean; rentals?: boolean }): Promise<FormContext> {
  const db = await createClient();
  const operable = ctx.locations.filter((l) => l.is_active && canOperateLocation(ctx.grants, l.company_id, l.id, ctx.assignedLocationIds));
  const companyIds = [...new Set(operable.map((l) => l.company_id))];
  const destCandidates = ctx.locations.filter((l) => l.is_active && companyIds.includes(l.company_id));
  const locIds = [...new Set([...operable, ...destCandidates].map((l) => l.id))];
  const { rows: bins } = locIds.length > 0 ? await fetchAll<InvBinRow>((a, z) => db.from("inv_bins").select("*").in("location_id", locIds).eq("is_active", true).order("code").range(a, z), 3000) : { rows: [] as InvBinRow[] };
  const toForm = (l: InvLocationRow): FormLocation => ({
    id: l.id, companyId: l.company_id, companyName: ctx.companyName(l.company_id), name: l.name, timezone: l.timezone,
    bins: bins.filter((b) => b.location_id === l.id).map((b) => ({ id: b.id, code: b.code, label: b.label })),
  });
  const locations = operable.map(toForm);
  const destinations = destCandidates.map(toForm);

  const [projects, requests, transfers, rentals] = await Promise.all([
    needs.projects && companyIds.length > 0 ? db.from("proj_projects").select("id, company_id, reference, name, status").in("company_id", companyIds).neq("status", "archived").order("name").limit(500) : Promise.resolve({ data: [] as { id: string; company_id: string; reference: string; name: string; status: string }[], error: null }),
    needs.requests && companyIds.length > 0 ? db.from("inv_requests").select("id, company_id, code, kind, project_id, employee_id, title, status, expected_return_at, needed_until").in("company_id", companyIds).in("status", ["submitted", "in_progress"]).order("created_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] as { id: string; company_id: string; code: string; kind: "project" | "employee"; project_id: string | null; employee_id: string | null; title: string | null; status: string; expected_return_at: string | null; needed_until: string | null }[], error: null }),
    needs.transfers && operable.length > 0 ? db.from("inv_transfers").select("*").in("to_location_id", operable.map((l) => l.id)).eq("status", "in_transit").order("dispatched_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] as InvTransferRow[], error: null }),
    needs.rentals && companyIds.length > 0 ? db.from("inv_rentals").select("*").in("company_id", companyIds).eq("status", "open").order("return_deadline").limit(200) : Promise.resolve({ data: [] as InvRentalRow[], error: null }),
  ]);
  fail("projects", projects.error);
  fail("requests", requests.error);
  fail("transfers", transfers.error);
  fail("rentals", rentals.error);

  const trs = (transfers.data ?? []) as InvTransferRow[];
  const locName = new Map(destinations.concat(locations).map((l) => [l.id, l.name]));
  const heldByTransfer = new Map<string, Candidate[]>();
  if (trs.length > 0) {
    const ids = trs.map((t) => t.id);
    const [units, balances] = await Promise.all([
      db.from("inv_units").select("*").in("transfer_id", ids).eq("custody_kind", "transit"),
      db.from("inv_balances").select("*").in("transfer_id", ids).eq("holder_kind", "transit").gt("qty", 0),
    ]);
    const itemIds = [...new Set([...(units.data ?? []).map((u) => u.item_id), ...(balances.data ?? []).map((b) => b.item_id)])];
    const { data: items } = itemIds.length > 0 ? await db.from("inv_items").select("*").in("id", itemIds.slice(0, 300)) : { data: [] as InvItemRow[] };
    const itemById = new Map(((items ?? []) as InvItemRow[]).map((i) => [i.id, i]));
    const empty = new Map<string, string>();
    for (const u of (units.data ?? []) as InvUnitRow[]) {
      const i = itemById.get(u.item_id);
      if (i && u.transfer_id) (heldByTransfer.get(u.transfer_id) ?? heldByTransfer.set(u.transfer_id, []).get(u.transfer_id)!).push(unitCandidate(u, i.name, itemDetailText(i), empty, empty));
    }
    for (const b of (balances.data ?? []) as InvBalanceRow[]) {
      const i = itemById.get(b.item_id);
      if (i && b.transfer_id) (heldByTransfer.get(b.transfer_id) ?? heldByTransfer.set(b.transfer_id, []).get(b.transfer_id)!).push({ ...balanceCandidate(b, i, empty, empty), where: "In transit" });
    }
  }
  return {
    locations, destinations,
    projects: (projects.data ?? []).map((p) => ({ id: p.id, companyId: p.company_id, reference: p.reference, name: p.name, status: p.status })),
    requests: (requests.data ?? []).map((r) => ({ id: r.id, companyId: r.company_id, code: r.code, kind: r.kind, projectId: r.project_id, employeeId: r.employee_id, title: r.title, status: r.status, expectedReturnAt: r.expected_return_at ?? r.needed_until })),
    transfers: trs.map((t) => ({ id: t.id, code: t.code, companyId: t.company_id, fromLocationId: t.from_location_id, fromName: locName.get(t.from_location_id) ?? ctx.locationName(t.from_location_id), toLocationId: t.to_location_id, toName: locName.get(t.to_location_id) ?? ctx.locationName(t.to_location_id), expectedAt: t.expected_at, carrier: t.carrier, reference: t.reference, dispatchedAt: t.dispatched_at, held: heldByTransfer.get(t.id) ?? [] })),
    rentals: ((rentals.data ?? []) as InvRentalRow[]).map((r) => ({ id: r.id, companyId: r.company_id, supplier: r.supplier_name, reference: r.external_reference, deadline: r.return_deadline })),
    canSeeCostsByCompany: Object.fromEntries(companyIds.map((id) => [id, canSeeCosts(ctx.grants, id)])),
  };
}

/** The name of an employee the page was given only an id for (a link from another page). */
export async function employeeNameFor(ctx: InventoryContext, companyId: string, employeeId: string): Promise<string | null> {
  const db = await createClient();
  const names = await loadNames(db, ctx, { employeeIds: [employeeId], companyIds: [companyId] });
  return names.employees.get(employeeId) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Movements (the ledger)
// ---------------------------------------------------------------------------------------------------------------

export interface MovementFilters { kind: string; location: string; from: string; to: string; item: string; company: string; page: number }

export const MOVEMENTS_PER_PAGE = 50;

export interface MovementList {
  rows: MovementBrief[];
  total: number;
  names: Names;
  items: Map<string, string>;
}

export async function loadMovements(ctx: InventoryContext, f: MovementFilters, viewCompanyIds: string[], fromIso: string | null, toIso: string | null): Promise<MovementList> {
  const db = await createClient();
  const ids = f.company ? viewCompanyIds.filter((c) => c === f.company) : viewCompanyIds;
  let q = db.from("inv_movements").select(`${MOVEMENT_COLUMNS}, inv_movement_lines${f.item ? "!inner" : ""}(${LINE_COLUMNS})`, { count: "exact" }).in("company_id", ids);
  if (f.kind) q = q.eq("kind", f.kind as InvMovementKind);
  if (f.location) q = q.or(`from_location_id.eq.${f.location},to_location_id.eq.${f.location}`);
  if (fromIso) q = q.gte("occurred_at", fromIso);
  if (toIso) q = q.lt("occurred_at", toIso);
  if (f.item) q = q.eq("inv_movement_lines.item_id", f.item);
  const from = (Math.max(1, f.page) - 1) * MOVEMENTS_PER_PAGE;
  const { data, error, count } = await q.order("occurred_at", { ascending: false }).order("code", { ascending: false }).range(from, from + MOVEMENTS_PER_PAGE - 1);
  fail("movements", error);
  const rows = ((data ?? []) as unknown as (Omit<MovementBrief, "lines"> & { inv_movement_lines: MovementBrief["lines"] })[]).map(({ inv_movement_lines, ...rest }) => ({ ...rest, lines: inv_movement_lines }));
  const itemIds = [...new Set(rows.flatMap((m) => m.lines.map((l) => l.item_id)))];
  const { data: items } = itemIds.length > 0 ? await db.from("inv_items").select("id, name").in("id", itemIds.slice(0, 400)) : { data: [] as { id: string; name: string }[] };
  const names = await loadNames(db, ctx, {
    employeeIds: rows.flatMap((m) => [m.employee_id, ...m.lines.flatMap((l) => [l.from_employee_id, l.to_employee_id])]).filter((x): x is string => !!x),
    projectIds: rows.flatMap((m) => [m.project_id, ...m.lines.flatMap((l) => [l.from_project_id, l.to_project_id])]).filter((x): x is string => !!x),
    userIds: rows.map((m) => m.performed_by), requestIds: rows.map((m) => m.request_id).filter((x): x is string => !!x), companyIds: ids,
  });
  return { rows, total: count ?? rows.length, names, items: new Map((items ?? []).map((i) => [i.id, i.name])) };
}

export interface MovementDetail {
  movement: MovementBrief & { company_id: string; recipient_name: string | null; expected_return_at: string | null; transfer_id: string | null; to_project_id: string | null; recorded_at: string; idempotency_key: string | null };
  items: Map<string, string>;
  unitCodes: Map<string, string>;
  names: Names;
  corrects: { id: string; code: string } | null;
  correctedBy: { id: string; code: string; occurred_at: string }[];
  /** Lines the database can correct (counted stock that was received, opened, found, counted or consumed). */
  correctable: Set<string>;
  binLabels: Map<string, string>;
}

export async function loadMovementDetail(ctx: InventoryContext, id: string): Promise<MovementDetail | null> {
  const db = await createClient();
  const { data: m, error } = await db.from("inv_movements").select("*").eq("id", id).maybeSingle();
  fail("movement", error);
  if (!m) return null;
  const { data: lines, error: lerr } = await db.from("inv_movement_lines").select("*").eq("movement_id", id).order("id");
  fail("lines", lerr);
  const itemIds = [...new Set((lines ?? []).map((l) => l.item_id))];
  const unitIds = [...new Set((lines ?? []).map((l) => l.unit_id).filter((x): x is string => !!x))];
  const binIds = [...new Set((lines ?? []).flatMap((l) => [l.from_bin_id, l.to_bin_id]).filter((x): x is string => !!x))];
  const [items, units, bins, corrects, correctedBy] = await Promise.all([
    itemIds.length > 0 ? db.from("inv_items").select("id, name").in("id", itemIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    unitIds.length > 0 ? db.from("inv_units").select("id, code").in("id", unitIds.slice(0, 200)) : Promise.resolve({ data: [] as { id: string; code: string }[] }),
    binIds.length > 0 ? db.from("inv_bins").select("id, code, label").in("id", binIds) : Promise.resolve({ data: [] as { id: string; code: string; label: string | null }[] }),
    m.corrects_movement_id ? db.from("inv_movements").select("id, code").eq("id", m.corrects_movement_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("inv_movements").select("id, code, occurred_at").eq("corrects_movement_id", id).order("occurred_at"),
  ]);
  const names = await loadNames(db, ctx, {
    employeeIds: [m.employee_id, m.recipient_employee_id, ...(lines ?? []).flatMap((l) => [l.from_employee_id, l.to_employee_id])].filter((x): x is string => !!x),
    projectIds: [m.project_id, m.to_project_id, ...(lines ?? []).flatMap((l) => [l.from_project_id, l.to_project_id])].filter((x): x is string => !!x),
    userIds: [m.performed_by], requestIds: m.request_id ? [m.request_id] : [], companyIds: [m.company_id],
  });
  const correctable = new Set<string>();
  for (const l of lines ?? []) {
    const consume = l.from_balance_id !== null && l.to_balance_id === null && l.to_kind === "consumed";
    if (l.unit_id === null && m.kind !== "correction" && (consume || (l.from_balance_id === null && l.to_balance_id !== null))) correctable.add(l.id);
  }
  return {
    movement: { ...(m as InvMovementRow), company_id: m.company_id, lines: (lines ?? []) as MovementBrief["lines"], recipient_name: m.recipient_name, expected_return_at: m.expected_return_at, transfer_id: m.transfer_id, to_project_id: m.to_project_id, recorded_at: m.recorded_at, idempotency_key: m.idempotency_key },
    items: new Map((items.data ?? []).map((i) => [i.id, i.name])),
    unitCodes: new Map((units.data ?? []).map((u) => [u.id, u.code])),
    names,
    corrects: corrects.data ?? null,
    correctedBy: (correctedBy.data ?? []) as { id: string; code: string; occurred_at: string }[],
    correctable,
    binLabels: new Map((bins.data ?? []).map((b) => [b.id, b.label?.trim() ? `${b.code} (${b.label})` : b.code])),
  };
}
