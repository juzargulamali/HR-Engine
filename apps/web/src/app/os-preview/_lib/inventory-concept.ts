/**
 * Inventory simplification concept: FICTIONAL sample data and the small pure rules the concept screens use.
 * Nothing here reads or writes a real record. Every date is Dubai time; "now" is fixed so the screens read the same every time.
 * The rules mirror what the existing backend already enforces (see docs/inventory-simplification.md), so the concept does not promise more than it can do.
 */

export const NOW_ISO = "2026-10-19T09:30:00+04:00";
const NOW = new Date(NOW_ISO).getTime();
const ZONE = "Asia/Dubai";

export type LocId = "dxb" | "auh";
export const LOCATIONS: { id: LocId; name: string }[] = [
  { id: "dxb", name: "Dubai: Al Quoz" },
  { id: "auh", name: "Abu Dhabi: Mussafah" },
];
export const locName = (id: LocId) => LOCATIONS.find((l) => l.id === id)!.name;

/* ---------- dates ---------- */

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, ...opts });
const dayFmt = fmt({ weekday: "short", day: "numeric", month: "short" });
const timeFmt = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
const dateOnlyFmt = fmt({ day: "numeric", month: "short" });
const ymdFmt = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });
/** Joins the parts ourselves: Node and the browser disagree on punctuation ("Fri 16 Oct" or "Fri, 16 Oct"), which would break hydration. */
const parts = (f: Intl.DateTimeFormat, iso: string | number, keys: Intl.DateTimeFormatPartTypes[]) => {
  const p = f.formatToParts(new Date(iso));
  return keys.map((k) => p.find((x) => x.type === k)?.value ?? "").join(" ");
};

export const fmtDay = (iso: string) => parts(dayFmt, iso, ["weekday", "day", "month"]);
export const fmtTime = (iso: string) => { const p = timeFmt.formatToParts(new Date(iso)); const h = p.find((x) => x.type === "hour")!.value; return `${h === "24" ? "00" : h}:${p.find((x) => x.type === "minute")!.value}`; };
export const fmtDayTime = (iso: string) => `${fmtDay(iso)}, ${fmtTime(iso)}`;
export const fmtShort = (iso: string) => parts(dateOnlyFmt, iso, ["day", "month"]);
export const fmtRange = (from: string, to: string) => `${fmtShort(from)} to ${fmtShort(to)}`;
const ymd = (ms: number) => { const p = ymdFmt.formatToParts(new Date(ms)); const g = (t: string) => p.find((x) => x.type === t)!.value; return `${g("year")}-${g("month")}-${g("day")}`; };
const dayNumber = (iso: string | number) => Math.floor(Date.parse(`${ymd(typeof iso === "number" ? iso : new Date(iso).getTime())}T00:00:00Z`) / 86_400_000);

/** Whole calendar days from today (Dubai) to the date: negative means in the past. */
export function daysFromToday(iso: string): number {
  return dayNumber(iso) - dayNumber(NOW);
}

export type Bucket = "late" | "today" | "week" | "later" | "none";
export const BUCKET_LABEL: Record<Bucket, string> = { late: "Late", today: "Today", week: "Next 7 days", later: "Later", none: "Waiting, no date set" };
export const BUCKET_ORDER: Bucket[] = ["late", "today", "week", "later", "none"];

/** Groups work by its own recorded date. A row without a date is never given an invented deadline. */
export function bucketOf(iso: string | null): Bucket {
  if (!iso) return "none";
  const d = daysFromToday(iso);
  if (d < 0) return "late";
  if (d === 0) return "today";
  if (d <= 7) return "week";
  return "later";
}

/* ---------- Today queue ---------- */

export type QueueKind = "prepare" | "send" | "returns" | "transfer" | "sales";
export const KIND_LABEL: Record<QueueKind, string> = { prepare: "Prepare", send: "Send out", returns: "Receive back", transfer: "Transfers", sales: "Sales checks" };

export interface Fact { text: string; tone?: "warn" | "bad" | "good" }
export interface QueueItem {
  id: string;
  kind: QueueKind;
  /** Where the work is. `null` means the record names no location, so every operator sees it (as the Sales checks list already does). */
  loc: LocId | null;
  /** What needs doing, as a sentence. */
  title: string;
  /** For which project or person. */
  forWhom: string;
  /** The record's own date, if it has one. */
  when: string | null;
  whenLabel: string;
  facts: Fact[];
  action: { label: string; href?: string; sheet?: "transfer" | "employee" | "sales-check" };
}

const lateText = (iso: string) => { const n = -daysFromToday(iso); return n === 1 ? "1 day late" : `${n} days late`; };

export const QUEUE: QueueItem[] = [
  {
    id: "q-expo", kind: "returns", loc: "dxb", title: "Equipment is overdue from Dubai Expo Pavilion", forWhom: "Project Dubai Expo Pavilion · request REQ-0044",
    when: "2026-10-16T18:00:00+04:00", whenLabel: `Was due ${fmtDay("2026-10-16T18:00:00+04:00")} · ${lateText("2026-10-16T18:00:00+04:00")}`,
    facts: [{ text: "Sent 30 · Returned 14 · Still out 16", tone: "bad" }], action: { label: "Receive returns", href: "/os-preview/inventory/project/expo?step=back" },
  },
  {
    id: "q-alkhail", kind: "send", loc: "dxb", title: "Al Khail Roadshow still has equipment to send", forWhom: "Project Al Khail Roadshow · request REQ-0049",
    when: "2026-10-19T14:00:00+04:00", whenLabel: `Dispatch today, ${fmtTime("2026-10-19T14:00:00+04:00")}`,
    facts: [{ text: "Sent 6 of 16 · 10 reserved and waiting" }], action: { label: "Send equipment", href: "/os-preview/inventory/project/alkhail?step=send" },
  },
  {
    id: "q-sara", kind: "returns", loc: "dxb", title: "Sara Khan has 2 items due back today", forWhom: "Employee Sara Khan · Design",
    when: "2026-10-19T17:00:00+04:00", whenLabel: `Due today, ${fmtTime("2026-10-19T17:00:00+04:00")}`,
    facts: [{ text: "Laptop and presenter remote" }], action: { label: "Receive returns", sheet: "employee" },
  },
  {
    id: "q-marina", kind: "send", loc: "dxb", title: "Marina Gala Dinner is ready to send", forWhom: "Project Marina Gala Dinner · request REQ-0051",
    when: "2026-10-20T08:00:00+04:00", whenLabel: `Dispatch ${fmtDay("2026-10-20T08:00:00+04:00")}, ${fmtTime("2026-10-20T08:00:00+04:00")}`,
    facts: [{ text: "22 reserved · none sent yet" }], action: { label: "Send equipment", href: "/os-preview/inventory/project/marina?step=send" },
  },
  {
    id: "q-trf", kind: "transfer", loc: "dxb", title: "Transfer TRF-0112 is on its way here", forWhom: `From ${locName("auh")} · 6 items`,
    when: "2026-10-20T12:00:00+04:00", whenLabel: `Expected ${fmtDay("2026-10-20T12:00:00+04:00")}`,
    facts: [{ text: "Dispatched Sun 18 Oct by Omar" }], action: { label: "Receive transfer", sheet: "transfer" },
  },
  {
    id: "q-gulf", kind: "prepare", loc: "dxb", title: "Gulf Bank Summit needs its equipment prepared", forWhom: "Project Gulf Bank Summit · request REQ-0047",
    when: "2026-10-22T08:00:00+04:00", whenLabel: `Dispatch ${fmtDay("2026-10-22T08:00:00+04:00")}, ${fmtTime("2026-10-22T08:00:00+04:00")}`,
    facts: [{ text: "Reserved 66 of 84 · 18 short", tone: "warn" }], action: { label: "Prepare equipment", href: "/os-preview/inventory/project/gulf?step=prepare" },
  },
  {
    id: "q-sales1", kind: "sales", loc: "dxb", title: "Sales asks whether equipment is free for enquiry ENQ-0188", forWhom: `Enquiry ENQ-0188 · asked for ${locName("dxb")}`,
    when: null, whenLabel: `Asked ${fmtDay("2026-10-17T11:20:00+04:00")} · event ${fmtShort("2026-11-12T09:00:00+04:00")} to ${fmtShort("2026-11-14T22:00:00+04:00")}`,
    facts: [{ text: "LED wall panel × 24 · Line array speaker × 8" }, { text: "Nothing is reserved by a check" }], action: { label: "Check availability", sheet: "sales-check" },
  },
  {
    id: "q-sales2", kind: "sales", loc: null, title: "Sales asks whether equipment is free for enquiry ENQ-0192", forWhom: "Enquiry ENQ-0192 · no warehouse named, you choose",
    when: null, whenLabel: `Asked ${fmtDay("2026-10-18T15:05:00+04:00")} · event ${fmtShort("2026-12-02T09:00:00+04:00")} to ${fmtShort("2026-12-03T22:00:00+04:00")}`,
    facts: [{ text: "Wireless handheld mic × 10" }, { text: "Nothing is reserved by a check" }], action: { label: "Check availability", sheet: "sales-check" },
  },
];

export function queueFor(loc: LocId): QueueItem[] {
  return QUEUE.filter((q) => q.loc === loc || q.loc === null);
}

/* ---------- project equipment ---------- */

export type Tracking = "individual" | "counted";
export interface FreeUnit { code: string; where: string }
export interface SampleLine {
  id: string; name: string; tracking: Tracking; needed: number;
  /** Units reserved at the start (individual lines). */
  reservedUnits?: string[];
  reservedQty?: number;
  /** Units already sent / returned at the start (individual lines) and counts (counted lines). */
  sentUnits?: string[]; sentQty?: number;
  returnedUnits?: string[]; returnedQty?: number;
  /** Free for the booking window, in the order the system would pick them. */
  free?: FreeUnit[]; freeQty?: number;
  cannotUse?: string;
  shortWhy?: string;
  substitute?: string;
}
export interface SampleRequest {
  id: string; code: string; project: string; location: LocId; step: Step;
  /** The eight planning dates the existing request already stores. */
  plan: { prep_start: string; dispatch: string; install_start: string; show_start: string; show_end: string; dismantle_end: string; return_due: string; inspect_until: string };
  lines: SampleLine[];
}
export type Step = "prepare" | "send" | "back";
export const PLAN_LABELS: Record<keyof SampleRequest["plan"], string> = {
  prep_start: "Preparation starts", dispatch: "Dispatch", install_start: "Installation starts", show_start: "Show starts", show_end: "Show ends",
  dismantle_end: "Dismantling ends", return_due: "Equipment due back", inspect_until: "Inspection ends",
};

/** The booking window the availability check uses: earliest to latest planning date, so the preparation and inspection buffers are included. */
export function bookingWindow(p: SampleRequest["plan"]): { from: string; to: string } {
  const all = Object.values(p).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { from: all[0]!, to: all[all.length - 1]! };
}

const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${String(from + i).padStart(4, "0")}`);

export const REQUESTS: Record<string, SampleRequest> = {
  gulf: {
    id: "gulf", code: "REQ-0047", project: "Gulf Bank Summit", location: "dxb", step: "prepare",
    plan: { prep_start: "2026-10-21T08:00:00+04:00", dispatch: "2026-10-22T08:00:00+04:00", install_start: "2026-10-22T14:00:00+04:00", show_start: "2026-10-24T09:00:00+04:00", show_end: "2026-10-25T18:00:00+04:00", dismantle_end: "2026-10-25T23:00:00+04:00", return_due: "2026-10-26T12:00:00+04:00", inspect_until: "2026-10-27T12:00:00+04:00" },
    lines: [
      { id: "g1", name: "LED wall panel 500 × 500 mm", tracking: "individual", needed: 12, reservedUnits: range("LED", 101, 112) },
      { id: "g2", name: "Wireless handheld mic", tracking: "individual", needed: 6, reservedUnits: range("WM", 11, 14), free: [{ code: "WM-0015", where: "Bin A2 · good" }], cannotUse: "WM-0016 is in repair until 28 Oct", substitute: "Handheld mic, Model B" },
      { id: "g3", name: "XLR cable 10 m", tracking: "counted", needed: 40, reservedQty: 40, freeQty: 0 },
      { id: "g4", name: "Truss section 2 m", tracking: "counted", needed: 24, reservedQty: 10, freeQty: 6 },
      { id: "g5", name: "Stage laptop", tracking: "individual", needed: 2, reservedUnits: [], free: [], shortWhy: "All 5 laptops are booked by other projects between 21 and 27 Oct" },
    ],
  },
  marina: {
    id: "marina", code: "REQ-0051", project: "Marina Gala Dinner", location: "dxb", step: "send",
    plan: { prep_start: "2026-10-19T13:00:00+04:00", dispatch: "2026-10-20T08:00:00+04:00", install_start: "2026-10-20T11:00:00+04:00", show_start: "2026-10-21T19:00:00+04:00", show_end: "2026-10-21T23:30:00+04:00", dismantle_end: "2026-10-22T03:00:00+04:00", return_due: "2026-10-22T12:00:00+04:00", inspect_until: "2026-10-22T18:00:00+04:00" },
    lines: [
      { id: "m1", name: "Line array speaker", tracking: "individual", needed: 6, reservedUnits: range("LA", 201, 206) },
      { id: "m2", name: "Stage monitor", tracking: "individual", needed: 4, reservedUnits: range("SM", 301, 304) },
      { id: "m3", name: "Speaker cable 20 m", tracking: "counted", needed: 12, reservedQty: 12 },
    ],
  },
  alkhail: {
    id: "alkhail", code: "REQ-0049", project: "Al Khail Roadshow", location: "dxb", step: "send",
    plan: { prep_start: "2026-10-18T09:00:00+04:00", dispatch: "2026-10-19T14:00:00+04:00", install_start: "2026-10-20T08:00:00+04:00", show_start: "2026-10-21T10:00:00+04:00", show_end: "2026-10-22T20:00:00+04:00", dismantle_end: "2026-10-22T23:00:00+04:00", return_due: "2026-10-23T18:00:00+04:00", inspect_until: "2026-10-24T12:00:00+04:00" },
    lines: [
      { id: "a1", name: "Video projector 6000 lm", tracking: "individual", needed: 4, reservedUnits: range("PJ", 401, 404), sentUnits: ["PJ-0401", "PJ-0402"] },
      { id: "a2", name: "Projector screen 3 m", tracking: "individual", needed: 2, reservedUnits: range("PS", 501, 502) },
      { id: "a3", name: "Power strip 6-way", tracking: "counted", needed: 10, reservedQty: 10, sentQty: 4 },
    ],
  },
  expo: {
    id: "expo", code: "REQ-0044", project: "Dubai Expo Pavilion", location: "dxb", step: "back",
    plan: { prep_start: "2026-10-09T09:00:00+04:00", dispatch: "2026-10-10T08:00:00+04:00", install_start: "2026-10-10T13:00:00+04:00", show_start: "2026-10-12T09:00:00+04:00", show_end: "2026-10-15T18:00:00+04:00", dismantle_end: "2026-10-15T23:00:00+04:00", return_due: "2026-10-16T18:00:00+04:00", inspect_until: "2026-10-17T12:00:00+04:00" },
    lines: [
      { id: "e1", name: "LED wall panel 500 × 500 mm", tracking: "individual", needed: 12, reservedUnits: range("LED", 1, 12), sentUnits: range("LED", 1, 12), returnedUnits: range("LED", 1, 6) },
      { id: "e2", name: "Touch screen kiosk", tracking: "individual", needed: 2, reservedUnits: ["TK-0101", "TK-0102"], sentUnits: ["TK-0101", "TK-0102"], returnedUnits: [] },
      { id: "e3", name: "HDMI cable 5 m", tracking: "counted", needed: 16, reservedQty: 16, sentQty: 16, returnedQty: 8 },
    ],
  },
};

/** Working state of one line in the concept. Individual lines hold unit codes; counted lines hold quantities. */
export interface LineState { reserved: string[]; reservedQty: number; sent: string[]; sentQty: number; returned: string[]; returnedQty: number; shortage: "undecided" | "buy" | "rent"; substitution: "none" | "proposed" }

export function initialState(l: SampleLine): LineState {
  return {
    reserved: [...(l.reservedUnits ?? [])], reservedQty: l.reservedQty ?? 0, sent: [...(l.sentUnits ?? [])], sentQty: l.sentQty ?? 0,
    returned: [...(l.returnedUnits ?? [])], returnedQty: l.returnedQty ?? 0, shortage: "undecided", substitution: "none",
  };
}
export const reservedOf = (l: SampleLine, s: LineState) => (l.tracking === "individual" ? s.reserved.length : s.reservedQty);
export const sentOf = (l: SampleLine, s: LineState) => (l.tracking === "individual" ? s.sent.length : s.sentQty);
export const returnedOf = (l: SampleLine, s: LineState) => (l.tracking === "individual" ? s.returned.length : s.returnedQty);
export const shortOf = (l: SampleLine, s: LineState) => Math.max(0, l.needed - reservedOf(l, s));
export const stillOutOf = (l: SampleLine, s: LineState) => Math.max(0, sentOf(l, s) - returnedOf(l, s));
export const toSendOf = (l: SampleLine, s: LineState) => Math.max(0, reservedOf(l, s) - sentOf(l, s));

/** How many a "Reserve" would take now, and how many would still be short: the same arithmetic as the existing reserve function (it accepts a partial result). */
export function reserveOutcome(l: SampleLine, s: LineState, ask: number): { reserved: number; short: number } {
  const remaining = Math.max(0, l.needed - reservedOf(l, s));
  const want = Math.min(ask, remaining);
  const pool = l.tracking === "individual" ? (l.free ?? []).filter((f) => !s.reserved.includes(f.code)).length : l.freeQty ?? 0;
  const got = Math.min(want, pool);
  return { reserved: got, short: want - got };
}

/* ---------- Send out: flags before confirmation ---------- */

export interface SendDraftLine { line: SampleLine; ticked: string[]; counted: number | null }
export interface Flag { level: "block" | "warn"; text: string }

/**
 * What to tell the person before they confirm. "block" = the existing dispatch function would refuse it; "warn" = allowed, but worth a second look
 * (partial dispatch). Scanning or ticking never changes anything: only Confirm does.
 */
export function sendFlags(lines: SendDraftLine[], states: Record<string, LineState>, notReserved: string[]): Flag[] {
  const out: Flag[] = [];
  for (const code of notReserved) out.push({ level: "block", text: `${code} is not reserved for this request. The system would refuse it: take it off the list, or send it as an unplanned dispatch.` });
  for (const d of lines) {
    const s = states[d.line.id]!;
    const toSend = toSendOf(d.line, s);
    if (d.line.tracking === "individual") {
      const n = d.ticked.length;
      if (n > 0 && n < toSend) out.push({ level: "warn", text: `${d.line.name}: sending ${n} of ${toSend}. ${toSend - n} stay reserved and unsent.` });
    } else if (d.counted !== null) {
      if (d.counted > toSend) out.push({ level: "block", text: `${d.line.name}: ${d.counted} counted but only ${toSend} are reserved and still to send.` });
      else if (d.counted > 0 && d.counted < toSend) out.push({ level: "warn", text: `${d.line.name}: sending ${d.counted} of ${toSend}. ${toSend - d.counted} stay reserved and unsent.` });
    }
  }
  return out;
}

/* ---------- Receive back ---------- */

export type Condition = "good" | "fair" | "needs_inspection" | "damaged" | "unserviceable";
export const CONDITION_LABEL: Record<Condition, string> = { good: "Good", fair: "Fair", needs_inspection: "Needs checking", damaged: "Damaged", unserviceable: "Cannot be used" };
export const COUNTED_CONDITIONS: Condition[] = ["good", "needs_inspection", "damaged"];

/** Same rule as the existing return: good or fair individual units, and good counted stock, become available at once; anything else is held. */
export function returnOutcome(c: Condition | "", tracking: Tracking): "available" | "held" | "unset" {
  if (c === "") return "unset";
  if (tracking === "counted") return c === "good" ? "available" : "held";
  return c === "good" || c === "fair" ? "available" : "held";
}

/* ---------- Stock ---------- */

export interface StockRow { id: string; name: string; tracking: Tracking; sku: string; available: Record<LocId, number>; out: Record<LocId, number | null>; outNote?: string; reserved: Record<LocId, number>; unit?: string }
export const STOCK: StockRow[] = [
  { id: "s1", name: "LED wall panel 500 × 500 mm", tracking: "individual", sku: "LED", available: { dxb: 38, auh: 12 }, out: { dxb: 12, auh: 0 }, reserved: { dxb: 24, auh: 0 } },
  { id: "s2", name: "Wireless handheld mic", tracking: "individual", sku: "WM", available: { dxb: 1, auh: 4 }, out: { dxb: 0, auh: 2 }, reserved: { dxb: 4, auh: 0 } },
  { id: "s3", name: "Line array speaker", tracking: "individual", sku: "LA", available: { dxb: 14, auh: 0 }, out: { dxb: 0, auh: 0 }, reserved: { dxb: 6, auh: 0 } },
  { id: "s4", name: "Video projector 6000 lm", tracking: "individual", sku: "PJ", available: { dxb: 3, auh: 1 }, out: { dxb: 2, auh: 0 }, reserved: { dxb: 2, auh: 0 } },
  { id: "s5", name: "XLR cable 10 m", tracking: "counted", sku: "XLR", unit: "pcs", available: { dxb: 120, auh: 40 }, out: { dxb: null, auh: null }, outNote: "Counted stock that is out with people or on projects is not split by warehouse.", reserved: { dxb: 40, auh: 0 } },
  { id: "s6", name: "Truss section 2 m", tracking: "counted", sku: "TRS", unit: "pcs", available: { dxb: 16, auh: 8 }, out: { dxb: null, auh: null }, outNote: "Counted stock that is out with people or on projects is not split by warehouse.", reserved: { dxb: 10, auh: 0 } },
  { id: "s7", name: "HDMI cable 5 m", tracking: "counted", sku: "HDMI", unit: "pcs", available: { dxb: 64, auh: 20 }, out: { dxb: null, auh: null }, outNote: "Counted stock that is out with people or on projects is not split by warehouse.", reserved: { dxb: 0, auh: 0 } },
  { id: "s8", name: "Stage laptop", tracking: "individual", sku: "LT", available: { dxb: 0, auh: 1 }, out: { dxb: 5, auh: 0 }, reserved: { dxb: 5, auh: 0 } },
];

/** Codes the scan box understands in the concept. */
export const SCAN_CODES: Record<string, { name: string; where: string; state: "shelf" | "project" | "repair"; project?: string }> = {
  "WM-0015": { name: "Wireless handheld mic", where: "Dubai: Al Quoz · bin A2 · good", state: "shelf" },
  "LED-0007": { name: "LED wall panel 500 × 500 mm", where: "With Dubai Expo Pavilion · due back Fri 16 Oct", state: "project", project: "Dubai Expo Pavilion" },
  "WM-0016": { name: "Wireless handheld mic", where: "In repair until Wed 28 Oct", state: "repair" },
};

export interface MovementRow { id: string; when: string; what: string; qty: string; route: string; who: string; ref: string }
export const HISTORY: MovementRow[] = [
  { id: "h1", when: "2026-10-19T08:55:00+04:00", what: "Sent to project", qty: "2 × Video projector 6000 lm", route: "Dubai: Al Quoz → Al Khail Roadshow", who: "Omar Haddad", ref: "REQ-0049" },
  { id: "h2", when: "2026-10-19T08:55:00+04:00", what: "Sent to project", qty: "4 × Power strip 6-way", route: "Dubai: Al Quoz → Al Khail Roadshow", who: "Omar Haddad", ref: "REQ-0049" },
  { id: "h3", when: "2026-10-18T16:40:00+04:00", what: "Transfer sent", qty: "6 items", route: "Abu Dhabi: Mussafah → Dubai: Al Quoz", who: "Hind Saleh", ref: "TRF-0112" },
  { id: "h4", when: "2026-10-17T12:10:00+04:00", what: "Received back", qty: "6 × LED wall panel 500 × 500 mm", route: "Dubai Expo Pavilion → Dubai: Al Quoz", who: "Omar Haddad", ref: "REQ-0044" },
  { id: "h5", when: "2026-10-17T12:10:00+04:00", what: "Received back", qty: "8 × HDMI cable 5 m", route: "Dubai Expo Pavilion → Dubai: Al Quoz", who: "Omar Haddad", ref: "REQ-0044" },
  { id: "h6", when: "2026-10-16T10:25:00+04:00", what: "Received new stock", qty: "40 × XLR cable 10 m", route: "Supplier → Dubai: Al Quoz · bin C1", who: "Omar Haddad", ref: "—" },
  { id: "h7", when: "2026-10-15T15:00:00+04:00", what: "Given to employee", qty: "1 × Stage laptop", route: "Dubai: Al Quoz → Sara Khan", who: "Omar Haddad", ref: "—" },
];

export const SARA_ITEMS = [
  { code: "EQ-LT-0207", name: "Laptop, Dell Latitude", tracking: "individual" as Tracking },
  { code: "EQ-PR-0033", name: "Wireless presenter remote", tracking: "individual" as Tracking },
];
export const TRANSFER_ITEMS: { code: string; name: string; qty: number; tracking: Tracking }[] = [
  { code: "PJ-0410", name: "Video projector 6000 lm", qty: 1, tracking: "individual" },
  { code: "PJ-0411", name: "Video projector 6000 lm", qty: 1, tracking: "individual" },
  { code: "TRS (counted)", name: "Truss section 2 m", qty: 4, tracking: "counted" },
];
