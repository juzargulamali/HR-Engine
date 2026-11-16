import { currentVersions, expiryState, EXPIRING_SOON_DAYS } from "./document-types";

/**
 * The HR work queue's shared read model. The Alerts page, My Day and the employee profile all read their HR flags from here, so one issue has one status, one set of words and one
 * link everywhere. Nothing here is stored except an acknowledgement: whether an issue is still open is ALWAYS worked out again from the source record, so fixing the record (renewing a
 * document, confirming probation, correcting a day) removes the item from every view on the next load, and acknowledging can never hide an issue that still needs action.
 *
 *   states      needs_action   overdue, expired, or a condition that needs a person (not yet seen)
 *               due_soon       coming up inside its look-ahead, not yet seen
 *               acknowledged   somebody saw it; it stays listed, with the same link, for as long as the source says it is still open
 */
export type QueueKind = "contract_end" | "probation" | "employee_document" | "identity_document" | "attendance" | "recovery_alert" | "ai_suggestion";
export type QueueState = "needs_action" | "due_soon" | "acknowledged";

/** Contracts and probation use the Alerts page's existing 30-day horizon; documents use the profile's existing 60-day look-ahead. */
export const CONTRACT_LOOKAHEAD_DAYS = 30;
export const DOCUMENT_LOOKAHEAD_DAYS = EXPIRING_SOON_DAYS;

export const KIND_LABEL: Record<QueueKind, string> = {
  contract_end: "Contract",
  probation: "Probation",
  employee_document: "Document",
  identity_document: "Identity document",
  attendance: "Attendance",
  recovery_alert: "Recovery Leave",
  ai_suggestion: "AI suggestion",
};

/** The groups a person thinks in (HR says "documents", not "employee documents and identity documents"). The Alerts filter and My Day's HR rows use the same groups and words. */
export const QUEUE_GROUPS: readonly { value: string; label: string; kinds: readonly QueueKind[] }[] = [
  { value: "", label: "All types", kinds: [] },
  { value: "contracts", label: "Contract renewals", kinds: ["contract_end"] },
  { value: "probation", label: "Probation", kinds: ["probation"] },
  { value: "documents", label: "Document expiries", kinds: ["employee_document", "identity_document"] },
  { value: "attendance", label: "Attendance exceptions", kinds: ["attendance"] },
  { value: "recovery", label: "Recovery Leave alerts", kinds: ["recovery_alert"] },
  { value: "ai", label: "AI suggestions", kinds: ["ai_suggestion"] },
];

export const STATE_LABEL: Record<QueueState, string> = { needs_action: "Needs action", due_soon: "Due soon", acknowledged: "Acknowledged" };

export interface QueueItem {
  /** Stable across loads: kind + source record + the date it is about. */
  key: string;
  kind: QueueKind;
  sourceId: string;
  /** The contract end / probation end / expiry / work date the item is about (an acknowledgement belongs to this date). */
  sourceDate: string | null;
  employeeId: string | null;
  employeeName: string | null;
  companyId: string | null;
  companyName: string | null;
  /** What is wrong, in the words the profile uses for the same thing. */
  issue: string;
  dueDate: string | null;
  /** Whole days until the due date (negative: overdue); null when the item has no date. */
  days: number | null;
  /** The underlying urgency, independent of acknowledgement: an acknowledged item that is still overdue says so. */
  urgency: "overdue" | "due_soon" | "attention";
  state: QueueState;
  /** Who acts next, in words ("You (HR Admin)", "HR Admin of Aurora Trading"). */
  actsNext: string;
  canAcknowledge: boolean;
  acknowledged?: { at: string; note: string | null };
  /** The one direct action: where the exact record opens, with the employee, company and record already chosen. */
  href: string;
  actionLabel: string;
}

export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** "expired 3 days ago", "expires today", "expires in 12 days": the one phrase every view uses. `verb` is the noun's verb: expire / end. */
export function whenPhrase(days: number, verb: "expire" | "end" | "be due"): string {
  const past = verb === "expire" ? "expired" : verb === "end" ? "ended" : "was due";
  const present = verb === "expire" ? "expires" : verb === "end" ? "ends" : "is due";
  if (days < 0) return `${past} ${-days === 1 ? "1 day" : `${-days} days`} ago`;
  if (days === 0) return `${present} today`;
  return `${present} in ${days === 1 ? "1 day" : `${days} days`}`;
}

export function stateOf(urgency: QueueItem["urgency"], acknowledged: boolean): QueueState {
  if (acknowledged) return "acknowledged";
  return urgency === "due_soon" ? "due_soon" : "needs_action";
}

export interface Viewer {
  /** The viewer may act on an item for this company (they hold HR Admin for it); the database checks again on every write. */
  canActFor(companyId: string | null): boolean;
}

export function makeViewer(isHrAdminFor: (companyId: string) => boolean): Viewer {
  return { canActFor: (c) => !!c && isHrAdminFor(c) };
}

export function actsNext(viewer: Viewer, companyId: string | null, companyName: string | null, role: "HR Admin" | "HR Admin or System Administrator" = "HR Admin"): string {
  if (role === "HR Admin" && viewer.canActFor(companyId)) return "You (HR Admin)";
  if (role !== "HR Admin") return role;
  return companyName ? `HR Admin of ${companyName}` : "HR Admin";
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Builders: one per source. Each takes plain rows and returns items; none reads the database.
// ---------------------------------------------------------------------------------------------------------------------------------------------------

interface Ctx {
  today: string;
  viewer: Viewer;
  employees: ReadonlyMap<string, { name: string; companyId: string }>;
  companies: ReadonlyMap<string, string>;
  /** Acknowledgements by `${kind}:${sourceId}:${sourceDate}`. */
  acks: ReadonlyMap<string, { at: string; note: string | null }>;
}

const who = (c: Ctx, employeeId: string) => {
  const e = c.employees.get(employeeId);
  return { employeeId, employeeName: e?.name ?? null, companyId: e?.companyId ?? null, companyName: e ? c.companies.get(e.companyId) ?? null : null };
};
export const ackKey = (kind: QueueKind, sourceId: string, sourceDate: string | null) => `${kind}:${sourceId}:${sourceDate ?? ""}`;

function base(c: Ctx, kind: QueueKind, sourceId: string, sourceDate: string | null, employeeId: string) {
  const w = who(c, employeeId);
  const ack = c.acks.get(ackKey(kind, sourceId, sourceDate));
  return { key: ackKey(kind, sourceId, sourceDate), kind, sourceId, sourceDate, ...w, ack, canAcknowledge: c.viewer.canActFor(w.companyId) && !ack, actsNext: actsNext(c.viewer, w.companyId, w.companyName) };
}

export interface ContractRow { id: string; employee_id: string; contract_type: string; end_date: string | null; probation_end_date: string | null }

/** Current contracts ending, and probation periods ending, inside the look-ahead or already past. A contract that is no longer current (a renewal or confirmation was recorded) is never passed in. */
export function contractItems(rows: readonly ContractRow[], c: Ctx): QueueItem[] {
  const out: QueueItem[] = [];
  for (const r of rows) {
    if (!c.employees.has(r.employee_id)) continue;
    const profile = `/employees/${r.employee_id}?tab=employment`;
    if (r.end_date) {
      const days = daysBetween(c.today, r.end_date);
      if (days <= CONTRACT_LOOKAHEAD_DAYS) {
        const b = base(c, "contract_end", r.id, r.end_date, r.employee_id);
        const urgency = days < 0 ? "overdue" : days === 0 ? "overdue" : "due_soon";
        out.push({ ...pick(b), issue: `${r.contract_type.replace(/_/g, " ")} contract ${whenPhrase(days, "end")}`, dueDate: r.end_date, days, urgency, state: stateOf(urgency, !!b.ack), ...(b.ack ? { acknowledged: b.ack } : {}), href: profile, actionLabel: "Renew or change contract" });
      }
    }
    if (r.probation_end_date) {
      const days = daysBetween(c.today, r.probation_end_date);
      if (days <= CONTRACT_LOOKAHEAD_DAYS) {
        const b = base(c, "probation", r.id, r.probation_end_date, r.employee_id);
        const urgency = days <= 0 ? "overdue" : "due_soon";
        out.push({ ...pick(b), issue: `Probation review ${whenPhrase(days, "be due")}`, dueDate: r.probation_end_date, days, urgency, state: stateOf(urgency, !!b.ack), ...(b.ack ? { acknowledged: b.ack } : {}), href: profile, actionLabel: "Open employment" });
      }
    }
  }
  return out;
}

export interface DocRow { id: string; employee_id: string; document_type: string; expiry_date: string | null; created_at: string; deleted_at?: string | null }

const humanise = (t: string) => { const s = t.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

/**
 * Documents that are expired or expiring inside the look-ahead, judged from their dates (never from the status a daily job may not have written yet). The rows passed in are EVERY version,
 * including ones with no expiry date: `currentVersions` (the profile's own rule) picks the current version of each type first, and only then is its expiry evaluated, so a renewal with a
 * shorter date is judged on its own date and a renewal with no date clears the type. `labelFor` gives the type's label (the profile's rule names).
 */
export function documentItems(kind: "employee_document" | "identity_document", rows: readonly DocRow[], c: Ctx, labelFor: (type: string) => string = humanise): QueueItem[] {
  const latest = currentVersions(rows);
  const out: QueueItem[] = [];
  for (const r of latest) {
    if (!r.expiry_date || !c.employees.has(r.employee_id)) continue;
    const state = expiryState(r.expiry_date, c.today, DOCUMENT_LOOKAHEAD_DAYS);
    if (state !== "expired" && state !== "expiring") continue;
    const days = daysBetween(c.today, r.expiry_date);
    const b = base(c, kind, r.id, r.expiry_date, r.employee_id);
    const urgency = state === "expired" ? "overdue" : "due_soon";
    const type = r.document_type;
    const store = kind === "identity_document" ? "identity" : "employee";
    out.push({
      ...pick(b), issue: `${labelFor(type)} ${state === "expired" ? "expired" : "expiring soon"}: ${whenPhrase(days, "expire")}`, dueDate: r.expiry_date, days, urgency,
      state: stateOf(urgency, !!b.ack), ...(b.ack ? { acknowledged: b.ack } : {}),
      // The profile's Documents tab with the shared Add document form already open for a renewal of this document (the earlier one stays in the history).
      href: `/employees/${r.employee_id}?tab=documents&add=${store}:${type}&renew=1&docId=${r.id}`, actionLabel: "Renew document",
    });
  }
  return out;
}

export interface PresenceConflictRow { id: string; employee_id: string; work_date: string }
export interface WindowReviewRow { id: string; employee_id: string; starting_local_date: string }

/** Attendance exceptions HR must look at: a day where a manual entry and the clock disagree, and a recovery window waiting for HR to verify it. Both open the register on that employee and date. */
export function attendanceItems(conflicts: readonly PresenceConflictRow[], windows: readonly WindowReviewRow[], c: Ctx): QueueItem[] {
  const out: QueueItem[] = [];
  const push = (id: string, employeeId: string, date: string, issue: string) => {
    if (!c.employees.has(employeeId)) return;
    const b = base(c, "attendance", id, date, employeeId);
    const w = c.employees.get(employeeId)!;
    out.push({ ...pick(b), issue, dueDate: date, days: daysBetween(c.today, date), urgency: "attention", state: stateOf("attention", !!b.ack), ...(b.ack ? { acknowledged: b.ack } : {}), href: attendanceHref(w.companyId, date, employeeId), actionLabel: "Review in the register" });
  };
  for (const r of conflicts) push(r.id, r.employee_id, r.work_date, "Manual entry and clock records differ");
  for (const r of windows) push(r.id, r.employee_id, r.starting_local_date, "Recovery window waiting for HR verification");
  return out;
}

/** The register on one company and date, filtered to what needs review, with the employee's row open. */
export function attendanceHref(companyId: string, date: string, employeeId: string): string {
  return `/attendance?${new URLSearchParams({ companyId, date, filter: "needs_review", employee: employeeId }).toString()}`;
}

export interface RecoveryAlertRow { id: string; company_id: string; employee_id: string; alert_type: string; triggered_at: string; status: "open" | "acknowledged"; acknowledged_at: string | null; acknowledgement_note: string | null }

/** Recovery Leave work alerts keep their own acknowledgement (recovery_alerts.status); open ones need action, acknowledged ones stay listed as seen. */
export function recoveryAlertItems(rows: readonly RecoveryAlertRow[], c: Ctx, typeLabel: (t: string) => string, localDate: (iso: string, employeeId: string) => string): QueueItem[] {
  return rows.filter((r) => c.employees.has(r.employee_id)).map((r) => {
    const w = who(c, r.employee_id);
    const date = localDate(r.triggered_at, r.employee_id);
    const ack = r.status === "acknowledged";
    return {
      key: `recovery_alert:${r.id}`, kind: "recovery_alert" as const, sourceId: r.id, sourceDate: date, ...w, issue: `${typeLabel(r.alert_type)} (recovery work)`, dueDate: date, days: daysBetween(c.today, date),
      urgency: "attention" as const, state: stateOf("attention", ack), actsNext: actsNext(c.viewer, w.companyId, w.companyName), canAcknowledge: c.viewer.canActFor(w.companyId) && !ack,
      ...(ack && r.acknowledged_at ? { acknowledged: { at: r.acknowledged_at, note: r.acknowledgement_note } } : {}),
      href: attendanceHref(w.companyId ?? "", date, r.employee_id), actionLabel: "Review in the register",
    };
  });
}

export interface AiDraftRow { id: string; entity_type: string; proposed_action: string; created_by_agent: string; created_at: string }

/** AI suggestions waiting for a decision: only that one exists, who proposed it and when; the proposal's own content stays on the review screen (its payload can hold private details). */
export function aiSuggestionItems(rows: readonly AiDraftRow[], c: Ctx): QueueItem[] {
  return rows.map((r) => ({
    key: `ai_suggestion:${r.id}`, kind: "ai_suggestion" as const, sourceId: r.id, sourceDate: r.created_at.slice(0, 10), employeeId: null, employeeName: null, companyId: null, companyName: null,
    issue: `AI suggestion waiting for a decision: ${r.proposed_action.replace(/_/g, " ")} on ${r.entity_type.replace(/_/g, " ")}`, dueDate: null, days: null, urgency: "attention" as const, state: "needs_action" as const,
    actsNext: "HR Admin or System Administrator", canAcknowledge: false, href: `/ai-suggestions#draft-${r.id}`, actionLabel: "Review the suggestion",
  }));
}

/** Everything but the pieces a builder fills in itself. */
function pick(b: ReturnType<typeof base>) {
  return { key: b.key, kind: b.kind, sourceId: b.sourceId, sourceDate: b.sourceDate, employeeId: b.employeeId, employeeName: b.employeeName, companyId: b.companyId, companyName: b.companyName, actsNext: b.actsNext, canAcknowledge: b.canAcknowledge };
}

export const STATE_ORDER: Record<QueueState, number> = { needs_action: 0, due_soon: 1, acknowledged: 2 };

/** Most overdue first, then soonest; items without a date last. */
export function sortItems(items: readonly QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (a.days ?? Number.MAX_SAFE_INTEGER) - (b.days ?? Number.MAX_SAFE_INTEGER) || a.key.localeCompare(b.key));
}

export function countByState(items: readonly QueueItem[]): Record<QueueState, number> {
  const out = { needs_action: 0, due_soon: 0, acknowledged: 0 };
  for (const i of items) out[i.state]++;
  return out;
}
