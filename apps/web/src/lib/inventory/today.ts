/**
 * Today: the warehouse's work queue, one row per job. Pure (no React, no Next, no database): the loaders in `today-data.ts` read plain
 * records and hand them to the builders here, and the tests exercise them directly.
 *
 * Rules the queue follows (docs/inventory-simplification.md, section 3):
 *  - a row is built only from a record's OWN data. A date is the record's own date, in the warehouse's time zone; a row without a date is
 *    never given an invented deadline (it sits under "Waiting, no date set");
 *  - quantities of different units are never added: work is described in lines and items;
 *  - one source that could not be read is reported as failed, never as an empty list or a zero count.
 */
import { pendingDates, pendingTechnologies, zonedLocalToUtcIso } from "./planning";
import { ageText, differenceLineNumbers, noteKindWord, reasonWord, type NoteLine, type NoteView } from "./project-notes";

/* ---------- kinds, filters, sources ---------- */

/**
 * "waiting" is stock that has to be bought or rented before a request line can be finished; "held" is a unit held back for checking; "difference" is a dispatch note or return
 * checklist whose Project Manager reported a difference that the warehouse has not answered. All three stay visible until they are dealt with.
 */
export type QueueKind = "prepare" | "send" | "returns" | "transfer" | "sales" | "waiting" | "held" | "difference";
export type SourceKey = "requests" | "returns" | "transfers" | "sales" | "held" | "differences";
export const SOURCE_OF: Record<QueueKind, SourceKey> = { prepare: "requests", send: "requests", returns: "returns", transfer: "transfers", sales: "sales", waiting: "requests", held: "held", difference: "differences" };
/** What a failed source is called in the red banner. */
export const SOURCE_NOUN: Record<SourceKey, string> = { requests: "Equipment requests", returns: "Equipment due back", transfers: "Incoming transfers", sales: "Sales checks", held: "Equipment held for checking", differences: "Differences reported on dispatch and return notes" };
export const SOURCE_KEYS: readonly SourceKey[] = ["requests", "returns", "transfers", "sales", "held", "differences"];

export type ShowFilter = "all" | QueueKind;
export const SHOW_FILTERS: readonly ShowFilter[] = ["all", "prepare", "send", "returns", "transfer", "sales", "waiting", "held", "difference"];
export const FILTER_LABEL: Record<ShowFilter, string> = { all: "Everything", prepare: "Prepare", send: "Send out", returns: "Receive back", transfer: "Transfers", sales: "Sales checks", waiting: "Waiting / Shortages", held: "Held for checking", difference: "PM reported a difference" };

/** Anything that is not a known value is ignored rather than trusted from the address. */
export const parseShow = (raw: string): ShowFilter => ((SHOW_FILTERS as readonly string[]).includes(raw) ? (raw as ShowFilter) : "all");

export const FAILURE_TAIL = "The list below may be missing them; it is not an empty queue.";
export const failureMessage = (s: SourceKey) => `${SOURCE_NOUN[s]} could not be loaded. ${FAILURE_TAIL}`;

/* ---------- dates: calendar days in the warehouse's time zone ---------- */

const formatters = new Map<string, Intl.DateTimeFormat>();
/** A time zone name Intl accepts, or UTC: an unknown name must never break the page. */
export function safeZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  try { new Intl.DateTimeFormat("en-GB", { timeZone: zone }); return zone; } catch { return "UTC"; }
}
function fmt(zone: string, kind: "ymd" | "day" | "time"): Intl.DateTimeFormat {
  const key = `${zone}|${kind}`;
  let f = formatters.get(key);
  if (!f) {
    const base = { timeZone: safeZone(zone) } as const;
    f = kind === "ymd" ? new Intl.DateTimeFormat("en-GB", { ...base, year: "numeric", month: "2-digit", day: "2-digit" })
      : kind === "day" ? new Intl.DateTimeFormat("en-GB", { ...base, weekday: "short", day: "numeric", month: "short" })
      : new Intl.DateTimeFormat("en-GB", { ...base, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(key, f);
  }
  return f;
}
const part = (f: Intl.DateTimeFormat, ms: number, type: string) => f.formatToParts(new Date(ms)).find((p) => p.type === type)?.value ?? "";

/** Joins the parts ourselves: Node and the browser disagree on punctuation ("Fri 16 Oct" or "Fri, 16 Oct"), which would break hydration. */
export const fmtDay = (iso: string, zone: string) => { const f = fmt(zone, "day"), ms = Date.parse(iso); return ["weekday", "day", "month"].map((t) => part(f, ms, t)).join(" "); };
export const fmtTime = (iso: string, zone: string) => { const f = fmt(zone, "time"), ms = Date.parse(iso); const h = part(f, ms, "hour"); return `${h === "24" ? "00" : h}:${part(f, ms, "minute")}`; };

const dayNumber = (ms: number, zone: string): number => {
  const f = fmt(zone, "ymd");
  return Math.floor(Date.UTC(Number(part(f, ms, "year")), Number(part(f, ms, "month")) - 1, Number(part(f, ms, "day"))) / 86_400_000);
};

/** Whole calendar days from today to the date, both read in `zone`: negative means in the past. NaN for a date that is not one. */
export function daysFromToday(iso: string, zone: string, now: Date): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return Number.NaN;
  return dayNumber(ms, zone) - dayNumber(now.getTime(), zone);
}

export type Bucket = "late" | "today" | "week" | "later" | "none";
export const BUCKET_LABEL: Record<Bucket, string> = { late: "Late", today: "Today", week: "Next 7 days", later: "Later", none: "Waiting, no date set" };
export const BUCKET_ORDER: readonly Bucket[] = ["late", "today", "week", "later", "none"];

/** Groups work by its own recorded date. A row without a date is never given an invented deadline. */
export function bucketOf(iso: string | null, zone: string, now: Date): Bucket {
  if (!iso) return "none";
  const d = daysFromToday(iso, zone, now);
  if (Number.isNaN(d)) return "none";
  if (d < 0) return "late";
  if (d === 0) return "today";
  if (d <= 7) return "week";
  return "later";
}

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lateText = (n: number) => `${plural(n, "day")} late`;

/** "Dispatch Tue 20 Oct, 08:00", "Dispatch today, 14:00", "Dispatch was Fri 16 Oct, 08:00 · 3 days late". */
function whenWords(iso: string, zone: string, now: Date, w: { upcoming: string; was: string; today: string; time: boolean }): { label: string; late: boolean } {
  const d = daysFromToday(iso, zone, now);
  const at = w.time ? `, ${fmtTime(iso, zone)}` : "";
  if (d < 0) return { label: `${w.was} ${fmtDay(iso, zone)}${at} · ${lateText(-d)}`, late: true };
  if (d === 0) return { label: `${w.today}${at}`, late: false };
  return { label: `${w.upcoming} ${fmtDay(iso, zone)}${at}`, late: false };
}

/* ---------- the queue ---------- */

export interface Fact { text: string; tone?: "warn" | "bad" }
export interface SalesCheckRef { opportunityId: string; reference: string; companyId: string; locationId: string | null }
export interface QueueRow {
  id: string;
  kind: QueueKind;
  /** What needs doing, as a sentence. */
  title: string;
  /** For which project or person, with the request or enquiry code. */
  forWhom: string;
  /** The record's own date (an ISO instant), or null. Never invented. */
  when: string | null;
  /** The zone `when` is read in (the record's own warehouse). */
  zone: string;
  whenLabel: string;
  late: boolean;
  facts: Fact[];
  /** Where the row opens, or null for a Sales check (its button opens the check). */
  href: string | null;
  actionLabel: string;
  /** True when the button changes stock: only people who may operate stock are offered it. */
  operates: boolean;
  /** Present only on a Sales row: what the existing "Record the check" button needs. */
  check?: SalesCheckRef;
  /** Who must act (said in words, never a person's name made up), and what the next action is. Present on Waiting / Shortages and Held rows. */
  responsible?: string;
  next?: string;
  /** Present only on a "PM reported a difference" row: what the warehouse needs to answer it (the note, what the Project Manager said, the lines they named). */
  difference?: DifferenceRef;
}

export interface DifferenceRef {
  noteId: string; projectId: string; noteNo: string; kind: "dispatch" | "return"; reason: string | null; reportedBy: string | null; comment: string | null; lines: NoteLine[];
}

export interface BuildContext { now: Date }

/* ---------- requests: prepare / send ---------- */

export interface RequestLineInput {
  status: "open" | "cancelled" | "closed"; reserved: number; dispatched: number; toReserve: number;
  /** The line's shortage mark ("need_to_buy" / "need_to_rent" / "none") and what it is for, so a line waiting on a purchase or rental is said by name. */
  shortageAction?: string; itemName?: string; qty?: number; rentalReference?: string | null;
}
/** A line marked to buy or rent that still has something to reserve: it cannot be finished by preparing, so it waits (and stays visible) instead. */
const isWaitingLine = (l: RequestLineInput) => l.status === "open" && l.toReserve > 0.0005 && (l.shortageAction === "need_to_buy" || l.shortageAction === "need_to_rent");
export interface RequestInput {
  id: string; code: string; kind: "project" | "employee";
  /** The project's name, or who the equipment is for. */
  forLabel: string;
  timezone: string;
  plan: Record<string, string | null> | null;
  neededFrom: string | null;
  lines: readonly RequestLineInput[];
}

const EPS = 0.0005;

/** The request's dispatch date as an instant: the plan's own dispatch time read in the request's zone, else the day the equipment is needed from. */
export function dispatchInstant(r: Pick<RequestInput, "plan" | "timezone" | "neededFrom">): string | null {
  const local = r.plan?.dispatch;
  const fromPlan = typeof local === "string" && local !== "" ? zonedLocalToUtcIso(local, r.timezone) : null;
  return fromPlan ?? r.neededFrom ?? null;
}

/**
 * ONE row per request, never two. If some reserved equipment is still unsent and the dispatch date is today or earlier, it is "Send
 * equipment"; else if any open line still has something to reserve it is "Prepare equipment"; else if something is reserved and unsent it
 * is "Send equipment" (ahead of its date); else there is nothing to do and no row.
 */
export function requestRow(r: RequestInput, ctx: BuildContext): QueueRow | null {
  const open = r.lines.filter((l) => l.status === "open");
  const unsent = open.filter((l) => l.reserved - l.dispatched > EPS);
  // A line marked to buy or rent cannot be finished by preparing: it is shown under Waiting / Shortages (see `waitingRow`), not as work to prepare. It is still SHORT:
  // it is counted on its own (`toBuyOrRent`) and never among the fully reserved lines, and a request that has one is not simply "ready to send".
  const toReserve = open.filter((l) => l.toReserve > EPS && !isWaitingLine(l));
  const toBuyOrRent = open.filter(isWaitingLine);
  const sent = open.filter((l) => l.dispatched > EPS && l.reserved - l.dispatched <= EPS);
  const when = dispatchInstant(r);
  const zone = safeZone(r.timezone);
  const dueNow = when !== null && daysFromToday(when, zone, ctx.now) <= 0;

  const kind: "send" | "prepare" | null = unsent.length > 0 && dueNow ? "send" : toReserve.length > 0 ? "prepare" : unsent.length > 0 ? "send" : null;
  if (!kind) return null;

  const words = when ? whenWords(when, zone, ctx.now, { upcoming: "Dispatch", was: "Dispatch was", today: "Dispatch today", time: true }) : { label: "No dispatch date set", late: false };
  const forWhom = `${r.kind === "project" ? "Project" : "Employee"} ${r.forLabel} · request ${r.code}`;
  const facts: Fact[] = [];
  let title: string;
  if (kind === "prepare") {
    // Fully reserved = neither still to reserve from stock nor waiting on a purchase or rental. The three counts always add up to the open lines.
    const full = open.length - toReserve.length - toBuyOrRent.length;
    title = r.kind === "project" ? `${r.forLabel} needs its equipment prepared` : `Equipment for ${r.forLabel} needs to be prepared`;
    facts.push({ text: `${full} of ${plural(open.length, "line")} fully reserved · ${toReserve.length} still to reserve${toBuyOrRent.length > 0 ? ` · ${toBuyOrRent.length} to buy or rent` : ""}`, tone: "warn" });
  } else {
    const started = open.some((l) => l.dispatched > EPS);
    // Sending what is reserved while other lines are short is the existing partial dispatch. With any short line the title says "in part", never plain "ready to send".
    const ready = toReserve.length + toBuyOrRent.length > 0 ? "ready to send in part" : "ready to send";
    title = r.kind === "project"
      ? (started ? `${r.forLabel} still has equipment to send` : `${r.forLabel} is ${ready}`)
      : (started ? `Equipment for ${r.forLabel} is only partly sent` : `Equipment for ${r.forLabel} is ${ready}`);
    facts.push({ text: `${plural(unsent.length, "line")} ready to send${sent.length > 0 ? `, ${sent.length} sent` : ""}` });
    if (toReserve.length > 0) facts.push({ text: `${plural(toReserve.length, "line")} still to reserve`, tone: "warn" });
    if (toBuyOrRent.length > 0) facts.push({ text: `${plural(toBuyOrRent.length, "line")} to buy or rent`, tone: "warn" });
  }
  return {
    id: `request:${r.id}`, kind, title, forWhom, when, zone, whenLabel: words.label, late: words.late, facts,
    href: `/inventory/requests/${r.id}?step=${kind}`, actionLabel: kind === "send" ? "Send equipment" : "Prepare equipment", operates: kind === "send",
  };
}

/**
 * ONE Waiting / Shortages row per request that has lines marked to buy or rent and still short: what is waited for, who must act and the next action. It
 * is never hidden (an unresolved shortage stays visible until the stock is received and reserved) and never counted as work the warehouse can do now.
 */
export function waitingRow(r: RequestInput, ctx: BuildContext): QueueRow | null {
  const waiting = r.lines.filter(isWaitingLine);
  if (waiting.length === 0) return null;
  const zone = safeZone(r.timezone);
  const when = dispatchInstant(r);
  const words = when ? whenWords(when, zone, ctx.now, { upcoming: "Dispatch", was: "Dispatch was", today: "Dispatch today", time: true }) : { label: "No dispatch date set", late: false };
  const buy = waiting.filter((l) => l.shortageAction === "need_to_buy");
  const rent = waiting.filter((l) => l.shortageAction === "need_to_rent");
  const what = (l: RequestLineInput) => `${l.itemName ?? "An item"}${l.qty ? ` × ${l.qty}` : ""}: ${l.shortageAction === "need_to_buy" ? "to buy" : "to rent"}${l.rentalReference ? ` (rental ${l.rentalReference})` : ""}`;
  const shown = waiting.slice(0, 3).map(what);
  const forWhom = `${r.kind === "project" ? "Project" : "Employee"} ${r.forLabel} · request ${r.code}`;
  const responsible = [
    buy.length > 0 ? "To buy: the buyer (purchasing) buys it; the warehouse receives it into stock." : null,
    rent.length > 0 ? "To rent: whoever arranges the rental (the Project Manager or the buyer); the warehouse receives it as rented stock." : null,
  ].filter((x): x is string => x !== null).join(" ");
  return {
    id: `waiting:${r.id}`, kind: "waiting",
    title: `${plural(waiting.length, "line")} of ${r.forLabel} ${waiting.length === 1 ? "is" : "are"} waiting for stock to be bought or rented`,
    forWhom, when, zone, whenLabel: words.label, late: words.late,
    facts: [...shown.map((text) => ({ text })), ...(waiting.length > 3 ? [{ text: `and ${waiting.length - 3} more` }] : [])].map((f, i) => ({ ...f, tone: i === 0 && words.late ? ("bad" as const) : undefined })),
    responsible, next: "Receive the stock when it arrives (Stock, Receive stock), then reserve it for this request.",
    href: `/inventory/requests/${r.id}?step=prepare`, actionLabel: "Open the request", operates: false,
  };
}

export const requestRows = (rs: readonly RequestInput[], ctx: BuildContext): QueueRow[] => rs.flatMap((r) => [requestRow(r, ctx), waitingRow(r, ctx)]).filter((x): x is QueueRow => x !== null);

/* ---------- units held for checking ---------- */

export interface HeldUnitInput {
  id: string; code: string; itemName: string; condition: string; locationName: string | null;
  /** Live requests that still hold a reservation on this unit (it became held after it was reserved), or null when that could not be read. */
  reservedFor: { requestId: string; code: string }[] | null;
}
const HELD_WORDS: Record<string, string> = { needs_inspection: "Needs checking", damaged: "Damaged" };

/**
 * One row per unit that is held back for checking (damaged, or needs checking) and sitting in a warehouse. It has no date (nothing is due), so it sits in its own group. If a live request still has a
 * reservation on it, the row says that request needs a replacement before it can be sent: the reservation itself is not changed here.
 */
export function heldRows(units: readonly HeldUnitInput[]): QueueRow[] {
  return units.map((u): QueueRow => {
    const reserved = u.reservedFor ?? [];
    return {
      id: `held:${u.id}`, kind: "held", title: `${u.itemName} ${u.code} is held for checking`,
      forWhom: `${HELD_WORDS[u.condition] ?? u.condition} · ${u.locationName ?? "in a warehouse"} · not available until it is checked`,
      when: null, zone: "UTC", whenLabel: "No date: waiting for a check", late: false,
      facts: reserved.length > 0
        ? [{ text: `Reserved for request ${reserved.map((r) => r.code).join(", ")}: it needs a replacement before it can be sent`, tone: "warn" as const }]
        : u.reservedFor === null ? [{ text: "Whether a request still holds a reservation on it could not be read" }] : [],
      responsible: "The warehouse checks it, then releases it or sends it for repair.",
      next: reserved.length > 0 ? "Check it, or reserve another unit for the request." : "Open the unit and record the check.",
      href: `/inventory/stock?unit=${u.id}`, actionLabel: "Check it", operates: true,
    };
  });
}

/* ---------- differences the Project Manager reported on a dispatch note or return checklist ---------- */

/**
 * One row per note with an open difference, oldest report first, with its age. The row names who must act (the warehouse that recorded the note) and the next action; it
 * carries what the Project Manager said so the warehouse can answer it from here. A difference changes no custody and no availability: the row says so.
 */
export function differenceRows(views: readonly NoteView[], ctx: BuildContext): QueueRow[] {
  return views.map((v): QueueRow => {
    const n = v.note;
    const zone = safeZone(n.location_timezone);
    const reportedAt = v.status.difference_reported_at;
    const report = [...v.events].reverse().find((e) => e.event === "difference_reported");
    const named = new Set(differenceLineNumbers(v.status.difference_lines));
    const count = named.size;
    return {
      id: `difference:${n.id}`, kind: "difference",
      title: `${n.note_no}: the Project Manager reports a difference`,
      forWhom: `${noteKindWord(n.kind)} · ${n.project_ref} ${n.project_name} · ${n.location_name}`,
      when: reportedAt, zone, late: false,
      whenLabel: reportedAt ? `Reported ${fmtDay(reportedAt, zone)}, ${fmtTime(reportedAt, zone)} · waiting ${ageText(reportedAt, ctx.now, zone)}` : "Reported",
      facts: [{ text: reasonWord(n.kind, v.status.difference_reason) }, ...(count > 0 ? [{ text: `${count} ${count === 1 ? "line" : "lines"}` }] : []), { text: "Custody and availability are unchanged" }],
      responsible: `The warehouse at ${n.location_name} answers it.`,
      next: "Check the lines, then record that the record stands, or that it was corrected (name the movement that corrected it).",
      href: null, actionLabel: "Answer the difference", operates: true,
      difference: { noteId: n.id, projectId: n.project_id, noteNo: n.note_no, kind: n.kind, reason: v.status.difference_reason, reportedBy: report?.by_name ?? null, comment: report?.comment ?? null, lines: v.payload.lines.filter((l) => named.has(l.n)) },
    };
  });
}

/* ---------- returns: equipment out, with a recorded return date ---------- */

export interface HeldEntry {
  holderKind: "project" | "employee"; holderId: string;
  /** The recorded `expected_return_at`. An entry without one is never listed. */
  dueAt: string | null;
  zone: string;
  /** Identifies one thing so it is counted once: a unit's id, or the item of a counted line. */
  key: string;
}
export interface ReturnNames { project: ReadonlyMap<string, string>; employee: ReadonlyMap<string, string> }
export interface ProjectRequestLink { requestId: string; code: string }

/** One row per project and one per employee, with the earliest due date. Only equipment due within the next 7 days (or already late) is listed. */
export function returnRows(entries: readonly HeldEntry[], names: ReturnNames, projectRequests: ReadonlyMap<string, ProjectRequestLink>, ctx: BuildContext): QueueRow[] {
  const groups = new Map<string, HeldEntry[]>();
  for (const e of entries) {
    if (!e.dueAt || Number.isNaN(Date.parse(e.dueAt))) continue;
    if (bucketOf(e.dueAt, e.zone, ctx.now) === "later") continue;
    const k = `${e.holderKind}:${e.holderId}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const rows: QueueRow[] = [];
  for (const [k, list] of groups) {
    const first = list[0]!;
    const earliest = [...list].sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))[0]!;
    const late = new Set(list.filter((e) => bucketOf(e.dueAt, e.zone, ctx.now) === "late").map((e) => e.key));
    const all = new Set(list.map((e) => e.key));
    const isLate = late.size > 0;
    const n = isLate ? late.size : all.size;
    const words = whenWords(earliest.dueAt!, earliest.zone, ctx.now, { upcoming: "Due", was: "Was due", today: "Due today", time: true });
    const facts: Fact[] = isLate && all.size > late.size ? [{ text: `${plural(all.size - late.size, "more item")} due within 7 days` }] : [];
    if (first.holderKind === "employee") {
      const who = names.employee.get(first.holderId) ?? "An employee";
      rows.push({
        id: `returns:${k}`, kind: "returns", title: `${who} has ${plural(n, "item")} ${isLate ? "overdue" : "due back"}`, forWhom: `Employee ${who}`,
        when: earliest.dueAt, zone: earliest.zone, whenLabel: words.label, late: words.late, facts,
        href: `/inventory/stock?action=return&employee=${first.holderId}`, actionLabel: "Receive returns", operates: true,
      });
    } else {
      const project = names.project.get(first.holderId) ?? "A project";
      const link = projectRequests.get(first.holderId);
      rows.push({
        id: `returns:${k}`, kind: "returns", title: `${plural(n, "item")} ${n === 1 ? "is" : "are"} ${isLate ? "overdue" : "due back"} from ${project}`,
        forWhom: `Project ${project}${link ? ` · request ${link.code}` : ""}`,
        when: earliest.dueAt, zone: earliest.zone, whenLabel: words.label, late: words.late, facts,
        href: link ? `/inventory/requests/${link.requestId}?step=back` : `/inventory/stock?action=return&project=${first.holderId}`, actionLabel: "Receive returns", operates: true,
      });
    }
  }
  return rows;
}

/* ---------- transfers on their way here ---------- */

export interface TransferInput {
  id: string; code: string; fromName: string; toName: string;
  expectedAt: string | null; zone: string;
  /** Items on it (units and counted lines), or null when that could not be read. */
  items: number | null;
}

export function transferRows(ts: readonly TransferInput[], ctx: BuildContext, opts: { here: boolean }): QueueRow[] {
  return ts.map((t): QueueRow => {
    const zone = safeZone(t.zone);
    const words = t.expectedAt ? whenWords(t.expectedAt, zone, ctx.now, { upcoming: "Expected", was: "Was expected", today: "Expected today", time: false }) : { label: "No expected date recorded", late: false };
    return {
      id: `transfer:${t.id}`, kind: "transfer", title: opts.here ? `Transfer ${t.code} is on its way here` : `Transfer ${t.code} is on its way to ${t.toName}`,
      forWhom: `From ${t.fromName}${t.items === null ? "" : ` · ${plural(t.items, "item")}`}`,
      when: t.expectedAt, zone, whenLabel: words.label, late: words.late, facts: [],
      href: `/inventory/stock?action=transfer&mode=receive&transfer=${t.id}`, actionLabel: "Receive transfer", operates: true,
    };
  });
}

/* ---------- Sales checks ---------- */

/** What a Sales row is built from: exactly what "Sales checks waiting" already shows. The enquiry's client, title, value and notes are never read. */
export interface SalesInput {
  checkId: string; opportunityId: string; companyId: string; reference: string; requestedAt: string;
  locationId: string | null; locationName: string | null;
  installStart: string | null; eventStart: string | null; eventEnd: string | null;
  technologies: { name: string; qty: number | string }[];
  zone: string;
}

export function salesRows(cs: readonly SalesInput[], ctx: BuildContext): QueueRow[] {
  void ctx;
  return cs.map((c): QueueRow => {
    const zone = safeZone(c.zone);
    const asked = Number.isNaN(Date.parse(c.requestedAt)) ? "Asked" : `Asked ${fmtDay(c.requestedAt, zone)}`;
    const dates = pendingDates({ install_start: c.installStart, event_start: c.eventStart, event_end: c.eventEnd });
    return {
      id: `sales:${c.checkId}`, kind: "sales", title: `Sales asks whether equipment is free for enquiry ${c.reference}`,
      forWhom: `Enquiry ${c.reference} · ${c.locationName ? `asked for ${c.locationName}` : "no warehouse named, you choose"}`,
      // A check has no deadline: its row never gets a date, so it always waits under "Waiting, no date set".
      when: null, zone, whenLabel: `${asked} · ${dates}`, late: false,
      facts: [{ text: pendingTechnologies({ technologies: c.technologies }) }, { text: "Nothing is reserved by a check" }],
      href: null, actionLabel: "Check availability", operates: false,
      check: { opportunityId: c.opportunityId, reference: c.reference, companyId: c.companyId, locationId: c.locationId },
    };
  });
}

/* ---------- putting the sources together ---------- */

export type SourceResults = Partial<Record<SourceKey, PromiseSettledResult<QueueRow[]>>>;

/** Each source stands alone: a rejected one is named in `failed` and contributes nothing, and the others still show. */
export function settleSources(results: SourceResults): { rows: QueueRow[]; failed: SourceKey[] } {
  const rows: QueueRow[] = [];
  const failed: SourceKey[] = [];
  for (const key of SOURCE_KEYS) {
    const r = results[key];
    if (!r) continue;
    if (r.status === "fulfilled") rows.push(...r.value);
    else failed.push(key);
  }
  return { rows, failed };
}

/** The warehouse a Sales check is about: the working one, or none named (every operator sees those, as the Sales checks list already does). */
export const salesCheckInScope = (check: { location_id: string | null }, workingLocationId: string | null) => workingLocationId === null || check.location_id === null || check.location_id === workingLocationId;

/* ---------- grouping and filters ---------- */

const byDate = (a: QueueRow, b: QueueRow) => {
  const x = a.when ? Date.parse(a.when) : Number.POSITIVE_INFINITY, y = b.when ? Date.parse(b.when) : Number.POSITIVE_INFINITY;
  return x === y ? a.title.localeCompare(b.title) || a.id.localeCompare(b.id) : x - y;
};

/** Rows that wait on something other than a date: each has its own group after the dated ones, so an unresolved shortage or a held unit is never lost among dates. */
export type GroupKey = Bucket | "waiting" | "held" | "difference";
export const GROUP_LABEL: Record<GroupKey, string> = { ...BUCKET_LABEL, waiting: "Waiting / Shortages", held: "Held for checking", difference: "PM reported a difference" };
/** A difference the Project Manager reported waits for the warehouse's answer, whatever the date: it comes first so it is never lost among dated jobs. */
export const GROUP_ORDER: readonly GroupKey[] = ["difference", ...BUCKET_ORDER, "waiting", "held"];
const groupOf = (r: QueueRow, now: Date): GroupKey => (r.kind === "waiting" ? "waiting" : r.kind === "held" ? "held" : r.kind === "difference" ? "difference" : bucketOf(r.when, r.zone, now));

export function groupRows(rows: readonly QueueRow[], now: Date): { bucket: GroupKey; rows: QueueRow[] }[] {
  return GROUP_ORDER
    .map((bucket) => ({ bucket, rows: rows.filter((r) => groupOf(r, now) === bucket).sort(byDate) }))
    .filter((g) => g.rows.length > 0);
}

export const filterRows = (rows: readonly QueueRow[], show: ShowFilter): QueueRow[] => (show === "all" ? [...rows] : rows.filter((r) => r.kind === show));

/**
 * The number on each filter chip. A filter whose source failed is `null` ("?"), never 0; "Everything" is `null` too while any source is
 * missing, because a partial total would read as the whole queue.
 */
export function filterCounts(rows: readonly QueueRow[], failed: readonly SourceKey[]): Record<ShowFilter, number | null> {
  const out = {} as Record<ShowFilter, number | null>;
  for (const f of SHOW_FILTERS) {
    if (f === "all") out.all = failed.length > 0 ? null : rows.length;
    else out[f] = failed.includes(SOURCE_OF[f]) ? null : rows.filter((r) => r.kind === f).length;
  }
  return out;
}

/** Only an empty queue from sources that ALL answered is "nothing waiting". */
export const isQueueEmpty = (rows: readonly QueueRow[], failed: readonly SourceKey[]) => rows.length === 0 && failed.length === 0;
