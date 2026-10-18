import type { PlanTableRow } from "@enginious-hr/domain";

/** Pure layout helpers for the client timeline PDF (kept apart from react-pdf so they can be tested). */

export interface PlanSection {
  title: PlanTableRow["section"];
  rows: PlanTableRow[];
}

const ORDER: PlanTableRow["section"][] = ["Milestones", "Delivery timeline", "Site production timeline", "Dependencies on others"];

/** Groups the flat table rows into sections in the fixed order, leaving empty sections out. */
export function groupPlanRows(rows: readonly PlanTableRow[]): PlanSection[] {
  return ORDER.map((title) => ({ title, rows: rows.filter((r) => r.section === title) })).filter((s) => s.rows.length > 0);
}

/** A file name that is safe in a Content-Disposition header: letters, digits, dot, dash and underscore only. */
export function planPdfFileName(reference: string, version: number): string {
  const safe = reference.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
  return `timeline-${safe}-v${Math.max(1, Math.floor(version))}.pdf`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The calendar date an instant falls on in the site's zone, as "5 Mar 2099". */
export function issuedDateText(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant)).split("-").map(Number) as [number, number, number];
  return `${parts[2]} ${MONTHS[parts[1] - 1]} ${parts[0]}`;
}

export const timeZoneNote = (tz: string) => `Dates are calendar dates. Times are local time at the site (${tz}).`;
