/**
 * The client timeline payload as the database builds it (proj_build_plan_payload) and the readable table form of it that
 * the PDF and the page both show. Nothing here reads anything but the payload: an issued plan is immutable.
 */
export interface IssuedPlanPayload {
  project: { reference: string; name: string; client_name: string | null; location: string | null; site_timezone: string };
  milestones: { title: string; due_date: string | null }[];
  delivery: { title: string; start_date: string | null; end_date: string | null }[];
  site: { title: string; start_date: string | null; end_date: string | null; starts_local: string | null; ends_local: string | null; tz: string | null }[];
  dependencies: { label: string; kind: string; expected_date: string | null; expected_time: string | null; organisation: string | null; confirmation: string }[];
}

export interface PlanTableRow {
  section: "Milestones" | "Delivery timeline" | "Site production timeline" | "Dependencies on others";
  title: string;
  when: string;
  detail: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatPlanDay(day: string | null): string {
  if (!day) return "Date to be confirmed";
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
const range = (a: string | null, b: string | null) => (!a ? "Date to be confirmed" : !b || b === a ? formatPlanDay(a) : `${formatPlanDay(a)} to ${formatPlanDay(b)}`);
const localText = (v: string) => `${formatPlanDay(v.slice(0, 10))}, ${v.slice(11, 16)}`;

const CONFIRMATION: Record<string, string> = { pending: "Not yet confirmed", confirmed: "Confirmed", not_possible: "Not possible" };

export function planTableRows(p: IssuedPlanPayload): PlanTableRow[] {
  const rows: PlanTableRow[] = [];
  for (const m of p.milestones) rows.push({ section: "Milestones", title: m.title, when: formatPlanDay(m.due_date), detail: "" });
  for (const d of p.delivery) rows.push({ section: "Delivery timeline", title: d.title, when: range(d.start_date, d.end_date), detail: "" });
  for (const s of p.site) {
    const timed = s.starts_local && s.ends_local;
    rows.push({
      section: "Site production timeline",
      title: s.title,
      when: timed ? `${localText(s.starts_local!)} to ${localText(s.ends_local!)}` : range(s.start_date, s.end_date),
      detail: timed && s.tz ? `Local time at the site (${s.tz})` : "",
    });
  }
  for (const e of p.dependencies) {
    rows.push({
      section: "Dependencies on others",
      title: e.label,
      when: e.expected_date ? `${formatPlanDay(e.expected_date)}${e.expected_time ? `, ${e.expected_time.slice(0, 5)}` : ""}` : "Date to be confirmed",
      detail: [e.organisation, CONFIRMATION[e.confirmation] ?? e.confirmation].filter(Boolean).join(" · "),
    });
  }
  return rows;
}
