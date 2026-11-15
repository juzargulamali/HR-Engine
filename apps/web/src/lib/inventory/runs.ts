/**
 * The site runs an equipment request serves (Inventory Phase 1). Pure: no React, no database. Three jobs:
 *   - suggest "Leaves warehouse" and "Due back" from the runs the Project Manager ticks (a suggestion shown in place, never applied silently);
 *   - say which ticked runs the request's dates cover, and that the same equipment stays out between them;
 *   - turn the run-specific status the database derives (inv_project_run_cover / inv_company_run_cover) into words for the project and Operations screens.
 * A run is a site activity of the project's Site schedule (proj_plan_items, plan "site"). Nothing here stores or decides anything.
 */

export interface RunOption {
  id: string;
  title: string;
  kind: string | null;
  runLabel: string | null;
  location: string | null;
  /** First and last calendar day of the run in the request's time zone ("2031-06-11"), or null while the run has no date. */
  startDay: string | null;
  endDay: string | null;
  /** The run in words: "11 Jun – 12 Jun", "No date yet". */
  when: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
function shiftDay(day: string, by: number): string | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + by));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayWords(day: string | null): string {
  const m = day ? DAY.exec(day) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "no date";
}
/** The calendar day of an instant in a time zone, as "YYYY-MM-DD"; null for something that is not a date. */
export function dayInZone(iso: string | null | undefined, zone: string): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
    const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch { return null; }
}

/** A site activity as the Site schedule reads it, turned into what the request form offers. */
export function runOption(a: { id: string; title: string; kind?: string | null; run_label?: string | null; location?: string | null; start_date?: string | null; end_date?: string | null; starts_at?: string | null; ends_at?: string | null }, zone: string): RunOption {
  const startDay = a.starts_at ? dayInZone(a.starts_at, zone) : (a.start_date ?? null);
  const endDay = a.ends_at ? dayInZone(a.ends_at, zone) : (a.end_date ?? a.start_date ?? null);
  const when = !startDay ? "No date yet" : endDay && endDay !== startDay ? `${dayWords(startDay)} to ${dayWords(endDay)}` : dayWords(startDay);
  return { id: a.id, title: a.title, kind: a.kind ?? null, runLabel: a.run_label ?? null, location: a.location ?? null, startDay, endDay, when };
}

export interface WindowSuggestion { dispatch: string; returnDue: string; firstRun: string; lastRun: string }

/**
 * Suggested dates for the runs that are ticked: the equipment leaves the warehouse at 09:00 the day before the first run starts and is due back at 18:00 the day
 * after the last run ends. Runs without a date are ignored; with no dated run there is nothing to suggest.
 */
export function suggestWindow(runs: readonly RunOption[], selected: readonly string[]): WindowSuggestion | null {
  const chosen = runs.filter((r) => selected.includes(r.id) && r.startDay);
  if (chosen.length === 0) return null;
  const first = [...chosen].sort((a, b) => a.startDay!.localeCompare(b.startDay!))[0]!;
  const last = [...chosen].sort((a, b) => (b.endDay ?? b.startDay!).localeCompare(a.endDay ?? a.startDay!))[0]!;
  const out = shiftDay(first.startDay!, -1), back = shiftDay(last.endDay ?? last.startDay!, 1);
  if (!out || !back) return null;
  return { dispatch: `${out}T09:00`, returnDue: `${back}T18:00`, firstRun: first.title, lastRun: last.title };
}

export interface RunCover { run: RunOption; covered: boolean | null; reason: string | null }

/**
 * Which ticked runs the two dates cover. `dispatch` and `returnDue` are the form's own local values ("2031-06-10T09:00"). A run is covered when the equipment
 * leaves on or before the day the run starts and is due back on or after the day it ends. Unknown (null) while a date is missing.
 */
export function coverOfRuns(runs: readonly RunOption[], selected: readonly string[], dispatch: string, returnDue: string): RunCover[] {
  const out = dispatch.slice(0, 10), back = returnDue.slice(0, 10);
  return runs.filter((r) => selected.includes(r.id)).map((run): RunCover => {
    if (!run.startDay) return { run, covered: null, reason: "This run has no date yet, so it cannot be checked against the request's dates." };
    if (!DAY.test(out) || !DAY.test(back)) return { run, covered: null, reason: "Set Leaves warehouse and Due back to see whether this run is covered." };
    if (out > run.startDay) return { run, covered: false, reason: `The equipment leaves the warehouse on ${dayWords(out)}, after this run starts.` };
    if (back < (run.endDay ?? run.startDay)) return { run, covered: false, reason: `The equipment is due back on ${dayWords(back)}, before this run ends.` };
    return { run, covered: true, reason: null };
  });
}

/** "The same equipment stays out from Run A to Run B: one dispatch, one return." for two or more dated runs; null otherwise. */
export function staysOutSentence(cover: readonly RunCover[]): string | null {
  const dated = cover.filter((c) => c.run.startDay).sort((a, b) => a.run.startDay!.localeCompare(b.run.startDay!));
  if (dated.length < 2) return null;
  return `The same equipment stays out from ${dated[0]!.run.title} to ${dated[dated.length - 1]!.run.title}: it is sent once and comes back once, and stays with the project between the runs.`;
}

/* ---------- run-specific status, as the database derives it ---------- */

export type RunProblem = "not_submitted" | "short" | "not_sent" | "partly_sent" | "leaves_after_run_starts" | "due_back_before_run_ends" | "return_overdue" | "run_not_dated" | "request_not_dated";

export interface RunCoverRow {
  projectId: string; requestId: string; requestCode: string; requestStatus: string;
  runId: string; runTitle: string; runKind: string | null; runLabel: string | null; runStart: string | null; runEnd: string | null;
  /** A run with days and no clock times: it is shown by its first and last day. */
  runAllDay: boolean; runFirstDay: string | null; runLastDay: string | null;
  leavesAt: string | null; dueBackAt: string | null; timezone: string;
  state: string; unitsAsked: number; unitsShort: number; unitsDispatched: number; unitsReturned: number; unitsOut: number;
  shortBuy: number; shortRent: number; shortNoPlan: number;
  problems: RunProblem[];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const number = (v: unknown): number => { const x = typeof v === "number" ? v : Number(v); return Number.isFinite(x) ? x : 0; };
const PROBLEMS: readonly RunProblem[] = ["not_submitted", "short", "not_sent", "partly_sent", "leaves_after_run_starts", "due_back_before_run_ends", "return_overdue", "run_not_dated", "request_not_dated"];

/** Reads the rows of inv_project_run_cover (or one project of inv_company_run_cover). Anything unexpected is dropped rather than guessed. */
export function parseRunCover(rows: unknown): RunCoverRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(rec).filter((r) => text(r.request_id) && text(r.run_id)).map((r): RunCoverRow => ({
    projectId: text(r.project_id) ?? "", requestId: text(r.request_id)!, requestCode: text(r.request_code) ?? "", requestStatus: text(r.request_status) ?? "",
    runId: text(r.run_id)!, runTitle: text(r.run_title) ?? "Site run", runKind: text(r.run_kind), runLabel: text(r.run_label), runStart: text(r.run_start), runEnd: text(r.run_end),
    runAllDay: r.run_all_day === true, runFirstDay: text(r.run_first_day), runLastDay: text(r.run_last_day),
    leavesAt: text(r.leaves_at), dueBackAt: text(r.due_back_at), timezone: text(r.timezone) ?? "UTC",
    state: text(r.state) ?? "", unitsAsked: number(r.units_asked), unitsShort: number(r.units_short), unitsDispatched: number(r.units_dispatched), unitsReturned: number(r.units_returned),
    unitsOut: number(r.units_out), shortBuy: number(r.short_buy), shortRent: number(r.short_rent), shortNoPlan: number(r.short_no_plan),
    problems: (Array.isArray(r.problems) ? r.problems : []).filter((p): p is RunProblem => (PROBLEMS as readonly unknown[]).includes(p)),
  }));
}

const STATE_WORDS: Record<string, string> = {
  draft: "Not sent to the warehouse yet", empty: "No items", reserved: "Reserved", partially_ready: "Partly reserved", short: "Short",
  partially_dispatched: "Partly sent", dispatched: "Sent", still_out: "Still out", returned: "Returned", cancelled: "Cancelled",
};
/** The request's state in the words the warehouse screens use. */
export const runStateWords = (state: string): string => STATE_WORDS[state] ?? state;

const say = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));

/** One exception of a run in a sentence that says how many and who acts. Run-date notes ("no date") are not exceptions and return null. */
export function runProblemWords(p: RunProblem, r: Pick<RunCoverRow, "unitsShort" | "shortBuy" | "shortRent" | "shortNoPlan" | "unitsOut" | "requestCode">): string | null {
  switch (p) {
    case "not_submitted": return `Request ${r.requestCode} has not been sent to the warehouse. The Project Manager sends it.`;
    case "short": {
      const who = [r.shortNoPlan > 0 ? "the warehouse reserves it or marks it to buy or rent" : null, r.shortBuy > 0 ? "the buyer buys it" : null, r.shortRent > 0 ? "whoever arranges the rental rents it" : null].filter((x): x is string => !!x);
      return `${say(r.unitsShort)} short on request ${r.requestCode}${who.length > 0 ? `: ${who.join("; ")}` : ""}.`;
    }
    case "not_sent": return `This run has started and nothing has been sent on request ${r.requestCode}. The warehouse sends it.`;
    case "partly_sent": return `This run has started and request ${r.requestCode} is only partly sent. The warehouse sends the rest, or says what is short.`;
    case "leaves_after_run_starts": return `Request ${r.requestCode} leaves the warehouse after this run starts. The Project Manager changes the dates.`;
    case "due_back_before_run_ends": return `Request ${r.requestCode} is due back before this run ends. The Project Manager changes the dates.`;
    case "return_overdue": return `${say(r.unitsOut)} still out on request ${r.requestCode} after its due-back date. The warehouse receives the return.`;
    default: return null;
  }
}

export interface RunGroup { runId: string; runTitle: string; runLabel: string | null; runStart: string | null; runEnd: string | null; when: string; rows: RunCoverRow[]; exceptions: string[] }

/** The run's own dates in words: "26 Nov 2026 to 27 Nov 2026", "26 Nov 2026", "No date yet". */
export function runWhenWords(r: Pick<RunCoverRow, "runFirstDay" | "runLastDay">): string {
  if (!r.runFirstDay) return "No date yet";
  return r.runLastDay && r.runLastDay !== r.runFirstDay ? `${dayWords(r.runFirstDay)} to ${dayWords(r.runLastDay)}` : dayWords(r.runFirstDay);
}

/** The rows grouped under their run, in the order the database gave them (by run start), with each run's exceptions in words. */
export function groupByRun(rows: readonly RunCoverRow[]): RunGroup[] {
  const groups: RunGroup[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.runId === r.runId);
    if (!g) { g = { runId: r.runId, runTitle: r.runTitle, runLabel: r.runLabel, runStart: r.runStart, runEnd: r.runEnd, when: runWhenWords(r), rows: [], exceptions: [] }; groups.push(g); }
    g.rows.push(r);
    for (const p of r.problems) { const w = runProblemWords(p, r); if (w && !g.exceptions.includes(w)) g.exceptions.push(w); }
  }
  return groups;
}
