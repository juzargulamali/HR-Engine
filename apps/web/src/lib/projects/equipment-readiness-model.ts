/**
 * The readiness of one project's equipment, in words (pure: no database, no React). Every number is the database's own (proj_equipment_readiness, which reads the Inventory
 * lines and reservations); nothing is estimated here. A line whose shortage is to be bought or rented is SHORT: it is never counted as reserved.
 */
import { dateText, formatDateTime } from "./format";

export type ReadinessState = "draft" | "cancelled" | "reserved" | "partially_ready" | "short" | "partially_dispatched" | "dispatched" | "still_out" | "returned";
export interface RequestReadiness {
  id: string; code: string; status: string; state: ReadinessState;
  lines: number; reservedLines: number; partialLines: number; shortLines: number; shortBuy: number; shortRent: number; shortNoPlan: number; dispatchedLines: number; returnedLines: number;
  unitsAsked: number; unitsShort: number; unitsDispatched: number; unitsReturned: number; unitsOut: number;
  neededFrom: string | null; neededUntil: string | null; expectedReturnAt: string | null; returnOverdue: boolean;
}
export type ReviewField = "install_start" | "event_start" | "event_end";
export interface EquipmentReview { id: string; requestId: string; requestCode: string; field: ReviewField; oldDate: string | null; newDate: string | null; changedAt: string; changedBy: string | null }
export interface EquipmentReadiness {
  projectStatus: string;
  requests: RequestReadiness[];
  /** A committed project date changed while the request was with the warehouse, and nobody has marked it reviewed yet. */
  reviews: EquipmentReview[];
  /** The latest failed release of unused reservations when the project finished (the project still finished). */
  releaseFailed: { at: string; detail: string | null } | null;
}
/** Four separate answers, as for the Delivery Plan: the readiness, the migration is not applied here, the database refused this person, or the read failed. */
export type EquipmentReadinessResult = { state: "ok"; readiness: EquipmentReadiness } | { state: "not_installed" } | { state: "denied" } | { state: "error" };

export const READINESS_LOAD_ERROR = "Equipment readiness could not be loaded";

export const READINESS_LABEL: Record<ReadinessState, string> = {
  draft: "Not sent to the warehouse yet", cancelled: "Cancelled", reserved: "Reserved", partially_ready: "Partly ready", short: "Short",
  partially_dispatched: "Partly dispatched", dispatched: "Dispatched", still_out: "Still out", returned: "Returned",
};
export const REVIEW_FIELD_LABEL: Record<ReviewField, string> = { install_start: "Installation start", event_start: "Event start", event_end: "Event end" };
export const REVIEW_BOOKING_SENTENCE = "The booking has not been changed. The warehouse changes it on the request, where conflicts are checked.";
export const STILL_OUT_HEADING = "Delivery complete · equipment still out";

const STATES = Object.keys(READINESS_LABEL) as ReadinessState[];
const FIELDS = Object.keys(REVIEW_FIELD_LABEL) as ReviewField[];
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const n = (v: unknown): number => { const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN; return Number.isFinite(x) ? x : 0; };

/** Reads the function's answer. Null when it is not the expected shape (the caller then says it could not load; it never becomes "no equipment"). */
export function parseReadiness(raw: unknown): EquipmentReadiness | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = rec(raw);
  if (!Array.isArray(o.requests) || !Array.isArray(o.reviews) || typeof o.project_status !== "string") return null;
  const requests: RequestReadiness[] = [];
  for (const x of list(o.requests).map(rec)) {
    const state = STATES.find((s) => s === x.state);
    const id = text(x.id);
    if (!state || !id) return null;   // an unknown state is not guessed at
    requests.push({
      id, code: text(x.code) ?? "", status: text(x.status) ?? "", state,
      lines: n(x.lines), reservedLines: n(x.reserved_lines), partialLines: n(x.partial_lines), shortLines: n(x.short_lines), shortBuy: n(x.short_buy), shortRent: n(x.short_rent), shortNoPlan: n(x.short_no_plan),
      dispatchedLines: n(x.dispatched_lines), returnedLines: n(x.returned_lines),
      unitsAsked: n(x.units_asked), unitsShort: n(x.units_short), unitsDispatched: n(x.units_dispatched), unitsReturned: n(x.units_returned), unitsOut: n(x.units_out),
      neededFrom: text(x.needed_from), neededUntil: text(x.needed_until), expectedReturnAt: text(x.expected_return_at), returnOverdue: x.return_overdue === true,
    });
  }
  const reviews: EquipmentReview[] = [];
  for (const x of list(o.reviews).map(rec)) {
    const field = FIELDS.find((f) => f === x.field);
    const id = text(x.id); const requestId = text(x.request_id);
    if (!field || !id || !requestId) return null;
    reviews.push({ id, requestId, requestCode: text(x.request_code) ?? "", field, oldDate: text(x.old_date), newDate: text(x.new_date), changedAt: text(x.changed_at) ?? "", changedBy: text(x.changed_by) });
  }
  const failed = o.release_failed == null ? null : rec(o.release_failed);
  return { projectStatus: o.project_status, requests, reviews, releaseFailed: failed && text(failed.at) ? { at: text(failed.at) as string, detail: text(failed.detail) } : null };
}

const lines = (count: number) => (count === 1 ? "1 line" : `${count} lines`);
const qty = (x: number) => String(Math.round(x * 1000) / 1000);
export const unitsText = (x: number) => (x === 1 ? "1 unit" : `${qty(x)} units`);

/** How the short lines are planned: "2 to buy, 1 to rent, 1 with no plan yet". Empty when no line is short. */
export function shortBreakdown(r: Pick<RequestReadiness, "shortBuy" | "shortRent" | "shortNoPlan">): string {
  return [r.shortBuy > 0 ? `${r.shortBuy} to buy` : null, r.shortRent > 0 ? `${r.shortRent} to rent` : null, r.shortNoPlan > 0 ? `${r.shortNoPlan} with no plan yet` : null].filter(Boolean).join(", ");
}
const shortPart = (r: RequestReadiness) => { const how = shortBreakdown(r); return `${lines(r.shortLines)} short${how ? `: ${how}` : ""}`; };

export type ReadinessTone = "red" | "amber" | "quiet";
/** One request's readiness: the state in a word, and the counts behind it. */
export function readinessLine(r: RequestReadiness): { label: string; detail: string | null; tone: ReadinessTone } {
  const label = READINESS_LABEL[r.state];
  switch (r.state) {
    case "draft": return { label, detail: r.lines === 0 ? "No lines yet" : `${lines(r.lines)} on the draft`, tone: "amber" };
    case "cancelled": return { label, detail: null, tone: "quiet" };
    case "reserved": return { label, detail: r.lines === 0 ? "No lines" : `${r.lines === 1 ? "The line is" : `All ${r.lines} lines are`} reserved for the request dates`, tone: "quiet" };
    case "partially_ready": return { label, detail: `${r.lines - r.shortLines} of ${lines(r.lines)} reserved · ${shortPart(r)}`, tone: "amber" };
    case "short": { const how = shortBreakdown(r); return { label, detail: `${r.shortLines} of ${lines(r.lines)} short${how ? `: ${how}` : ""}`, tone: "red" }; }
    case "partially_dispatched": return { label, detail: `${r.dispatchedLines} of ${lines(r.lines)} dispatched · ${unitsText(r.unitsOut)} out${r.shortLines > 0 ? ` · ${shortPart(r)}` : ""}`, tone: "amber" };
    case "dispatched": return { label, detail: `${unitsText(r.unitsOut)} out${r.returnOverdue ? " · return overdue" : ""}`, tone: r.returnOverdue ? "red" : "quiet" };
    case "still_out": return { label, detail: `${qty(r.unitsReturned)} of ${unitsText(r.unitsDispatched)} returned · ${unitsText(r.unitsOut)} still out${r.returnOverdue ? " · return overdue" : ""}`, tone: r.returnOverdue ? "red" : "amber" };
    case "returned": return { label, detail: `${unitsText(r.unitsReturned)} dispatched and returned`, tone: "quiet" };
  }
}

/** "was 12 Mar 2026 · now 14 Mar 2026" ("not set" where a date was empty). */
export const reviewChangeText = (v: Pick<EquipmentReview, "oldDate" | "newDate">): string => `was ${v.oldDate ? dateText(v.oldDate) : "not set"} · now ${v.newDate ? dateText(v.newDate) : "not set"}`;
export const reviewByText = (v: Pick<EquipmentReview, "changedBy" | "changedAt">): string => `Changed by ${v.changedBy ?? "someone not recorded"}${v.changedAt ? ` on ${formatDateTime(v.changedAt)}` : ""}`;
/** The request where the warehouse changes the booking's dates (Planning dates on the request, with its own conflict checks). */
export const requestHref = (requestId: string): string => `/inventory/requests/${requestId}`;

export interface StillOut { units: number; overdue: boolean; requests: { id: string; code: string; unitsOut: number; expectedReturnAt: string | null; overdue: boolean }[] }
/** On a completed or archived project: what is still out. Null when the project is live or everything is back. Completing a project never returns equipment. */
export function stillOutAfterDelivery(e: EquipmentReadiness): StillOut | null {
  if (e.projectStatus !== "completed" && e.projectStatus !== "archived") return null;
  const out = e.requests.filter((r) => r.unitsOut > 0);
  if (out.length === 0) return null;
  return { units: out.reduce((a, r) => a + r.unitsOut, 0), overdue: out.some((r) => r.returnOverdue), requests: out.map((r) => ({ id: r.id, code: r.code, unitsOut: r.unitsOut, expectedReturnAt: r.expectedReturnAt, overdue: r.returnOverdue })) };
}
/** "3 units out · expected back 12 Mar 2026, 10:00 · overdue" for one request that is still out. */
export const stillOutText = (r: StillOut["requests"][number]): string =>
  `${unitsText(r.unitsOut)} out · ${r.expectedReturnAt ? `expected back ${formatDateTime(r.expectedReturnAt)}` : "no expected return recorded"}${r.overdue ? " · overdue" : ""}`;

const ORDER: ReadinessState[] = ["short", "partially_ready", "partially_dispatched", "still_out", "dispatched", "reserved", "returned"];
/**
 * The equipment line of the Work page's delivery summary, from readiness. Null when readiness has nothing to say that the page does not already say (no request has reached the
 * warehouse): the caller keeps its own line (drafts, the failed import, "no request yet"). The worst state leads; with several requests each state is counted.
 */
export function readinessSummary(e: EquipmentReadiness): { text: string; detail: string | null; tone: ReadinessTone } | null {
  const sent = e.requests.filter((r) => r.state !== "draft" && r.state !== "cancelled");
  if (sent.length === 0) return null;
  const tone = (rs: readonly RequestReadiness[]): ReadinessTone => { const t = rs.map((r) => readinessLine(r).tone); return t.includes("red") ? "red" : t.includes("amber") ? "amber" : "quiet"; };
  const review = e.reviews.length > 0 ? "Review equipment booking" : null;
  if (sent.length === 1) {
    const l = readinessLine(sent[0]!);
    return { text: l.label, detail: [l.detail, review].filter(Boolean).join(" · ") || null, tone: review && l.tone === "quiet" ? "amber" : l.tone };
  }
  const counted = ORDER.map((s) => ({ s, c: sent.filter((r) => r.state === s).length })).filter((x) => x.c > 0);
  const t = tone(sent);
  return { text: counted.map((x) => `${x.c} ${READINESS_LABEL[x.s].toLowerCase()}`).join(" · "), detail: [`${sent.length} requests with the warehouse`, review].filter(Boolean).join(" · "), tone: review && t === "quiet" ? "amber" : t };
}
