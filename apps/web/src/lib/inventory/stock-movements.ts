import type { InvTracking } from "@/types/inventory";
import { BALANCE_CONDITION_WORDS, CONDITION_WORDS, formatQty } from "./words";

/**
 * Pure logic of the movement forms (receive, issue, dispatch, return, transfer and the specialist ones). No React, no server imports:
 * everything here is unit tested. It turns what a person typed into the exact JSON the database functions take, says what they asked for
 * in words (the review step), and writes the plain sentences for the result. It makes no permission decision; the database does.
 */

export type MovementKind =
  | "receive" | "issue" | "dispatch" | "return" | "transfer" | "receive_transfer" | "project_transfer"
  | "repair_out" | "repair_in" | "check" | "adjust" | "consume" | "return_unused" | "return_rental" | "pack_kit" | "unpack_kit";

export type AdjustAction = "missing" | "found" | "retire";
export type ReturnFrom = "employee" | "project";

/** One line as the database takes it: only the keys it knows, values already checked. */
export type RpcLine = Record<string, string | number | string[]>;

export interface LineDraft {
  /** Local id of the row in the editor. */
  id: string;
  unitId: string | null;
  /** Equipment ID (UAE-E-…) or bin label (UAE-S-…) when the line came from a scan or a search of units. */
  code: string | null;
  itemId: string;
  itemName: string;
  tracking: InvTracking;
  uom: string;
  scale: number;
  /** Typed by the person. For individually tracked stock being received this is how many units arrive. */
  qty: string;
  binId: string;
  binLabel: string;
  condition: string;
  fromCondition: string;
  serials: string;
  note: string;
  rentalId: string | null;
  /** The repair job a counted line is coming back from (repair in). */
  repairReference: string;
  cost: string;
  /** The most the holder / shelf has, when known (shown as a hint and checked). */
  maxQty: number | null;
  /** Where it is now, in words (shown in the list). */
  where: string;
}

export const emptyDraft = (over: Partial<LineDraft> & Pick<LineDraft, "id" | "itemId" | "itemName">): LineDraft => ({
  unitId: null, code: null, tracking: "individual", uom: "each", scale: 0, qty: "", binId: "", binLabel: "", condition: "good", fromCondition: "", serials: "",
  note: "", rentalId: null, repairReference: "", cost: "", maxQty: null, where: "", ...over,
});

export const isUnitLine = (d: Pick<LineDraft, "unitId">) => d.unitId !== null;

// ---------------------------------------------------------------------------------------------------------------
// What each kind of movement is called and asks for
// ---------------------------------------------------------------------------------------------------------------

export type Need = "required" | "optional" | "none";
/** Where the lines can come from: the catalogue (new stock), the shelf here, what a holder has, what is at the repairer, what is missing, a rental. */
export type LineSource = "catalogue" | "shelf" | "shelf_any" | "held" | "repair" | "missing" | "rental" | "transit" | "kit";

export interface KindConfig {
  title: string;
  lead: string;
  confirm: string;
  /** "Receive into", "Take from"… */
  locationLabel: string;
  source: LineSource;
  employee: Need;
  project: Need;
  expectedReturn: Need;
  request: Need;
  reason: Need;
  /** Lines may be left out (the database then means "everything"). */
  linesOptional?: boolean;
  /** Per-line condition choice, and its default. */
  lineCondition?: boolean;
  /** Per-line bin choice (where it goes back to / is taken from). */
  lineBin?: boolean;
}

export const KIND_CONFIG: Record<MovementKind, KindConfig> = {
  receive: { title: "Receive stock", lead: "Record equipment or stock that has arrived. Individually tracked items get their own ID and label.", confirm: "Confirm receipt", locationLabel: "Receive into", source: "catalogue", employee: "none", project: "none", expectedReturn: "none", request: "none", reason: "none", lineCondition: true, lineBin: true },
  issue: { title: "Issue to a person", lead: "Give equipment to an employee. They are then recorded as holding it until it comes back.", confirm: "Confirm issue", locationLabel: "Take from", source: "shelf", employee: "required", project: "none", expectedReturn: "optional", request: "optional", reason: "none", lineBin: true },
  dispatch: { title: "Dispatch to a project", lead: "Send equipment to a project. Name the request so it matches what was reserved.", confirm: "Confirm dispatch", locationLabel: "Take from", source: "shelf", employee: "none", project: "required", expectedReturn: "required", request: "optional", reason: "none", lineBin: true },
  return: { title: "Return", lead: "Equipment coming back from an employee or a project. Anything you do not list stays outstanding.", confirm: "Confirm return", locationLabel: "Back into", source: "held", employee: "none", project: "none", expectedReturn: "none", request: "none", reason: "none", lineCondition: true, lineBin: true },
  transfer: { title: "Send to another location", lead: "The stock is in transit until the other warehouse receives it. It is not available there before that.", confirm: "Confirm and send", locationLabel: "Send from", source: "shelf", employee: "none", project: "none", expectedReturn: "none", request: "none", reason: "none", lineBin: true },
  receive_transfer: { title: "Receive a transfer", lead: "Record what arrived. Anything not listed stays in transit and the transfer stays open.", confirm: "Confirm arrival", locationLabel: "Receive into", source: "transit", employee: "none", project: "none", expectedReturn: "none", request: "none", reason: "none", linesOptional: true, lineCondition: true, lineBin: true },
  project_transfer: { title: "Move between projects", lead: "Equipment goes straight from one project to another without coming back to the warehouse. The new project needs a request.", confirm: "Confirm move", locationLabel: "Warehouse", source: "held", employee: "none", project: "required", expectedReturn: "optional", request: "required", reason: "none" },
  repair_out: { title: "Send for repair", lead: "The equipment leaves the shelf for a repairer and is not available until it is back.", confirm: "Confirm sent for repair", locationLabel: "Take from", source: "shelf_any", employee: "none", project: "none", expectedReturn: "optional", request: "none", reason: "none", lineBin: true },
  repair_in: { title: "Back from repair", lead: "Record the condition it came back in. Good is available at once; anything else is held for checking.", confirm: "Confirm back from repair", locationLabel: "Back into", source: "repair", employee: "none", project: "none", expectedReturn: "none", request: "none", reason: "none", lineCondition: true, lineBin: true },
  check: { title: "Check condition", lead: "Release held equipment after a check, or hold it back if it is not right.", confirm: "Confirm check", locationLabel: "At", source: "shelf_any", employee: "none", project: "none", expectedReturn: "none", request: "none", reason: "none", lineCondition: true, lineBin: true },
  adjust: { title: "Correct the stock", lead: "Mark equipment missing, found again, or retired. A reason is always needed and nothing is deleted.", confirm: "Confirm", locationLabel: "At", source: "shelf_any", employee: "none", project: "none", expectedReturn: "none", request: "none", reason: "required", lineBin: true },
  consume: { title: "Use up consumables", lead: "Consumables are used up, not given back. Say who used them if you know.", confirm: "Confirm use", locationLabel: "Take from", source: "shelf", employee: "optional", project: "optional", expectedReturn: "none", request: "optional", reason: "none", lineBin: true },
  return_unused: { title: "Return unused consumables", lead: "Unused consumables go back on the shelf only when you record it here, and never more than that person or project used.", confirm: "Confirm return", locationLabel: "Back into", source: "catalogue", employee: "optional", project: "optional", expectedReturn: "none", request: "none", reason: "none", lineCondition: true, lineBin: true },
  return_rental: { title: "Return rental to supplier", lead: "Rented equipment goes back to its supplier. Leave the list empty to return everything of the rental that is on the shelf.", confirm: "Confirm return to supplier", locationLabel: "Take from", source: "rental", employee: "none", project: "none", expectedReturn: "none", request: "none", reason: "none", linesOptional: true, lineBin: true },
  pack_kit: { title: "Pack a kit", lead: "Tick what is in the box. Missing and substituted items are recorded, never hidden.", confirm: "Confirm packing", locationLabel: "At", source: "shelf", employee: "none", project: "none", expectedReturn: "none", request: "none", reason: "none" },
  unpack_kit: { title: "Unpack a kit", lead: "The contents go back on the shelf at the kit's location.", confirm: "Confirm unpacking", locationLabel: "At", source: "kit", employee: "none", project: "none", expectedReturn: "none", request: "none", reason: "none", linesOptional: true, lineBin: true },
};

/** Where the lines of a movement can come from. "Found" starts from what is recorded as missing; everything else follows the kind. */
export const sourceFor = (kind: MovementKind, adjustAction?: AdjustAction): LineSource => (kind === "adjust" && adjustAction === "found" ? "missing" : KIND_CONFIG[kind].source);

export const ADJUST_WORDS: Record<AdjustAction, { title: string; confirm: string; to: string }> = {
  missing: { title: "Mark as missing", confirm: "Confirm missing", to: "Recorded as missing" },
  found: { title: "Mark as found", confirm: "Confirm found", to: "Back on the shelf, held for checking" },
  retire: { title: "Retire (write off)", confirm: "Confirm retire", to: "Retired" },
};

// ---------------------------------------------------------------------------------------------------------------
// Quantities and dates typed by people
// ---------------------------------------------------------------------------------------------------------------

/** A typed quantity: positive, with no more decimals than the item allows. A blank is never a quantity. */
export function parseQty(text: string, scale: number): { ok: true; value: number } | { ok: false; error: string } {
  const t = text.trim().replace(",", ".");
  if (t === "") return { ok: false, error: "Type the quantity" };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: "Type the quantity as a number" };
  const value = Number(t);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "The quantity must be more than zero" };
  const decimals = t.includes(".") ? t.split(".")[1]!.replace(/0+$/, "").length : 0;
  if (decimals > scale) return { ok: false, error: scale === 0 ? "This item is counted in whole numbers" : `At most ${scale} decimal place${scale === 1 ? "" : "s"} for this item` };
  if (value > 1_000_000_000) return { ok: false, error: "That quantity is too large" };
  return { ok: true, value };
}

export function parseSerials(text: string): string[] {
  return text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

function zoneOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** A wall-clock time typed for a place ("2026-11-03T09:30" in Asia/Dubai) as the UTC instant the database stores. Null when it is not a date. */
export function localToUtcIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  try {
    let t = guess - zoneOffsetMs(guess, tz);
    t = guess - zoneOffsetMs(t, tz);
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/** "3 Nov 2026, 09:30 GST" in the place's own time zone. */
export function formatInZone(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz, timeZoneName: "short" }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** The current local time of a place, in the form a datetime-local box takes (used as the earliest allowed expected return). */
export function nowLocalInput(tz: string, now = new Date()): string {
  try {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
  } catch {
    return now.toISOString().slice(0, 16);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Lines: from what was typed to what the database takes
// ---------------------------------------------------------------------------------------------------------------

export type ParsedLines = { ok: true; lines: RpcLine[]; units: number; quantities: number } | { ok: false; error: string; lineId?: string };

const label = (d: LineDraft) => (d.code ? `${d.itemName} (${d.code})` : d.itemName);

function checkCondition(d: LineDraft, cond: string): string | null {
  const allowed = isUnitLine(d) ? Object.keys(CONDITION_WORDS) : Object.keys(BALANCE_CONDITION_WORDS);
  return allowed.includes(cond) ? null : `Choose a condition for ${label(d)}`;
}

/**
 * Turns the editor's rows into the JSON each database function takes. Counted stock needs a typed quantity (a blank, zero, negative or
 * too-precise number is refused, and nothing is ever assumed from a scan); each individual unit may appear once.
 */
export function parseLines(kind: MovementKind, drafts: readonly LineDraft[], opts: { canSeeCosts?: boolean; currency?: string } = {}): ParsedLines {
  const cfg = KIND_CONFIG[kind];
  if (drafts.length === 0) {
    return cfg.linesOptional ? { ok: true, lines: [], units: 0, quantities: 0 } : { ok: false, error: "Add at least one item to the list" };
  }
  const out: RpcLine[] = [];
  const seen = new Set<string>();
  let units = 0, quantities = 0;
  for (const d of drafts) {
    const line: RpcLine = {};
    if (isUnitLine(d)) {
      if (seen.has(d.unitId!)) return { ok: false, error: `${label(d)} is on the list twice`, lineId: d.id };
      seen.add(d.unitId!);
      units += 1;
      switch (kind) {
        case "return": case "repair_in": case "receive_transfer": {
          const bad = checkCondition(d, d.condition);
          if (bad) return { ok: false, error: bad, lineId: d.id };
          Object.assign(line, { unit_id: d.unitId!, condition: d.condition });
          if (d.binId) line.bin_id = d.binId;
          if (d.note.trim()) line.note = d.note.trim();
          break;
        }
        case "check": {
          const bad = checkCondition(d, d.condition);
          if (bad) return { ok: false, error: bad, lineId: d.id };
          Object.assign(line, { unit_id: d.unitId!, condition: d.condition });
          if (d.note.trim()) line.note = d.note.trim();
          break;
        }
        case "unpack_kit":
          line.unit_id = d.unitId!;
          if (d.binId) line.bin_id = d.binId;
          break;
        case "adjust":
          line.unit_id = d.unitId!;
          if (d.condition && d.condition !== "good") line.condition = d.condition;
          break;
        default:
          line.unit_id = d.unitId!;
      }
      out.push(line);
      continue;
    }
    // Counted stock, consumables, or individually tracked items being received.
    const receivingUnits = kind === "receive" && (d.tracking === "individual" || d.tracking === "kit");
    if (receivingUnits) {
      const serials = parseSerials(d.serials);
      let count: number;
      if (d.qty.trim() === "" && serials.length > 0) count = serials.length;
      else {
        const q = parseQty(d.qty, 0);
        if (!q.ok) return { ok: false, error: `${d.itemName}: ${q.error.replace("Type the quantity", "Type how many arrived")}`, lineId: d.id };
        count = q.value;
      }
      if (count > 200) return { ok: false, error: `${d.itemName}: receive at most 200 units at a time`, lineId: d.id };
      if (serials.length > 0 && serials.length !== count) return { ok: false, error: `${d.itemName}: give a serial number for every unit, or none (${serials.length} serial numbers for ${count} units)`, lineId: d.id };
      if (new Set(serials.map((s) => s.toLowerCase())).size !== serials.length) return { ok: false, error: `${d.itemName}: the same serial number is listed twice`, lineId: d.id };
      const bad = checkCondition({ ...d, unitId: "x" }, d.condition);
      if (bad) return { ok: false, error: bad, lineId: d.id };
      Object.assign(line, { item_id: d.itemId, qty: count, condition: d.condition });
      if (serials.length > 0) line.serials = serials;
      if (d.binId) line.bin_id = d.binId;
      units += count;
      out.push(line);
    } else {
      const q = parseQty(d.qty, d.scale);
      if (!q.ok) return { ok: false, error: `${d.itemName}: ${q.error}`, lineId: d.id };
      if (d.maxQty !== null && q.value > d.maxQty && (cfg.source === "held" || cfg.source === "transit" || cfg.source === "shelf" || cfg.source === "shelf_any")) {
        return { ok: false, error: `${d.itemName}: only ${formatQty(d.maxQty, d.uom)} ${cfg.source === "held" ? "is held" : cfg.source === "transit" ? "is on the way" : "is on the shelf"}`, lineId: d.id };
      }
      quantities += 1;
      line.item_id = d.itemId;
      line.qty = q.value;
      switch (kind) {
        case "receive": case "return": case "repair_in": case "return_unused": case "receive_transfer": {
          const bad = checkCondition(d, d.condition);
          if (bad) return { ok: false, error: bad, lineId: d.id };
          line.condition = d.condition;
          if (kind === "repair_in" && d.repairReference.trim()) line.repair_reference = d.repairReference.trim();
          if (kind === "receive_transfer" && d.fromCondition) line.from_condition = d.fromCondition;
          break;
        }
        case "transfer": case "repair_out": line.condition = d.condition || "good"; break;
        case "check":
          line.condition = d.condition;
          if (d.fromCondition) line.from_condition = d.fromCondition;
          break;
        case "adjust": line.condition = d.condition || "good"; break;
        case "project_transfer": break;
        default: break;
      }
      if (d.binId && kind !== "project_transfer") line.bin_id = d.binId;
      if (d.rentalId) line.rental_id = d.rentalId;
      if (kind === "check" && d.binId) line.bin_id = d.binId;
      out.push(line);
    }
    if (kind === "receive" && opts.canSeeCosts && d.cost.trim() !== "") {
      const cost = Number(d.cost.trim().replace(",", "."));
      if (!Number.isFinite(cost) || cost < 0) return { ok: false, error: `${d.itemName}: the cost must be a number`, lineId: d.id };
      const last = out[out.length - 1]!;
      last.unit_cost = cost;
      last.currency = (opts.currency ?? "AED").toUpperCase();
    }
  }
  return { ok: true, lines: out, units, quantities };
}

// ---------------------------------------------------------------------------------------------------------------
// What goes to the server, and which database function it becomes
// ---------------------------------------------------------------------------------------------------------------

export interface MovementInput {
  kind: MovementKind;
  companyId: string;
  /** The main location: where stock is taken from or goes to. Not needed for project transfers and receive_transfer. */
  locationId: string | null;
  key: string;
  lines: RpcLine[];
  note?: string;
  employeeId?: string;
  projectId?: string;
  toProjectId?: string;
  requestId?: string;
  expectedReturnAt?: string;
  toLocationId?: string;
  transferId?: string;
  carrier?: string;
  reference?: string;
  expectedAt?: string;
  repairReference?: string;
  reason?: string;
  adjustAction?: AdjustAction;
  kitUnitId?: string;
  rentalId?: string;
  returnFrom?: ReturnFrom;
  rental?: { supplierName: string; externalReference: string; returnDeadline: string; projectId?: string; note?: string };
}

export const KEY_RE = /^[A-Za-z0-9._:-]{8,120}$/;

/** The first thing wrong with a request, in words, or null. Checked in the form before the review step and again on the server. */
export function validateInput(i: MovementInput): string | null {
  const cfg = KIND_CONFIG[i.kind];
  if (!KEY_RE.test(i.key)) return "This form expired. Reload the page and try again.";
  if (!i.companyId) return "Choose where this happens";
  if (i.kind !== "project_transfer" && i.kind !== "receive_transfer" && !i.locationId) return "Choose the location";
  if (!cfg.linesOptional && i.lines.length === 0) return "Add at least one item to the list";
  if (i.kind === "issue" && !i.employeeId) return "Choose the employee who receives it";
  if (i.kind === "dispatch" && !i.projectId) return "Choose the project";
  if (i.kind === "return") {
    if (i.returnFrom === "employee" && !i.employeeId) return "Choose the employee who is returning it";
    if (i.returnFrom === "project" && !i.projectId) return "Choose the project it is coming back from";
    if (!i.returnFrom) return "Say who is returning it: an employee or a project";
  }
  if (i.kind === "dispatch" && !i.expectedReturnAt && !i.requestId) return "Say when it is expected back, or choose a request that has dates";
  if (i.kind === "transfer" && !i.toLocationId) return "Choose where it is going";
  if (i.kind === "transfer" && i.toLocationId === i.locationId) return "The destination must be a different location";
  if (i.kind === "receive_transfer" && !i.transferId) return "Choose the transfer";
  if (i.kind === "receive_transfer" && !i.locationId) return "Choose where it is being received";
  if (i.kind === "project_transfer") {
    if (!i.projectId) return "Choose the project it is on now";
    if (!i.toProjectId) return "Choose the project it is going to";
    if (i.projectId === i.toProjectId) return "Choose two different projects";
    if (!i.requestId) return "Choose the request of the project it is going to";
  }
  if (i.kind === "repair_out" && !(i.repairReference ?? "").trim()) return "Give the repair reference (repairer or job number)";
  if (i.kind === "adjust") {
    if (!i.adjustAction) return "Choose missing, found or retire";
    if (!(i.reason ?? "").trim()) return "Say why (a reason is needed for every adjustment)";
  }
  if ((i.kind === "consume" || i.kind === "return_unused") && i.employeeId && i.projectId) return "Name the employee or the project, not both";
  if (i.kind === "return_unused" && !i.employeeId && !i.projectId) return "Say whose unused stock this is: an employee or a project";
  if (i.kind === "return_rental" && !i.rentalId) return "Choose the rental";
  if ((i.kind === "pack_kit" || i.kind === "unpack_kit") && !i.kitUnitId) return "Choose the kit";
  if (i.kind === "receive" && i.rental) {
    if (!i.rental.supplierName.trim()) return "Name the rental supplier";
    if (!i.rental.externalReference.trim()) return "Give the supplier's reference for this rental";
    if (!i.rental.returnDeadline) return "Give the date the rental has to go back";
  }
  return null;
}

export interface RpcCall { fn: string; args: Record<string, unknown> }

const orNull = <T,>(v: T | undefined | null | ""): T | null => (v === undefined || v === null || v === "" ? null : v);

/** The database function and arguments for a validated request. */
export function toRpcCall(i: MovementInput): RpcCall {
  const base = { p_company_id: i.companyId, p_key: i.key };
  const loc = { p_location_id: i.locationId };
  const note = { p_note: orNull(i.note?.trim()) };
  switch (i.kind) {
    case "receive":
      return { fn: "inv_receive_stock", args: { ...base, ...loc, p_lines: i.lines, p_rental: i.rental ? { supplier_name: i.rental.supplierName.trim(), external_reference: i.rental.externalReference.trim(), return_deadline: i.rental.returnDeadline, project_id: orNull(i.rental.projectId), note: orNull(i.rental.note?.trim()) } : null, ...note } };
    case "issue":
      return { fn: "inv_issue_to_employee", args: { ...base, ...loc, p_employee_id: i.employeeId, p_lines: i.lines, p_expected_return_at: orNull(i.expectedReturnAt), ...note, p_request_id: orNull(i.requestId) } };
    case "dispatch":
      return { fn: "inv_dispatch_to_project", args: { ...base, ...loc, p_project_id: i.projectId, p_lines: i.lines, p_request_id: orNull(i.requestId), p_expected_return_at: orNull(i.expectedReturnAt), ...note } };
    case "return":
      return i.returnFrom === "project"
        ? { fn: "inv_return_from_project", args: { ...base, ...loc, p_project_id: i.projectId, p_lines: i.lines, ...note } }
        : { fn: "inv_return_from_employee", args: { ...base, ...loc, p_employee_id: i.employeeId, p_lines: i.lines, ...note } };
    case "transfer":
      return { fn: "inv_transfer_dispatch", args: { ...base, p_from_location_id: i.locationId, p_to_location_id: i.toLocationId, p_lines: i.lines, p_expected_at: orNull(i.expectedAt), p_carrier: orNull(i.carrier?.trim()), p_reference: orNull(i.reference?.trim()), ...note } };
    case "receive_transfer":
      return { fn: "inv_transfer_receive", args: { ...base, p_transfer_id: i.transferId, p_lines: i.lines.length > 0 ? i.lines : null, ...note } };
    case "project_transfer":
      return { fn: "inv_transfer_between_projects", args: { ...base, p_from_project_id: i.projectId, p_to_project_id: i.toProjectId, p_lines: i.lines, p_request_id: i.requestId, p_expected_return_at: orNull(i.expectedReturnAt), ...note } };
    case "repair_out":
      return { fn: "inv_repair_out", args: { ...base, ...loc, p_lines: i.lines, p_repair_reference: (i.repairReference ?? "").trim(), p_expected_return_at: orNull(i.expectedReturnAt), ...note } };
    case "repair_in":
      return { fn: "inv_repair_in", args: { ...base, ...loc, p_lines: i.lines, ...note } };
    case "check":
      return { fn: "inv_check_condition", args: { ...base, ...loc, p_lines: i.lines, ...note } };
    case "adjust":
      return { fn: "inv_adjust_stock", args: { ...base, ...loc, p_action: i.adjustAction, p_lines: i.lines, p_reason: (i.reason ?? "").trim() } };
    case "consume":
      return { fn: "inv_consume", args: { ...base, ...loc, p_lines: i.lines, p_employee_id: orNull(i.employeeId), p_project_id: orNull(i.projectId), p_request_id: orNull(i.requestId), ...note } };
    case "return_unused":
      return { fn: "inv_return_unused", args: { ...base, ...loc, p_lines: i.lines, p_employee_id: orNull(i.employeeId), p_project_id: orNull(i.projectId), ...note } };
    case "return_rental":
      return { fn: "inv_return_rental", args: { ...base, ...loc, p_rental_id: i.rentalId, p_lines: i.lines.length > 0 ? i.lines : null, ...note } };
    case "pack_kit":
      return { fn: "inv_pack_kit", args: { ...base, ...loc, p_kit_unit_id: i.kitUnitId, p_lines: i.lines, ...note } };
    case "unpack_kit":
      return { fn: "inv_unpack_kit", args: { ...base, ...loc, p_kit_unit_id: i.kitUnitId, p_lines: i.lines.length > 0 ? i.lines : null, ...note } };
  }
}

const LINE_KEYS_STRING = ["unit_id", "item_id", "bin_id", "condition", "from_condition", "rental_id", "note", "repair_reference", "currency", "location_id", "status", "substitute_item_id", "line_id"];
const LINE_KEYS_NUMBER = ["qty", "unit_cost", "expected_qty"];

/** Keeps only the keys and value types the database functions read, so a forged request cannot smuggle anything else into a function call. */
export function sanitizeLines(raw: unknown): RpcLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).flatMap((r): RpcLine[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const line: RpcLine = {};
    for (const k of LINE_KEYS_STRING) if (typeof o[k] === "string" && o[k] !== "") line[k] = (o[k] as string).slice(0, 500);
    for (const k of LINE_KEYS_NUMBER) if (typeof o[k] === "number" && Number.isFinite(o[k])) line[k] = o[k] as number;
    if (typeof o.is_required === "boolean") (line as Record<string, unknown>).is_required = o.is_required;
    if (Array.isArray(o.serials)) line.serials = o.serials.filter((s): s is string => typeof s === "string").slice(0, 200).map((s) => s.slice(0, 120));
    return Object.keys(line).length > 0 ? [line] : [];
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The review step: what was asked for, in words
// ---------------------------------------------------------------------------------------------------------------

export interface SummaryRow { label: string; value: string }

export interface SummaryInput {
  kind: MovementKind;
  drafts: readonly LineDraft[];
  /** Names, not ids. */
  location: string;
  toLocation?: string;
  employee?: string;
  project?: string;
  toProject?: string;
  request?: string;
  returnFrom?: ReturnFrom;
  expectedReturn?: string;
  expectedArrival?: string;
  repairReference?: string;
  transferCode?: string;
  adjustAction?: AdjustAction;
  rentalSupplier?: string;
  kit?: string;
  note?: string;
  reason?: string;
  /** For returns: how many items the holder has that are not on this list (they stay outstanding). */
  stillOutstanding?: number;
  everything?: boolean;
}

const typedQty = (d: LineDraft): number | null => {
  const n = Number(d.qty.trim().replace(",", "."));
  return d.qty.trim() !== "" && Number.isFinite(n) ? n : null;
};

export function describeLine(d: LineDraft, kind: MovementKind): string {
  const cond = (c: string) => (isUnitLine(d) ? CONDITION_WORDS[c as keyof typeof CONDITION_WORDS] : BALANCE_CONDITION_WORDS[c as keyof typeof BALANCE_CONDITION_WORDS]) ?? c;
  const bits: string[] = [];
  if (isUnitLine(d)) bits.push(`${d.itemName}${d.code ? ` (${d.code})` : ""}`);
  else {
    const n = typedQty(d);
    const unitsOfOne = d.tracking === "individual" || d.tracking === "kit";
    bits.push(n === null ? `? ${d.itemName}` : unitsOfOne ? `${n} × ${d.itemName}` : `${formatQty(n, d.uom)} ${d.itemName}`);
  }
  if (d.binLabel) bits.push(`bin ${d.binLabel}`);
  if (KIND_CONFIG[kind].lineCondition || kind === "check") bits.push(d.condition === "good" ? "good, available" : `${cond(d.condition).toLowerCase()}, held back`);
  if (d.serials.trim()) bits.push(`serial ${parseSerials(d.serials).join(", ")}`);
  return bits.join(", ");
}

export function totalHow(drafts: readonly LineDraft[]): string {
  const units = drafts.filter(isUnitLine).length;
  const parts: string[] = [];
  if (units > 0) parts.push(`${units} individual item${units === 1 ? "" : "s"}`);
  for (const d of drafts.filter((x) => !isUnitLine(x))) {
    const n = typedQty(d);
    if (n === null) continue;
    parts.push(d.tracking === "individual" || d.tracking === "kit" ? `${n} × ${d.itemName}` : `${formatQty(n, d.uom)} ${d.itemName}`);
  }
  return parts.length > 0 ? parts.join("; ") : "Everything that applies";
}

/** From and to, in words, for every kind: what the review step shows. */
export function fromTo(s: SummaryInput): { from: string; to: string } {
  const loc = s.location || "—";
  switch (s.kind) {
    case "receive": return { from: s.rentalSupplier ? `Rental supplier: ${s.rentalSupplier}` : "Outside (new stock)", to: loc };
    case "issue": return { from: loc, to: s.employee ? `Employee: ${s.employee}` : "—" };
    case "dispatch": return { from: loc, to: s.project ? `Project: ${s.project}` : "—" };
    case "return": return { from: s.returnFrom === "project" ? `Project: ${s.project ?? "—"}` : `Employee: ${s.employee ?? "—"}`, to: loc };
    case "transfer": return { from: loc, to: `${s.toLocation ?? "—"} (in transit: not available there until it is received)` };
    case "receive_transfer": return { from: `On the way${s.transferCode ? ` (${s.transferCode})` : ""}`, to: loc };
    case "project_transfer": return { from: `Project: ${s.project ?? "—"}`, to: `Project: ${s.toProject ?? "—"}` };
    case "repair_out": return { from: loc, to: `Out for repair${s.repairReference ? ` (${s.repairReference})` : ""}` };
    case "repair_in": return { from: "At the repairer", to: loc };
    case "check": return { from: loc, to: `${loc} (stays here; condition changes)` };
    case "adjust": return { from: loc, to: s.adjustAction ? ADJUST_WORDS[s.adjustAction].to : "—" };
    case "consume": return { from: loc, to: "Used up" };
    case "return_unused": return { from: s.employee ? `Employee: ${s.employee}` : s.project ? `Project: ${s.project}` : "—", to: loc };
    case "return_rental": return { from: loc, to: `Back to the supplier${s.rentalSupplier ? `: ${s.rentalSupplier}` : ""}` };
    case "pack_kit": return { from: loc, to: `Inside kit ${s.kit ?? ""}`.trim() };
    case "unpack_kit": return { from: `Inside kit ${s.kit ?? ""}`.trim(), to: loc };
  }
}

/** The transaction summary shown before the Confirm button: what, how much, from, to, who, expected return. */
export function summaryRows(s: SummaryInput): SummaryRow[] {
  const { from, to } = fromTo(s);
  const rows: SummaryRow[] = [];
  rows.push({ label: "What", value: s.everything && s.drafts.length === 0 ? "Everything that applies" : s.drafts.map((d) => describeLine(d, s.kind)).join("\n") });
  rows.push({ label: "How much", value: totalHow(s.drafts) });
  rows.push({ label: "From", value: from });
  rows.push({ label: "To", value: to });
  const who = s.employee ?? (s.project ? `Project ${s.project}` : null);
  if (who && (s.kind === "issue" || s.kind === "dispatch" || s.kind === "return" || s.kind === "consume" || s.kind === "return_unused" || s.kind === "project_transfer")) rows.push({ label: "Who", value: s.kind === "dispatch" || s.kind === "project_transfer" ? `Project ${s.project ?? "—"}` : who });
  if (s.request) rows.push({ label: "Request", value: s.request });
  if (s.expectedReturn) rows.push({ label: "Expected return", value: s.expectedReturn });
  if (s.expectedArrival) rows.push({ label: "Expected arrival", value: s.expectedArrival });
  if (s.reason) rows.push({ label: "Reason", value: s.reason });
  if (s.note) rows.push({ label: "Note", value: s.note });
  if (s.kind === "return") {
    const n = s.stillOutstanding ?? 0;
    rows.push({ label: "Still outstanding", value: n > 0 ? `${n} other item${n === 1 ? "" : "s"} stay${n === 1 ? "s" : ""} with ${s.returnFrom === "project" ? "the project" : "the employee"} until you record them coming back` : "Nothing else is outstanding" });
    const held = s.drafts.filter((d) => d.condition !== "good").length;
    if (held > 0) rows.push({ label: "Held back", value: `${held} item${held === 1 ? " is" : "s are"} not in good condition. ${held === 1 ? "It is" : "They are"} held for checking and not available until someone releases ${held === 1 ? "it" : "them"}` });
  }
  if (s.kind === "transfer") rows.push({ label: "Status after", value: "In transit. The other warehouse records it as received." });
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Results in words
// ---------------------------------------------------------------------------------------------------------------

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** One plain sentence about a recorded movement, from what the database function returned. */
export function successMessage(kind: MovementKind, result: unknown): string {
  const r = asRecord(result);
  const code = typeof r.code === "string" ? r.code : null;
  const head = code ? `Recorded as ${code}.` : "Recorded.";
  const lines = Array.isArray(r.lines) ? r.lines.map(asRecord) : [];
  if (kind === "transfer") {
    const t = typeof r.transfer_code === "string" ? r.transfer_code : null;
    return `${head}${t ? ` Transfer ${t} is in transit.` : " The transfer is in transit."} It is not available at the destination until it is received there.`;
  }
  if (kind === "receive_transfer") {
    const left = typeof r.still_on_the_way === "number" ? r.still_on_the_way : 0;
    return `${head} ${left > 0 ? `${left} item${left === 1 ? " is" : "s are"} still on the way, so the transfer stays open.` : "The transfer is complete."}`;
  }
  if (kind === "return" || kind === "repair_in" || kind === "return_unused") {
    const ok = lines.filter((l) => l.available === true).length;
    const held = lines.length - ok;
    return `${head} ${ok > 0 ? `${ok} line${ok === 1 ? " is" : "s are"} available again.` : ""}${held > 0 ? ` ${held} line${held === 1 ? " is" : "s are"} held for checking and not available yet.` : ""}`.trim();
  }
  if (kind === "pack_kit") {
    const missing = Array.isArray(r.missing_required) ? r.missing_required.length : 0;
    return `${head}${missing > 0 ? ` ${missing} required item${missing === 1 ? " is" : "s are"} still missing from the kit.` : " Nothing required is missing."}`;
  }
  if (kind === "receive") {
    const codes = lines.map((l) => (typeof l.code === "string" ? l.code : null)).filter((c): c is string => !!c);
    return `${head}${codes.length > 0 ? ` New IDs: ${codes.slice(0, 12).join(", ")}${codes.length > 12 ? "…" : ""}. Print their labels from the item.` : ""}`;
  }
  return head;
}

/** The answer to "Check whether it went through", in words. */
export function statusMessage(res: unknown): { state: "recorded" | "not_recorded" | "in_progress" | "unknown"; text: string } {
  const r = asRecord(res);
  if (r.found !== true) return { state: "not_recorded", text: "It was not recorded. Nothing changed, so it is safe to send it again." };
  const code = typeof r.movement_code === "string" ? r.movement_code : null;
  if (r.status === "in_progress") return { state: "in_progress", text: "It is still being recorded. Check again in a moment before doing anything else." };
  if (r.status === "recorded") return { state: "recorded", text: `Yes, it went through${code ? `: recorded as ${code}` : ""}. Do not send it again.` };
  return { state: "unknown", text: "The answer was not clear. Check the movements list before sending it again." };
}

/** Is this error one where we do not know whether the movement was saved? */
export const isUncertainFailure = (message: string | null | undefined): boolean => !!message && /did not finish in time|could not confirm|connection/i.test(message);
