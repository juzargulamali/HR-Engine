/**
 * Pure helpers for equipment planning: requests, request lines, planning dates, reservations, availability and Sales checks.
 * No React, no Next, no database: the pages and server actions use these, and the tests exercise them directly. Every number and
 * sentence shown to a person about a request is made here, in one place, from what the Inventory functions return.
 */
import { AVAILABILITY_RESULT_WORDS, REQUEST_STATUS_WORDS, SHORTAGE_WORDS, formatQty } from "./words";

// ---------------------------------------------------------------------------------------------------------------
// Small readers for jsonb results (a function returns jsonb; the page reads it field by field and never trusts its shape)
// ---------------------------------------------------------------------------------------------------------------
export type Json = Record<string, unknown>;
export const asRecord = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
export const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A number as people read it, without a unit. */
export const formatQtyPlain = (n: number): string => formatQty(n);

// ---------------------------------------------------------------------------------------------------------------
// Planning dates
// ---------------------------------------------------------------------------------------------------------------
/** The named phases of a request, in the order a job happens. The keys are exactly what inv_plan_window accepts. */
export const PLAN_FIELDS = [
  { key: "prep_start", label: "Preparation and picking starts" },
  { key: "dispatch", label: "Dispatch and transport" },
  { key: "install_start", label: "Installation starts" },
  { key: "show_start", label: "Show or event starts" },
  { key: "show_end", label: "Show or event ends" },
  { key: "dismantle_end", label: "Dismantling finished" },
  { key: "return_due", label: "Equipment due back" },
  { key: "inspect_until", label: "Inspection finished by" },
] as const;
export type PlanKey = (typeof PLAN_FIELDS)[number]["key"];
export const PLAN_KEYS: readonly PlanKey[] = PLAN_FIELDS.map((f) => f.key);
export const planLabel = (key: string): string => PLAN_FIELDS.find((f) => f.key === key)?.label ?? key;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/;

/**
 * One local date and time as the database wants it ("2030-03-30T12:00"): accepts a space or T, drops seconds, refuses a date that
 * does not exist (31 February). A date without a time is read as 00:00. Returns null when it is not a real local time.
 */
export function normaliseLocal(raw: string): string | null {
  const m = LOCAL_RE.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d, h = "00", mi = "00"] = m.slice(1);
  const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
  const real = probe.getUTCFullYear() === Number(y) && probe.getUTCMonth() === Number(mo) - 1 && probe.getUTCDate() === Number(d) && Number(h) < 24 && Number(mi) < 60;
  return real ? `${y}-${mo}-${d}T${h}:${mi}` : null;
}

/**
 * What the plan form sends. Only the fields that were filled in are kept (an empty field means "no date for this phase"), every one is
 * checked to be a real local time, and nothing carries an offset: the request's time zone turns them into instants in the database.
 */
export function parsePlanInput(values: Record<string, unknown>): { plan: Record<string, string>; error: string | null } {
  const plan: Record<string, string> = {};
  for (const { key, label } of PLAN_FIELDS) {
    const raw = values[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const local = normaliseLocal(String(raw));
    if (!local) return { plan: {}, error: `"${label}" is not a real date and time. Use the date and time boxes.` };
    plan[key] = local;
  }
  return { plan, error: null };
}

/** The values to put back in the form (datetime-local boxes use the same "YYYY-MM-DDTHH:MM" text the database stores). */
export function planToFormValues(plan: unknown): Record<PlanKey, string> {
  const p = asRecord(plan);
  const out = {} as Record<PlanKey, string>;
  for (const k of PLAN_KEYS) out[k] = normaliseLocal(String(p[k] ?? "")) ?? "";
  return out;
}

/** A gentle note when the dates look out of order (never a block: the database only needs the earliest and the latest). */
export function planOrderWarning(plan: Record<string, string>): string | null {
  const ordered = PLAN_FIELDS.flatMap((f) => (plan[f.key] ? [{ label: f.label, at: plan[f.key] as string }] : []));
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1];
    const b = ordered[i];
    if (a && b && b.at < a.at) return `"${b.label}" is earlier than "${a.label}". Check the dates; they are saved as you wrote them.`;
  }
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "30 Mar 2030, 12:00" from a local "YYYY-MM-DDTHH:MM" (never routed through a time zone: it already is local). */
export function formatLocalPlan(local: string | null | undefined): string {
  const n = local ? normaliseLocal(local) : null;
  if (!n) return "—";
  const [date = "", time = ""] = n.split("T");
  const [y, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}, ${time}`;
}

/** An instant shown in a named time zone: "30 Mar 2030, 12:00". Falls back to UTC if the zone is unknown. */
export function formatInZone(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const parts = zoneParts(t.getTime(), timeZone);
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

function zoneParts(ms: number, timeZone: string): Record<"year" | "month" | "day" | "hour" | "minute" | "second", string> {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== "literal") out[p.type] = p.value;
  return out as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

/** The calendar date (YYYY-MM-DD) an instant falls on in a zone. */
export function localDateIn(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const p = zoneParts(t, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function zoneOffsetMs(ms: number, timeZone: string): number {
  const p = zoneParts(ms, timeZone);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(ms / 1000) * 1000;
}

/**
 * A local wall-clock time in a named zone as an instant (ISO, UTC). Daylight saving is handled by checking the zone's offset at the
 * answer, not at the guess. Used for the Availability dialog; plan dates are converted by the database (inv_local_to_utc). A time that
 * does not exist (spring forward) or happens twice (fall back) resolves to the later offset, like the database.
 */
export function zonedLocalToUtcIso(local: string, timeZone: string): string | null {
  const n = normaliseLocal(local);
  if (!n) return null;
  const m = LOCAL_RE.exec(n)!;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  const first = guess - zoneOffsetMs(guess, timeZone);
  const second = guess - zoneOffsetMs(first, timeZone);
  return new Date(second).toISOString();
}

/** "30 Mar 2030, 08:00 to 2 Apr 2030, 20:00 (Asia/Dubai)", or what is missing, in the request's own zone. */
export function windowLabel(r: { needed_from: string | null; needed_until: string | null; timezone: string }): string {
  if (!r.needed_from && !r.needed_until) return "Dates not set";
  if (r.needed_from && !r.needed_until) return `From ${formatInZone(r.needed_from, r.timezone)} (${r.timezone}), no end date yet`;
  return `${formatInZone(r.needed_from, r.timezone)} to ${formatInZone(r.needed_until, r.timezone)} (${r.timezone})`;
}

// ---------------------------------------------------------------------------------------------------------------
// Request lines, reservations and progress (mirrors inv_line_progress and inv_refresh_request_status)
// ---------------------------------------------------------------------------------------------------------------
export interface ReservationLite {
  id: string;
  request_line_id: string;
  unit_id: string | null;
  qty: number | string;
  dispatched_qty: number | string;
  returned_qty: number | string;
  status: "active" | "released" | "completed";
  /** The reserved range as the database stores it (a tstzrange text) or already split. */
  reserved_during?: string | null;
  from?: string | null;
  until?: string | null;
  location_id?: string | null;
  unit_code?: string | null;
  serial_number?: string | null;
  released_reason?: string | null;
}

/** `["2030-03-30 08:00:00+00","2030-04-02 20:00:00+00")` to two ISO instants. */
export function parseRange(range: string | null | undefined): { from: string | null; until: string | null } {
  if (!range) return { from: null, until: null };
  const m = /^[[(]\s*"?([^",]*)"?\s*,\s*"?([^",)\]]*)"?\s*[)\]]$/.exec(range.trim());
  if (!m) return { from: null, until: null };
  const iso = (s: string) => {
    if (!s) return null;
    const t = new Date(s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  };
  return { from: iso(m[1] ?? ""), until: iso(m[2] ?? "") };
}

export interface LineLite { id: string; qty: number | string; status: "open" | "cancelled" | "closed" }
export interface RequestLite { status: string; needed_from: string | null; needed_until: string | null }
export interface LineProgress {
  reserved: number;
  /** What truly covers the whole request window (a line left on old dates after a refused change counts as short). */
  reservedForWindow: number;
  dispatched: number;
  returned: number;
  /** Out and not yet back. Stays outstanding after a cancellation or a completed project until a return is recorded. */
  outstanding: number;
  /** What is still to reserve for this line (what inv_reserve would take). */
  toReserve: number;
  shortage: number;
}

export function lineProgress(line: LineLite, request: RequestLite, reservations: readonly ReservationLite[]): LineProgress {
  const qty = num(line.qty);
  const from = request.needed_from ? new Date(request.needed_from).getTime() : null;
  const until = request.needed_until ? new Date(request.needed_until).getTime() : null;
  let reserved = 0, window = 0, dispatched = 0, returned = 0;
  for (const r of reservations) {
    if (r.request_line_id !== line.id || (r.status !== "active" && r.status !== "completed")) continue;
    const range = r.from !== undefined || r.until !== undefined ? { from: r.from ?? null, until: r.until ?? null } : parseRange(r.reserved_during);
    const lo = range.from ? new Date(range.from).getTime() : null;
    const hi = range.until ? new Date(range.until).getTime() : null;
    reserved += num(r.qty);
    dispatched += num(r.dispatched_qty);
    returned += num(r.returned_qty);
    if (from !== null && until !== null && hi !== null && lo !== null && ((num(r.dispatched_qty) > 0 && hi >= until) || (lo <= from && hi >= until))) window += num(r.qty);
  }
  const live = line.status === "open" && (request.status === "submitted" || request.status === "in_progress");
  return { reserved, reservedForWindow: window, dispatched, returned, outstanding: Math.max(0, dispatched - returned), toReserve: Math.max(0, qty - reserved), shortage: live ? Math.max(0, qty - window) : 0 };
}

/** The database's own progress numbers for a line (inv_project_equipment), where a page has them: they take the place of the local sum. */
export function progressFromDb(p: unknown, qty: number): LineProgress | null {
  const x = asRecord(p);
  if (!("reserved" in x) || !("dispatched" in x)) return null;
  const reserved = num(x.reserved);
  return { reserved, reservedForWindow: num(x.reserved_for_window), dispatched: num(x.dispatched), returned: num(x.returned), outstanding: num(x.outstanding), toReserve: Math.max(0, qty - reserved), shortage: num(x.shortage) };
}

/** Is the line finished: everything asked for has gone out (or the whole request has). Cancelled lines are neither done nor counted. */
export function isLineDone(line: LineLite, request: RequestLite, progress: LineProgress): boolean {
  if (line.status === "cancelled") return false;
  if (request.status === "fulfilled" || request.status === "closed") return true;
  return num(line.qty) > 0 && progress.dispatched >= num(line.qty);
}

export interface RequestSummary { done: number; total: number; shortageLines: number; outstanding: number }

export function summariseRequest(request: RequestLite, lines: readonly LineLite[], reservations: readonly ReservationLite[]): RequestSummary {
  let done = 0, total = 0, shortageLines = 0, outstanding = 0;
  for (const l of lines) {
    const p = lineProgress(l, request, reservations);
    // A cancelled line is not counted, but equipment already dispatched for it stays outstanding until it is returned.
    outstanding += p.outstanding;
    if (l.status === "cancelled") continue;
    total += 1;
    if (isLineDone(l, request, p)) done += 1;
    if (p.shortage > 0) shortageLines += 1;
  }
  return { done, total, shortageLines, outstanding };
}

export const isRequestEditable = (status: string) => status === "draft" || status === "submitted" || status === "in_progress";
export const requestStatusLabel = (status: string) => REQUEST_STATUS_WORDS[status] ?? status;

// ---------------------------------------------------------------------------------------------------------------
// Substitutions: nothing is assumed interchangeable; a proposed substitute is always marked until it is accepted
// ---------------------------------------------------------------------------------------------------------------
export interface SubstitutionInfo { state: "none" | "proposed" | "accepted" | "declined"; label: string | null; detail: string | null; tone: "none" | "warn" | "good" | "plain" }

export function substitutionInfo(line: { substitution_status: string; original_item_name?: string | null; item_name?: string | null }): SubstitutionInfo {
  const original = line.original_item_name || "the standard item";
  switch (line.substitution_status) {
    case "proposed":
      return {
        state: "proposed", tone: "warn", label: "Substitute — not yet accepted",
        detail: `The warehouse keeps preparing ${original} until the project manager accepts ${line.item_name || "the substitute"}.`,
      };
    case "accepted": return { state: "accepted", tone: "good", label: "Substitute accepted", detail: `${line.item_name || "The substitute"} replaces ${original}.` };
    case "declined": return { state: "declined", tone: "plain", label: "Substitute declined", detail: `${original} stays on the line.` };
    default: return { state: "none", tone: "none", label: null, detail: null };
  }
}

export const shortageLabel = (action: string | null | undefined): string => SHORTAGE_WORDS[action ?? "none"] ?? "—";

// ---------------------------------------------------------------------------------------------------------------
// Technology templates: the slots a template offers when it is added to a request
// ---------------------------------------------------------------------------------------------------------------
export interface TemplateComponent { id: string; item_id: string; qty: number | string; alt_group: string | null; is_optional: boolean; sort_order: number }
export interface TemplateSlot {
  key: string;
  altGroup: string | null;
  optional: boolean;
  /** The standard choice first (lowest sort order), then the listed alternatives. */
  options: { itemId: string; name: string; qty: number }[];
}

export function templateSlots(components: readonly TemplateComponent[], itemName: (id: string) => string): TemplateSlot[] {
  const sorted = [...components].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const slots = new Map<string, TemplateSlot>();
  for (const c of sorted) {
    const key = c.alt_group ?? `component:${c.id}`;
    const slot = slots.get(key) ?? { key, altGroup: c.alt_group, optional: c.is_optional, options: [] };
    slot.options.push({ itemId: c.item_id, name: itemName(c.item_id), qty: num(c.qty) });
    slots.set(key, slot);
  }
  return [...slots.values()];
}

/** The {group: item} choices inv_expand_technology takes: only groups where a choice was made, and only groups the template has. */
export function expandChoices(slots: readonly TemplateSlot[], selection: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of slots) {
    if (!s.altGroup) continue;
    const chosen = selection[s.altGroup];
    if (chosen && s.options.some((o) => o.itemId === chosen)) out[s.altGroup] = chosen;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// What the functions answer, in words
// ---------------------------------------------------------------------------------------------------------------
const nameOrItem = (v: unknown) => str(v) ?? "An item";

/** The result of changing the dates of a submitted request: what moved, and what could not, in plain words. Nothing is silently displaced. */
export function windowChangeMessages(result: unknown, timeZone: string): { summary: string; conflicts: string[]; hasConflicts: boolean } {
  const r = asRecord(result);
  const moved = asArray(r.extended).length;
  const conflicts = asArray(r.conflicts).map((c) => {
    const x = asRecord(c);
    const kept = asRecord(x.kept_window);
    const shortage = num(x.shortage);
    const keptText = kept.from ? ` It keeps its earlier dates (${formatInZone(str(kept.from), timeZone)} to ${formatInZone(str(kept.until), timeZone)}).` : "";
    const why = str(x.reason) ? ` ${str(x.reason)}.` : "";
    return `${nameOrItem(x.item_name)} was not moved to the new dates${shortage > 0 ? ` (${formatQty(shortage)} short)` : ""}.${keptText}${why} Nobody else's reservation was touched.`.replace(/\.\./g, ".");
  });
  const base = "The new dates are saved.";
  const parts = [base];
  if (moved > 0) parts.push(`${moved} ${moved === 1 ? "line has" : "lines have"} its reservations moved to the new dates.`);
  if (conflicts.length > 0) parts.push(`${conflicts.length} ${conflicts.length === 1 ? "line could" : "lines could"} not move and needs the warehouse to sort it out.`);
  return { summary: parts.join(" "), conflicts, hasConflicts: conflicts.length > 0 };
}

/** The answer to a Reserve: what was reserved, what is still needed and what the shortage was marked as. A partial result is fine. */
export function reserveMessage(result: unknown): { text: string; partial: boolean; reservedNow: number } {
  const r = asRecord(result);
  const now = num(r.reserved_now);
  const requested = num(r.requested);
  const still = num(r.still_needed);
  const name = str(r.item_name) ?? "the item";
  const codes = asArray(r.reservations).map((x) => str(asRecord(x).unit_code)).filter((c): c is string => !!c);
  const head = now > 0 ? `Reserved ${formatQty(now)} of ${formatQty(requested)} ${name}${codes.length > 0 ? ` (${codes.join(", ")})` : ""}.` : `Nothing could be reserved: none of ${name} is free for these dates at this location.`;
  const partial = now < requested;
  const tail: string[] = [];
  if (partial) tail.push(`${formatQty(num(r.shortage))} ${num(r.shortage) === 1 ? "is" : "are"} not available here for the dates. Partial fulfilment is fine: reserve the rest from another location, or mark it to buy or rent.`);
  if (still > 0) tail.push(`${formatQty(still)} still needed on this line.`);
  const need = asRecord(r.need);
  if (str(need.action)) tail.push(`Marked: ${shortageLabel(str(need.action))}${str(need.rental_reference) ? ` (reference ${str(need.rental_reference)})` : ""}.`);
  return { text: [head, ...tail].join(" "), partial, reservedNow: now };
}

/** Cancelling a request or a line: what was released, and the plain fact that equipment already dispatched stays outstanding. */
export function cancelMessage(result: unknown, what: "request" | "line"): string {
  const r = asRecord(result);
  const released = num(r.released_qty);
  const out = num(r.outstanding_qty);
  const parts = [`The ${what} is cancelled.`];
  parts.push(released > 0 ? `${formatQty(released)} reserved but unused ${released === 1 ? "was" : "were"} released.` : "Nothing reserved was waiting to be released.");
  if (out > 0) parts.push(`${formatQty(out)} already dispatched ${out === 1 ? "stays" : "stay"} outstanding until ${out === 1 ? "it is" : "they are"} returned. Cancelling does not bring equipment back.`);
  return parts.join(" ");
}

export function expandMessage(result: unknown, technologyName: string, multiplier: number): string {
  const r = asRecord(result);
  const n = asArray(r.line_ids).length;
  const alts = asArray(r.offered_alternatives).length;
  return `Added ${n} ${n === 1 ? "line" : "lines"} from "${technologyName}"${multiplier !== 1 ? ` × ${formatQty(multiplier)}` : ""}. The lines are a snapshot of the template as it is today: later changes to the template do not change them. You can adjust the quantities.${alts > 0 ? ` ${alts} ${alts === 1 ? "line has" : "lines have"} listed alternatives you can propose as a substitute.` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Availability, in words. "Now" and "for those dates" are different questions and are never mixed.
// ---------------------------------------------------------------------------------------------------------------
export type Tone = "good" | "warn" | "bad" | "plain";
export interface AvailabilityLine { label: string; value: string; note?: string; tone: Tone }
export interface ItemAvailabilityWords {
  title: string;
  now: AvailabilityLine[];
  range: AvailabilityLine[];
  overdue: { count: number; text: string } | null;
  basisNote: string;
  units: { id: string; code: string; serial: string | null; free: boolean; reason: string | null }[];
}

export function itemAvailabilityWords(result: unknown, timeZone: string): ItemAvailabilityWords {
  const r = asRecord(result);
  const unit = str(r.unit_of_measure) ?? "each";
  const q = (v: unknown) => formatQty(num(v), unit);
  const loc = str(r.location_name) ?? "this location";
  const overdue = num(r.overdue);
  const usable = num(r.usable_now);
  const free = num(r.free_for_range);
  const back = num(r.returning_on_time);
  const rangeText = `${formatInZone(str(r.from), timeZone)} to ${formatInZone(str(r.until), timeZone)} (${timeZone})`;
  const now: AvailabilityLine[] = [
    { label: "Physically at this location", value: q(r.physical_at_location), tone: "plain" },
    { label: "Usable now", value: q(usable), note: "In the warehouse, in good or fair condition, not packed in a kit.", tone: usable > 0 ? "good" : "warn" },
    { label: "Awaiting inspection", value: q(r.awaiting_inspection), tone: num(r.awaiting_inspection) > 0 ? "warn" : "plain" },
    { label: "Damaged, in repair or missing", value: q(r.damaged_repair_missing), tone: num(r.damaged_repair_missing) > 0 ? "warn" : "plain" },
    { label: "Out on projects", value: q(r.dispatched_to_projects), tone: "plain" },
    { label: "With employees", value: q(r.assigned_to_employees), tone: "plain" },
    { label: "In transit", value: q(r.in_transit), tone: "plain" },
  ];
  if (num(r.draft_unverified) > 0) now.push({ label: "Not counted yet (draft records)", value: q(r.draft_unverified), note: "Never offered until counted and verified.", tone: "warn" });
  const range: AvailabilityLine[] = [
    { label: "Reserved for these dates", value: q(r.reserved_in_range), tone: "plain" },
    { label: "Free for these dates", value: q(free), note: back > 0 ? `Includes ${q(back)} expected back on time before the dates start.` : undefined, tone: free > 0 ? "good" : "bad" },
  ];
  if (num(r.rental_free_for_range) > 0) range.push({ label: "Rental stock free for these dates", value: q(r.rental_free_for_range), note: "Rented in, counted apart from owned stock.", tone: "plain" });
  return {
    title: `${str(r.item_name) ?? "Item"} at ${loc}`,
    now,
    range: [{ label: "The dates asked about", value: rangeText, tone: "plain" }, ...range],
    overdue: overdue > 0 ? { count: overdue, text: `${q(overdue)} ${overdue === 1 ? "is" : "are"} overdue (not back when promised). Overdue equipment is flagged and is never counted as ready.` } : null,
    basisNote: r.basis === "now" ? "These dates start now or earlier, so “free” means free today." : "These dates are in the future. The first block is how things stand right now; the second block is what is free for the dates.",
    units: asArray(r.units).map((u) => {
      const x = asRecord(u);
      return { id: String(x.unit_id ?? ""), code: String(x.code ?? ""), serial: str(x.serial_number), free: x.free === true, reason: str(x.reason) };
    }),
  };
}

export interface TechnologyRowWords { item: string; needed: string; free: string; status: string; tone: Tone; optional: boolean; note: string | null }
export interface TechnologyAvailabilityWords { headline: string; tone: Tone; rows: TechnologyRowWords[]; shortages: string[]; needsSubstitution: boolean; message: string | null }

export function technologyAvailabilityWords(result: unknown): TechnologyAvailabilityWords {
  const r = asRecord(result);
  const res = str(r.result) ?? "check_required";
  const headline = AVAILABILITY_RESULT_WORDS[res] ?? res;
  const tone: Tone = res === "available" ? "good" : res === "short" ? "bad" : "warn";
  const rows = asArray(r.rows).map((row): TechnologyRowWords => {
    const x = asRecord(row);
    const status = str(x.status) ?? "short";
    const alts = asArray(x.alternatives).map(asRecord);
    const alt = alts.find((a) => str(a.item_id) === str(x.alternative_item_id));
    const label: Record<string, string> = {
      available: "Enough free",
      alternative: `Standard item short by ${formatQty(num(x.short))}; ${str(alt?.item_name) ?? "a listed alternative"} would cover it (a substitute the project must accept)`,
      partial: `Only ${formatQty(num(x.free))} free, short by ${formatQty(num(x.short))}`,
      short: "None free for these dates",
    };
    return {
      item: str(x.item_name) ?? "Item", needed: formatQty(num(x.needed)), free: formatQty(num(x.free)), status: label[status] ?? status,
      tone: status === "available" ? "good" : status === "short" ? "bad" : "warn", optional: x.is_optional === true,
      note: x.is_optional === true ? "Optional: does not change the result" : null,
    };
  });
  const shortages = asArray(r.shortages).map((s) => {
    const x = asRecord(s);
    return `${str(x.item_name) ?? "Item"}: short by ${formatQty(num(x.short))}${x.covered_by_alternative === true ? " (a listed alternative would cover it)" : ""}`;
  });
  return { headline, tone, rows, shortages, needsSubstitution: r.needs_substitution === true, message: str(r.message) };
}

// ---------------------------------------------------------------------------------------------------------------
// Sales: what the enquiry panel says about the warehouse check
// ---------------------------------------------------------------------------------------------------------------
export interface SalesSummaryRow { name: string; qty: string; status: string; tone: Tone; shortages: string[]; alternatives: string[] }
export interface SalesCheckView {
  state: "none" | "pending" | "checked";
  headline: string;
  tone: Tone | "info";
  outOfDate: boolean;
  checkedBy: string | null;
  checkedAt: string | null;
  locationName: string | null;
  note: string | null;
  pendingBy: string | null;
  pendingAt: string | null;
  rows: SalesSummaryRow[];
  /** True when any technology could not be checked from a complete template. */
  warehouseCheckRequired: boolean;
}

export function salesCheckView(data: unknown): SalesCheckView | null {
  const d = asRecord(data);
  const state = d.state === "pending" || d.state === "checked" || d.state === "none" ? d.state : null;
  if (!state) return null;
  const latest = asRecord(d.latest);
  const pending = asRecord(d.pending);
  const rows: SalesSummaryRow[] = asArray(latest.summary).map((s) => {
    const x = asRecord(s);
    const status = str(x.status) ?? "check_required";
    const text = status === "check_required" ? "Warehouse check required" : (AVAILABILITY_RESULT_WORDS[status] ?? str(x.message) ?? status);
    return {
      name: str(x.technology) ?? "Technologies",
      qty: x.qty !== undefined && x.qty !== null ? formatQty(num(x.qty)) : "",
      status: text,
      tone: status === "available" ? "good" : status === "short" ? "bad" : "warn",
      shortages: asArray(x.shortages).map((sh) => `${str(asRecord(sh).item_name) ?? "Item"}: short by ${formatQty(num(asRecord(sh).short))}`),
      alternatives: asArray(x.alternatives).map((a) => `${str(asRecord(a).use) ?? "A listed alternative"} instead of ${str(asRecord(a).instead_of) ?? "the standard item"} (the project must accept the substitute)`),
    };
  });
  const outOfDate = state === "checked" && d.needs_recheck === true;
  const result = str(latest.result);
  const anyUnchecked = rows.some((r) => r.status === "Warehouse check required");
  let headline: string;
  let tone: SalesCheckView["tone"];
  if (state === "none") { headline = "Warehouse check required"; tone = "warn"; }
  else if (state === "pending") { headline = "Warehouse check asked for"; tone = "info"; }
  else {
    headline = AVAILABILITY_RESULT_WORDS[result ?? "check_required"] ?? "Warehouse check required";
    // Green only for a current, complete "available": a check that is out of date, or that has any technology without a complete template, is never green.
    tone = result === "available" && !outOfDate && !anyUnchecked ? "good" : result === "short" ? "bad" : "warn";
  }
  return {
    state, headline, tone, outOfDate, checkedBy: str(latest.checked_by), checkedAt: str(latest.checked_at), locationName: str(latest.location_name), note: str(latest.note),
    pendingBy: str(pending.requested_by), pendingAt: str(pending.requested_at), rows, warehouseCheckRequired: state === "none" || result === "check_required" || anyUnchecked,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Requests list: filtering and sorting (done on the loaded rows, like the Sales enquiries list)
// ---------------------------------------------------------------------------------------------------------------
export interface RequestListRow {
  id: string; code: string; kind: "project" | "employee"; title: string | null; status: string; forLabel: string; projectId: string | null; employeeId: string | null; destination: string | null;
  timezone: string; needed_from: string | null; needed_until: string | null; pickup_location_id: string | null; requestedByName: string;
  done: number; total: number; shortageLines: number; created_at: string;
}
export interface RequestFilters { q: string; status: string; kind: string; location: string; from: string; until: string }

export function filterRequests(rows: readonly RequestListRow[], f: RequestFilters): RequestListRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    // No choice means the requests still in play (not closed, not cancelled); "all" shows everything.
    if (f.status === "") {
      if (r.status === "closed" || r.status === "cancelled") return false;
    } else if (f.status !== "all" && r.status !== f.status) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.location && r.pickup_location_id !== f.location) return false;
    if (f.from || f.until) {
      const a = localDateIn(r.needed_from, r.timezone);
      const b = localDateIn(r.needed_until, r.timezone) ?? a;
      if (!a || !b) return false;
      if (f.from && b < f.from) return false;
      if (f.until && a > f.until) return false;
    }
    if (q && ![r.code, r.title, r.forLabel, r.destination, r.requestedByName].some((t) => (t ?? "").toLowerCase().includes(q))) return false;
    return true;
  });
}

export type RequestSortKey = "code" | "for" | "needed" | "status";
export const REQUEST_SORT_KEYS: readonly RequestSortKey[] = ["code", "for", "needed", "status"];
const STATUS_ORDER: Record<string, number> = { in_progress: 0, submitted: 1, draft: 2, fulfilled: 3, closed: 4, cancelled: 5 };

export function sortRequests(rows: readonly RequestListRow[], sort: { key: RequestSortKey; dir: "asc" | "desc" }): RequestListRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const cmp = (a: RequestListRow, b: RequestListRow): number => {
    switch (sort.key) {
      case "code": return sign * a.code.localeCompare(b.code, undefined, { numeric: true });
      case "for": return sign * a.forLabel.localeCompare(b.forLabel, undefined, { sensitivity: "base" });
      case "status": return sign * ((STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
      case "needed": {
        // Requests without dates always go last, whatever the direction.
        if (!a.needed_from && !b.needed_from) return 0;
        if (!a.needed_from) return 1;
        if (!b.needed_from) return -1;
        return sign * a.needed_from.localeCompare(b.needed_from);
      }
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) || a.code.localeCompare(b.code, undefined, { numeric: true }));
}

// ---------------------------------------------------------------------------------------------------------------
// Equipment held by employees: one row per person
// ---------------------------------------------------------------------------------------------------------------
export interface HeldItem {
  itemName: string; code: string | null; serial: string | null; qty: string; issuedAt: string | null; expectedReturnAt: string | null;
  condition: string; overdue: boolean; kind: string;
}
export interface EmployeeHolding {
  employeeId: string; name: string; number: string; left: boolean; removed: boolean; status: string; terminationDate: string | null;
  items: HeldItem[]; since: string | null; nextReturn: string | null; overdueCount: number;
}

export interface OutstandingLike {
  employee_id: string; display_name: string; employee_number: string; employment_status: string; termination_date: string | null; is_active: boolean;
  is_removed: boolean; holding_kind: string; code: string | null; item_name: string; serial_number: string | null; qty: number | string; unit_of_measure: string;
  issued_at: string | null; expected_return_at: string | null; condition: string; is_overdue: boolean;
}

export function groupOutstanding(rows: readonly OutstandingLike[]): EmployeeHolding[] {
  const by = new Map<string, EmployeeHolding>();
  for (const r of rows) {
    const g = by.get(r.employee_id) ?? {
      employeeId: r.employee_id, name: r.display_name, number: r.employee_number, left: !r.is_active || r.is_removed, removed: r.is_removed,
      status: r.employment_status, terminationDate: r.termination_date, items: [], since: null, nextReturn: null, overdueCount: 0,
    };
    g.items.push({
      itemName: r.item_name, code: r.code, serial: r.serial_number, qty: formatQty(r.qty, r.unit_of_measure), issuedAt: r.issued_at, expectedReturnAt: r.expected_return_at,
      condition: r.condition, overdue: r.is_overdue, kind: r.holding_kind,
    });
    if (r.issued_at && (!g.since || r.issued_at < g.since)) g.since = r.issued_at;
    if (r.expected_return_at && (!g.nextReturn || r.expected_return_at < g.nextReturn)) g.nextReturn = r.expected_return_at;
    if (r.is_overdue) g.overdueCount += 1;
    by.set(r.employee_id, g);
  }
  // People who have left first (their equipment is the easiest to lose track of), then overdue, then by name.
  return [...by.values()].sort((a, b) => Number(b.left) - Number(a.left) || Number(b.overdueCount > 0) - Number(a.overdueCount > 0) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function filterHoldings(groups: readonly EmployeeHolding[], f: { q: string; onlyLeft: boolean; overdueOnly?: boolean }): EmployeeHolding[] {
  const q = f.q.trim().toLowerCase();
  return groups.filter((g) => {
    if (f.onlyLeft && !g.left) return false;
    if (f.overdueOnly && g.overdueCount === 0) return false;
    if (!q) return true;
    return [g.name, g.number, ...g.items.flatMap((i) => [i.itemName, i.code, i.serial])].some((t) => (t ?? "").toLowerCase().includes(q));
  });
}

/** A plain YYYY-MM-DD date as "23 Oct 2026" (as written: no time zone shifts it). Anything else is returned as it is. */
function plainDateWords(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}

/** "Left the company" wording that is true for both a removed record and a past termination date. */
export function leftLabel(g: Pick<EmployeeHolding, "removed" | "status" | "terminationDate">): string {
  if (g.removed) return "Record removed";
  if (g.terminationDate) return `Left on ${plainDateWords(g.terminationDate)}`;
  return g.status === "terminated" || g.status === "resigned" ? "Has left" : "Not active";
}

// ---------------------------------------------------------------------------------------------------------------
// Sales checks waiting for the warehouse (inv_pending_sales_checks: the least about an enquiry that is needed to answer it)
// ---------------------------------------------------------------------------------------------------------------
export interface PendingSalesCheck {
  check_id: string;
  opportunity_id: string;
  company_id: string;
  reference: string;
  requested_at: string;
  requested_by: string;
  location_id: string | null;
  location_name: string | null;
  install_start: string | null;
  event_start: string | null;
  event_end: string | null;
  technologies: { name: string; qty: number | string }[];
}

/** "Laptop × 2, LED wall × 1"; nothing listed says so in words (the check then reads "Warehouse check required"). */
export function pendingTechnologies(c: Pick<PendingSalesCheck, "technologies">): string {
  const list = (c.technologies ?? []).filter((t) => t && String(t.name ?? "").trim() !== "");
  if (list.length === 0) return "No technologies listed yet";
  return list.map((t) => `${String(t.name).trim()} × ${formatQty(t.qty, "")}`.trim()).join(", ");
}

/** The dates Sales gave, in the order they happen; "Dates not set" when there are none. */
export function pendingDates(c: Pick<PendingSalesCheck, "install_start" | "event_start" | "event_end">): string {
  const day = (v: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${v}T00:00:00Z`));
  const parts: string[] = [];
  if (c.install_start) parts.push(`Install ${day(c.install_start)}`);
  if (c.event_start && c.event_end && c.event_start !== c.event_end) parts.push(`Event ${day(c.event_start)} to ${day(c.event_end)}`);
  else if (c.event_start || c.event_end) parts.push(`Event ${day((c.event_start ?? c.event_end) as string)}`);
  return parts.length > 0 ? parts.join(" · ") : "Dates not set";
}
