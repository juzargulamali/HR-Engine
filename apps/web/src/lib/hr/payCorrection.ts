/**
 * Correcting a mistaken pay record: what the screen checks before it asks the database, what it shows in the review step, and how the database's answer is put into words.
 *
 * The database function correct_pay_record (supabase/migrations/20270118000200_people_hr_pay_correction.sql) is the real boundary and decides every rule again under the employee's lock.
 * The checks in planPayCorrection use the SAME rules and the same sentences so a person is told before saving, not after. Pay records form a chain ordered by effective date: each is in
 * force from its date until the next record's date. A correction may change a record's date, basic salary and allowances, never its place in that order.
 */
export interface PayRecord {
  id: string;
  effective_from: string;
  base_salary: number;
  allowances: Record<string, number>;
  currency: string;
  is_current: boolean;
  created_at: string;
}

/** A scheduled (not applied, not cancelled, not held) change with a pay figure in it. `basedOnId` is the pay record it was worked out from. */
export interface PendingPayChange { effective_date: string; basedOnId: string | null }

export interface CorrectionInput {
  records: readonly PayRecord[];
  recordId: string;
  /** The corrected date (yyyy-mm-dd); empty or the same as now means unchanged. */
  newDate: string;
  newBasic: number;
  newAllowances: Record<string, number>;
  /** Today in the employee's country (the database's answer). */
  today: string;
  hireDate: string;
  pending: readonly PendingPayChange[];
}

export interface InForce { id: string; effective_from: string; base_salary: number; allowances: Record<string, number>; currency: string }
export interface CorrectionPlan {
  ok: true;
  dateChanged: boolean;
  amountChanged: boolean;
  /** The pay in force today before and after the correction (null when no record has started yet). */
  beforeToday: InForce | null;
  afterToday: InForce | null;
  /** Set when, after the correction, no pay record covers the time between the hire date and the record's new date. */
  uncoveredFrom: string | null;
  uncoveredTo: string | null;
}
export interface CorrectionRefusal { ok: false; error: string }

export const ALLOWANCE_LABEL: Record<string, string> = { housing: "Housing", transport: "Transport", other: "Others" };
export const allowanceLabel = (key: string) => ALLOWANCE_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
export const allowanceTotal = (a: Record<string, number>) => Object.values(a).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
export const payTotal = (basic: number, a: Record<string, number>) => basic + allowanceTotal(a);
export const money = (n: number, currency: string) => `${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
export const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Reads the allowances object a pay record holds, keeping only numeric entries (anything else is not an amount). */
export function numericAllowances(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

const byOrder = (a: PayRecord, b: PayRecord) => a.effective_from.localeCompare(b.effective_from) || a.created_at.localeCompare(b.created_at);

/** The pay record in force on a date: the one with the latest effective date on or before it (the later-entered one when two share a date). Null when none has started. */
export function recordInForce<T extends Pick<PayRecord, "effective_from" | "created_at">>(records: readonly T[], on: string): T | null {
  let found: T | null = null;
  for (const r of [...records].sort((a, b) => a.effective_from.localeCompare(b.effective_from) || a.created_at.localeCompare(b.created_at))) if (r.effective_from <= on) found = r;
  return found;
}

const sameAmounts = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0) || (k in a) !== (k in b)) return false;
  return true;
};

const asInForce = (r: PayRecord | null): InForce | null => (r ? { id: r.id, effective_from: r.effective_from, base_salary: r.base_salary, allowances: r.allowances, currency: r.currency } : null);

/** Decides whether a correction can be saved, with the database's own sentences, and works out the pay in force before and after for the review step. */
export function planPayCorrection(i: CorrectionInput): CorrectionPlan | CorrectionRefusal {
  const sorted = [...i.records].sort(byOrder);
  const idx = sorted.findIndex((r) => r.id === i.recordId);
  const rec = sorted[idx];
  if (!rec) return { ok: false, error: "Couldn’t find that pay record. Reload the page and try again." };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(i.newDate) ? i.newDate : rec.effective_from;
  if (i.newDate && !/^\d{4}-\d{2}-\d{2}$/.test(i.newDate)) return { ok: false, error: "Enter the date the pay record really took effect." };
  if (!Number.isFinite(i.newBasic) || !(i.newBasic > 0)) return { ok: false, error: "Basic salary must be more than zero." };
  for (const v of Object.values(i.newAllowances)) if (!Number.isFinite(v) || v < 0) return { ok: false, error: "Allowances must be numbers of zero or more." };
  const dateChanged = date !== rec.effective_from;
  const amountChanged = Math.round(i.newBasic * 100) !== Math.round(rec.base_salary * 100) || !sameAmounts(i.newAllowances, rec.allowances);
  if (!dateChanged && !amountChanged) return { ok: false, error: "Nothing changed. Enter a new effective date and/or new pay." };

  const prev = idx > 0 ? sorted[idx - 1]! : null;
  const next = idx < sorted.length - 1 ? sorted[idx + 1]! : null;
  if (dateChanged) {
    if (date < i.hireDate) return { ok: false, error: `The pay record cannot start before the hire date (${i.hireDate}).` };
    if (date > i.today) return { ok: false, error: `The effective date cannot be later than today (${i.today}). To schedule a future pay change, use Update pay.` };
    if (prev && date === prev.effective_from) return { ok: false, error: `Another pay record already starts on ${prev.effective_from}. Two pay records cannot start on the same day.` };
    if (next && date === next.effective_from) return { ok: false, error: `Another pay record already starts on ${next.effective_from}. Two pay records cannot start on the same day.` };
    if (prev && date < prev.effective_from) return { ok: false, error: `That date is before the pay record that starts on ${prev.effective_from}, which would put the records out of order. Pick a date after ${prev.effective_from}, or correct that record first.` };
    if (next && date > next.effective_from) return { ok: false, error: `That date is after the next pay record, which starts on ${next.effective_from}, and would put the records out of order. Pick a date before ${next.effective_from}, or correct that record first.` };
  }
  for (const p of [...i.pending].sort((a, b) => a.effective_date.localeCompare(b.effective_date))) {
    if (amountChanged && p.basedOnId === rec.id) return { ok: false, error: `A pay change for ${p.effective_date} is already scheduled from this pay record’s current figures. Cancel that scheduled change first, correct this record, then record the change again.` };
    if (dateChanged && p.effective_date <= date) return { ok: false, error: `A pay change is scheduled for ${p.effective_date}. The corrected date must be before it. Cancel that scheduled change first, or pick an earlier date.` };
  }

  const corrected = sorted.map((r) => (r.id === rec.id ? { ...r, effective_from: date, base_salary: i.newBasic, allowances: i.newAllowances } : r));
  return {
    ok: true,
    dateChanged,
    amountChanged,
    beforeToday: asInForce(recordInForce(sorted, i.today)),
    afterToday: asInForce(recordInForce(corrected, i.today)),
    uncoveredFrom: idx === 0 && date > i.hireDate ? i.hireDate : null,
    uncoveredTo: idx === 0 && date > i.hireDate ? date : null,
  };
}

// ---- What the database says it did ------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface PayCorrectionImpact {
  payroll_runs?: { run_id: string; period_month: number; period_year: number; status: string; sent_at: string | null }[];
  final_settlement?: { termination_date: string; reads_current_pay: boolean; statutory_rate_recorded: boolean } | null;
  pending_changes?: { event_id: string; effective_date: string; held: boolean }[];
  in_force_today_before?: InForce | null;
  in_force_today_after?: InForce | null;
}

/** The sentences for "This correction affects: ..." (empty when nothing approved uses the record). Nothing in payroll or settlement was changed: these are for a person to review. */
export function impactLines(impact: PayCorrectionImpact | null | undefined): string[] {
  const lines: string[] = [];
  for (const r of impact?.payroll_runs ?? []) {
    const month = `${MONTHS[r.period_month - 1] ?? r.period_month} ${r.period_year}`;
    lines.push(`The approved payroll export for ${month}${r.sent_at ? ` (sent to payroll on ${longDate(r.sent_at)})` : " (approved, not marked as sent)"} includes this person’s salary for this pay record’s period.`);
  }
  const s = impact?.final_settlement;
  if (s) lines.push(`This person’s final settlement (leaving date ${longDate(s.termination_date)}) is worked out from this pay record, so its figures may change.`);
  for (const p of (impact?.pending_changes ?? []).filter((x) => x.held)) lines.push(`A held pay change dated ${longDate(p.effective_date)} is still waiting for review; it was not changed.`);
  return lines;
}

/** Plain-sentence version of every refusal the database can give; anything else is not shown raw. */
export function payCorrectionErrorMessage(error: { code?: string | null; message?: string | null }): string {
  // The function's own sentences are written for people. A permission or row-security message from the database itself is never shown as it is.
  if (error.code === "42501") return error.message === "Sign in to correct a pay record." ? error.message : "You are not allowed to correct this pay record.";
  if (error.code === "22023") return error.message || "The correction was refused. Nothing was changed.";
  if (error.code === "42883" || error.code === "PGRST202") return "Correcting a pay record is not installed in this environment yet. Nothing was changed.";
  if (error.code === "55P03" || error.code === "40001" || error.code === "40P01") return "Someone else is changing this employee’s pay right now. Nothing was changed. Wait a moment and try again.";
  return "Couldn’t save the correction. Nothing was changed. Try again.";
}
