/**
 * Pure calculations behind the Sales overview, opportunity list and reports pages. No database, no `server-only`
 * import and no clock of their own (callers pass `now`), so every rule here is unit-tested deterministically.
 * Money is never added across currencies: every total is a per-currency record.
 */
import {
  CRM_PIPELINE_STAGES,
  crmToday,
  followUpTiming,
  isCrmActive,
  isCrmClosed,
  isCrmOpen,
  isCommerciallyWon,
  responseTimeKpi,
  totalsByCurrency,
  type CrmStageId,
  type FollowUpTiming,
  type ResponseKpi,
} from "@enginious-hr/domain";
import type { CrmClosureRow, CrmOpportunityRow, CrmZohoReferenceRow } from "@/types/crm";

/** Per-currency totals as display lines, sorted by currency code. Empty when nothing carries a value. */
export function currencyLines(totals: Record<string, number>): { currency: string; amount: number }[] {
  return Object.keys(totals)
    .sort()
    .map((currency) => ({ currency, amount: totals[currency] as number }));
}

// ----------------------------------------------------------------------------------------------------------------
// Periods
// ----------------------------------------------------------------------------------------------------------------

export interface Period {
  /** Inclusive Dubai dates, YYYY-MM-DD. */
  from: string;
  to: string;
}

const isPlainDate = (s: string | undefined | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Selected period from the query string; defaults to the last 90 days ending today (Dubai). A reversed range is swapped. */
export function resolvePeriod(fromParam: string | undefined, toParam: string | undefined, now: Date = new Date()): Period {
  const to = isPlainDate(toParam) ? toParam : crmToday(now);
  const from = isPlainDate(fromParam) ? fromParam : addDays(to, -90);
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Whether an instant falls on a Dubai date inside the period. Null never does. */
export function inPeriod(iso: string | null | undefined, period: Period): boolean {
  if (!iso) return false;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  const day = crmToday(t);
  return day >= period.from && day <= period.to;
}

// ----------------------------------------------------------------------------------------------------------------
// Report inputs
// ----------------------------------------------------------------------------------------------------------------

export type ReportOpp = Pick<
  CrmOpportunityRow,
  "id" | "company_id" | "owner_id" | "stage" | "currency" | "source" | "created_at" | "first_response_at" | "closed_at" | "stage_changed_at" | "lost_reason" | "evidence_reference"
> & { value: number | null };

const openOnly = (opps: readonly ReportOpp[]) => opps.filter((o) => isCrmOpen(o.stage));

export interface Bucket {
  count: number;
  /** Per-currency value of the opportunities in this bucket that have a value. */
  totals: Record<string, number>;
  /** Opportunities in the bucket with no value recorded (so a total can be read as "at least"). */
  unvalued: number;
}

function bucketOf(opps: readonly ReportOpp[]): Bucket {
  return { count: opps.length, totals: totalsByCurrency(opps.map((o) => ({ currency: o.currency, value: o.value }))), unvalued: opps.filter((o) => o.value == null).length };
}

/** The six working stages plus On hold, open opportunities only. */
export function openPipelineByStage(opps: readonly ReportOpp[], stages: readonly CrmStageId[] = [...CRM_PIPELINE_STAGES, "on_hold"]): (Bucket & { stage: CrmStageId })[] {
  const open = openOnly(opps);
  return stages.map((stage) => ({ stage, ...bucketOf(open.filter((o) => o.stage === stage)) }));
}

export function openPipelineByOwner(opps: readonly ReportOpp[]): (Bucket & { ownerId: string })[] {
  const open = openOnly(opps);
  const owners = [...new Set(open.map((o) => o.owner_id))];
  return owners.map((ownerId) => ({ ownerId, ...bucketOf(open.filter((o) => o.owner_id === ownerId)) })).sort((a, b) => b.count - a.count);
}

export interface FollowUpCounts {
  overdue: number;
  dueToday: number;
  upcoming: number;
}

/** Counts of OPEN follow-ups by timing (done and cancelled ones are ignored). */
export function followUpCounts(followUps: readonly { due_at: string; status: string }[], now: Date = new Date()): FollowUpCounts {
  const out: FollowUpCounts = { overdue: 0, dueToday: 0, upcoming: 0 };
  for (const f of followUps) {
    if (f.status !== "open") continue;
    const t: FollowUpTiming = followUpTiming(f.due_at, now);
    if (t === "overdue") out.overdue++;
    else if (t === "due_today") out.dueToday++;
    else out.upcoming++;
  }
  return out;
}

export interface WonLost {
  won: number;
  lost: number;
  /** Won with no evidence recorded: not counted as won (see isCommerciallyWon), shown so it is not silently lost. */
  wonWithoutEvidence: number;
  /** Won share of won + lost, whole percent. Null when nothing closed in the period (never 0%). */
  winRatePercent: number | null;
  wonValue: Record<string, number>;
  lostReasons: { reason: string; count: number }[];
  wonOpps: ReportOpp[];
}

/** Closed opportunities whose closing date falls in the period. */
export function wonLostInPeriod(opps: readonly ReportOpp[], period: Period): WonLost {
  const closedIn = opps.filter((o) => isCrmClosed(o.stage) && inPeriod(o.closed_at ?? o.stage_changed_at, period));
  const wonStage = closedIn.filter((o) => o.stage === "won");
  const wonOpps = wonStage.filter((o) => isCommerciallyWon({ stage: o.stage, evidenceReference: o.evidence_reference }));
  const lost = closedIn.filter((o) => o.stage === "lost");
  const reasons = new Map<string, number>();
  for (const o of lost) {
    const r = o.lost_reason?.trim() || "No reason recorded";
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const decided = wonOpps.length + lost.length;
  return {
    won: wonOpps.length,
    lost: lost.length,
    wonWithoutEvidence: wonStage.length - wonOpps.length,
    winRatePercent: decided === 0 ? null : Math.round((wonOpps.length / decided) * 100),
    wonValue: totalsByCurrency(wonOpps.map((o) => ({ currency: o.currency, value: o.value }))),
    lostReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    wonOpps,
  };
}

/**
 * Closures that were later reopened. A reopened opportunity is open again, so it no longer counts as won or lost in the
 * figures above; the closure itself is kept in history (crm_closures) and is reported here so it is neither lost nor
 * silently counted. Counted by the date the closure originally happened.
 */
export function reopenedClosures(closures: readonly Pick<CrmClosureRow, "outcome" | "closed_at" | "reopened_at">[], period: Period): { won: number; lost: number; total: number } {
  const hit = closures.filter((c) => c.reopened_at !== null && inPeriod(c.closed_at, period));
  const won = hit.filter((c) => c.outcome === "won").length;
  return { won, lost: hit.length - won, total: hit.length };
}

/** Enquiries logged in the period, by source (free text as entered, grouped case-insensitively). */
export function enquiriesBySource(opps: readonly ReportOpp[], period: Period): { source: string; count: number }[] {
  const by = new Map<string, { source: string; count: number }>();
  for (const o of opps) {
    if (!inPeriod(o.created_at, period)) continue;
    const label = o.source?.trim() || "Not recorded";
    const key = label.toLowerCase();
    const cur = by.get(key);
    if (cur) cur.count++;
    else by.set(key, { source: label, count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

// ----------------------------------------------------------------------------------------------------------------
// Timeliness
// ----------------------------------------------------------------------------------------------------------------

export interface CompanyResponseConfig {
  id: string;
  name: string;
  responseTargetHours: number | null;
  workingCalendar: unknown;
}

export interface CompanyTimeliness {
  companyId: string;
  companyName: string;
  enquiries: number;
  kpi: ResponseKpi;
}

/**
 * The response-time KPI per company (each has its own target and calendar, so companies are never blended). A company
 * with no target or calendar yields `not_configured` with the reason; there is no number to misread as zero.
 */
export function timelinessByCompany(opps: readonly ReportOpp[], companies: readonly CompanyResponseConfig[], period: Period, now: Date = new Date()): CompanyTimeliness[] {
  return companies.map((c) => {
    const mine = opps.filter((o) => o.company_id === c.id && inPeriod(o.created_at, period));
    const kpi = responseTimeKpi(
      { responseTargetHours: c.responseTargetHours, workingCalendar: c.workingCalendar },
      mine.map((o) => ({ createdAt: o.created_at, firstResponseAt: o.first_response_at })),
      now,
    );
    return { companyId: c.id, companyName: c.name, enquiries: mine.length, kpi };
  });
}

/** Plain elapsed (wall-clock) time to first response. The only timeliness figure available without a configured target. */
export function elapsedFirstResponse(opps: readonly ReportOpp[], period: Period): { enquiries: number; responded: number; awaiting: number; medianHours: number | null } {
  const inScope = opps.filter((o) => inPeriod(o.created_at, period));
  const hours = inScope
    .filter((o) => o.first_response_at)
    .map((o) => Math.max(0, (Date.parse(o.first_response_at as string) - Date.parse(o.created_at)) / 3_600_000))
    .sort((a, b) => a - b);
  const mid = Math.floor(hours.length / 2);
  const median = hours.length === 0 ? null : hours.length % 2 ? (hours[mid] as number) : ((hours[mid - 1] as number) + (hours[mid] as number)) / 2;
  return { enquiries: inScope.length, responded: hours.length, awaiting: inScope.length - hours.length, medianHours: median };
}

// ----------------------------------------------------------------------------------------------------------------
// Won value against manual Zoho references
// ----------------------------------------------------------------------------------------------------------------

export interface WonValueRow {
  opp: ReportOpp;
  zoho: CrmZohoReferenceRow | null;
}

export function wonValueRows(wonOpps: readonly ReportOpp[], zoho: readonly CrmZohoReferenceRow[]): WonValueRow[] {
  const by = new Map(zoho.map((z) => [z.opportunity_id, z]));
  return wonOpps.map((opp) => ({ opp, zoho: by.get(opp.id) ?? null }));
}

/**
 * Counts and per-currency amounts taken from the manually entered references. "Invoiced" means an invoice reference or
 * date was typed in; "collected" means a payment date was typed in. Nothing here is read from Zoho Books.
 */
export function zohoSummary(rows: readonly WonValueRow[]): { invoicedCount: number; collectedCount: number; paidRecorded: Record<string, number> } {
  const invoiced = rows.filter((r) => r.zoho && (r.zoho.invoice_ref || r.zoho.invoice_issued_on));
  const collected = rows.filter((r) => r.zoho?.payment_received_on);
  const paidRecorded = totalsByCurrency(rows.map((r) => ({ currency: r.opp.currency, value: r.zoho?.paid_amount == null ? null : Number(r.zoho.paid_amount) })));
  return { invoicedCount: invoiced.length, collectedCount: collected.length, paidRecorded };
}

// ----------------------------------------------------------------------------------------------------------------
// Opportunity list filtering
// ----------------------------------------------------------------------------------------------------------------

export type OppStatusFilter = "open" | "closed" | "all";

export interface OppFilter {
  q: string;
  stage: string;
  company: string;
  owner: string;
  mine: boolean;
  status: OppStatusFilter;
}

interface Filterable {
  opp: Pick<CrmOpportunityRow, "reference" | "title" | "stage" | "company_id" | "owner_id">;
  agency: { name: string } | null;
  client: { name: string } | null;
}

/**
 * Text search covers reference, title and organisation names. A chosen stage wins over the open/closed switch (asking
 * for "Won" must not be silently emptied by the default "open" status).
 */
export function filterOpportunities<T extends Filterable>(items: readonly T[], f: OppFilter, userId: string): T[] {
  const needle = f.q.trim().toLowerCase();
  return items.filter((i) => {
    const o = i.opp;
    if (f.stage) {
      if (o.stage !== f.stage) return false;
    } else if (f.status === "open" ? !isCrmOpen(o.stage) : f.status === "closed" ? isCrmOpen(o.stage) : false) return false;
    if (f.company && o.company_id !== f.company) return false;
    if (f.owner && o.owner_id !== f.owner) return false;
    if (f.mine && o.owner_id !== userId) return false;
    if (!needle) return true;
    return [o.reference, o.title, i.agency?.name, i.client?.name].some((s) => s?.toLowerCase().includes(needle));
  });
}

/** "Agency for Client", or whichever exists. */
export function organisationLabel(i: { agency: { name: string } | null; client: { name: string } | null }): string {
  if (i.agency && i.client) return `${i.agency.name} for ${i.client.name}`;
  return i.agency?.name ?? i.client?.name ?? "No organisation";
}

// ----------------------------------------------------------------------------------------------------------------
// Overview: what needs attention now
// ----------------------------------------------------------------------------------------------------------------

export type AttentionKind = "overdue" | "due_today" | "no_next_action" | "hold_review" | "no_first_response";

export interface AttentionItem {
  kind: AttentionKind;
  opportunityId: string;
  reference: string;
  title: string;
  /** Plain-words reason shown to the person. */
  detail: string;
  /** Due moment (follow-ups) or review date (holds), for ordering and display. */
  at: string | null;
}

const RANK: Record<AttentionKind, number> = { overdue: 0, due_today: 1, hold_review: 2, no_next_action: 3, no_first_response: 4 };

interface AttentionOpp {
  opp: Pick<CrmOpportunityRow, "id" | "reference" | "title" | "stage" | "owner_id" | "hold_review_date" | "first_response_at">;
  openFollowUps: number;
}

interface AttentionFollowUp {
  followUp: { assigned_to: string; title: string; due_at: string; status: string };
  opportunity: { id: string; reference: string; title: string };
}

/**
 * Overdue and due-today follow-ups assigned to the person, plus the opportunities they own that are active without a
 * next action, on hold with a review date that has arrived, or still without a first response. `scope: "all"` drops the
 * "assigned to / owned by me" restriction.
 */
export function attentionItems(
  input: { opportunities: readonly AttentionOpp[]; followUps: readonly AttentionFollowUp[]; userId: string; scope: "mine" | "all" },
  now: Date = new Date(),
): AttentionItem[] {
  const today = crmToday(now);
  const mineOnly = input.scope === "mine";
  const out: AttentionItem[] = [];
  for (const f of input.followUps) {
    if (f.followUp.status !== "open" || (mineOnly && f.followUp.assigned_to !== input.userId)) continue;
    const t = followUpTiming(f.followUp.due_at, now);
    if (t === "upcoming") continue;
    out.push({ kind: t === "overdue" ? "overdue" : "due_today", opportunityId: f.opportunity.id, reference: f.opportunity.reference, title: f.opportunity.title, detail: f.followUp.title, at: f.followUp.due_at });
  }
  for (const { opp, openFollowUps } of input.opportunities) {
    if (mineOnly && opp.owner_id !== input.userId) continue;
    const base = { opportunityId: opp.id, reference: opp.reference, title: opp.title };
    if (isCrmActive(opp.stage) && openFollowUps === 0) out.push({ ...base, kind: "no_next_action", detail: "No next action planned", at: null });
    if (opp.stage === "on_hold" && opp.hold_review_date && opp.hold_review_date <= today) out.push({ ...base, kind: "hold_review", detail: "Hold review date has arrived", at: opp.hold_review_date });
    if (isCrmOpen(opp.stage) && !opp.first_response_at) out.push({ ...base, kind: "no_first_response", detail: "Enquiry logged, no first response yet", at: null });
  }
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.at ?? "").localeCompare(b.at ?? ""));
}
