import { BOOKING_STATE_LABELS, CONFIRMATION_LABELS, DELIVERABLE_STATUS_LABELS, MILESTONE_STATUS_LABELS, PRIORITY_LABELS, formatPlanDay, projectStatusLabel } from "@enginious-hr/domain";

/** A row of proj_change_log, the member-visible record of dates, ownership and status. */
export interface ChangeRow {
  entity_type: string;
  entity_id: string;
  field: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  actor_id: string | null;
}

export interface ChangeContext {
  /** The title of the milestone / deliverable / activity / dependency, when still known. */
  entityName: (type: string, id: string) => string | null;
  nameOf: (userId: string | null | undefined) => string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_LABELS: Record<string, string> = {
  start_date: "start date", end_date: "end date", due_date: "due date", install_start: "installation start", event_start: "event start", event_end: "event end",
  priority: "priority", start: "start", end: "end", expected: "expected date", team: "department",
};

function value(field: string, entity: string, v: string | null): string {
  if (v === null || v === "") return "not set";
  if (DATE_ONLY.test(v)) return formatPlanDay(v);
  if (field === "status") {
    if (entity === "project") return projectStatusLabel(v);
    if (entity === "milestone") return MILESTONE_STATUS_LABELS[v] ?? v;
    if (entity === "deliverable") return DELIVERABLE_STATUS_LABELS[v] ?? v;
    if (entity === "booking") return BOOKING_STATE_LABELS[v] ?? v;
  }
  if (field === "state") return BOOKING_STATE_LABELS[v] ?? v;
  if (field === "confirmation") return CONFIRMATION_LABELS[v] ?? v;
  if (field === "priority") return PRIORITY_LABELS[v as keyof typeof PRIORITY_LABELS] ?? v;
  return v;
}

const ENTITY_WORD: Record<string, string> = {
  project: "The project", milestone: "Milestone", deliverable: "Deliverable", plan_item: "Timeline activity", booking: "Site booking",
  member: "Person", message: "Discussion message", external_dependency: "Dependency",
};

/** One sentence per change: who/what changed, from and to, never an id and never message or booking text. */
export function describeChange(row: ChangeRow, ctx: ChangeContext): { subject: string; sentence: string } {
  const word = ENTITY_WORD[row.entity_type] ?? "Item";
  const name = row.entity_type === "member" ? ctx.nameOf(row.entity_id) : row.entity_type === "project" ? null : ctx.entityName(row.entity_type, row.entity_id);
  const subject = name ? `${word}: ${name}` : word;
  const f = row.field;
  const from = value(f, row.entity_type, row.from_value);
  const to = value(f, row.entity_type, row.to_value);

  if (row.entity_type === "member") {
    if (f === "added") return { subject, sentence: `${ctx.nameOf(row.entity_id)} was added to the project.` };
    if (f === "removed") return { subject, sentence: `${ctx.nameOf(row.entity_id)} was removed from the project.` };
    if (f === "acting_pm_until") {
      return row.to_value
        ? { subject, sentence: `${ctx.nameOf(row.entity_id)} was given temporary project leadership until ${to}.` }
        : { subject, sentence: `Temporary project leadership of ${ctx.nameOf(row.entity_id)} ended.` };
    }
  }
  if (row.entity_type === "message" && f === "deleted") {
    return { subject, sentence: `A message by ${row.from_value ?? "someone"} was deleted by ${row.to_value ?? "someone"}.` };
  }
  if (f === "deleted") return { subject, sentence: `${word}${row.from_value ? ` “${row.from_value}”` : ""} was deleted.` };
  if (f === "pm") return { subject, sentence: `The Project Manager changed from ${row.from_value ?? "nobody"} to ${row.to_value ?? "nobody"}.` };
  if (f === "scope") return { subject, sentence: "The agreed scope was replaced by an approved scope change. The earlier scope is kept in the scope change record." };
  if (f === "window") return { subject, sentence: "The booking time was changed." };
  if ((row.entity_type === "plan_item" && (f === "start" || f === "end")) || f === "expected") {
    const bothDates = [row.from_value, row.to_value].every((v) => v === null || DATE_ONLY.test(v));
    if (!bothDates) return { subject, sentence: `The ${FIELD_LABELS[f]} time was changed.` };
  }
  if (f === "state" || f === "status" || f === "confirmation") {
    const label = f === "confirmation" ? "confirmation" : "status";
    return { subject, sentence: `The ${label} changed from ${from} to ${to}.` };
  }
  const label = FIELD_LABELS[f] ?? f.replace(/_/g, " ");
  return { subject, sentence: `The ${label} changed from ${from} to ${to}.` };
}
