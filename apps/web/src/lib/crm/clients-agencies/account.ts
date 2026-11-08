import type { CrmActivityRow, CrmFollowUpRow, CrmOpportunityRow, CrmProposalRow, CrmZohoReferenceRow } from "@/types/crm";

/** Pure derivations for one account page. Everything here is computed from recorded rows; nothing is assumed. */

export type Section<T> = { status: "ok"; data: T } | { status: "error" };

export type OppLite = Pick<CrmOpportunityRow, "id" | "company_id" | "reference" | "title" | "stage" | "agency_org_id" | "client_org_id" | "owner_id" | "currency" | "value" | "closed_at" | "created_at">;
export type ProjectLite = { id: string; reference: string; name: string; status: string; completed_at: string | null; crm_opportunity_id: string | null };
export type ActivityLite = Pick<CrmActivityRow, "id" | "opportunity_id" | "kind" | "occurred_at">;
export type FollowUpLite = Pick<CrmFollowUpRow, "id" | "opportunity_id" | "organisation_id" | "title" | "due_at" | "status" | "assigned_to" | "created_by" | "company_id">;
export type ProposalLite = Pick<CrmProposalRow, "id" | "opportunity_id" | "version" | "status" | "sent_on">;
export type ZohoLite = Pick<CrmZohoReferenceRow, "opportunity_id" | "quote_ref" | "quote_sent_on">;

/** How the work reached this account. */
export type Route = "direct" | "through_agency" | "as_agency";

export interface RouteInfo { route: Route; counterpartId: string | null }

/**
 * From THIS account's point of view:
 *  - direct: this organisation is the end client and no other agency is recorded (or it is both agency and client of the same inquiry);
 *  - through_agency: this organisation is the end client and a different agency is recorded (counterpart = that agency);
 *  - as_agency: this organisation is the agency (counterpart = the end client, if recorded).
 */
export function inquiryRoute(opp: Pick<OppLite, "agency_org_id" | "client_org_id">, orgId: string): RouteInfo | null {
  const asAgency = opp.agency_org_id === orgId;
  const asClient = opp.client_org_id === orgId;
  if (asAgency && asClient) return { route: "direct", counterpartId: null };
  if (asAgency) return { route: "as_agency", counterpartId: opp.client_org_id };
  if (asClient) return opp.agency_org_id ? { route: "through_agency", counterpartId: opp.agency_org_id } : { route: "direct", counterpartId: null };
  return null;
}

/** An inquiry is open until it is won or lost (On hold counts as open). The account page and the directory both use this. */
export const isOpenStage = (stage: string) => stage !== "won" && stage !== "lost";
/** A recorded win is an inquiry in stage Won. It is not a project in progress and not a completed project. */
export const isWonStage = (stage: string) => stage === "won";

/**
 * THE definition of "an account's inquiries": the selected company's inquiries that name the account as agency or end client, each counted ONCE
 * (an inquiry naming the account in both roles is one inquiry). The account page, the directory table and the export all count through this.
 */
export function linkedInquiries<T extends Pick<OppLite, "id" | "company_id" | "agency_org_id" | "client_org_id">>(opps: readonly T[], orgId: string, companyId: string): { opp: T; route: Route; counterpartId: string | null }[] {
  const seen = new Set<string>();
  const out: { opp: T; route: Route; counterpartId: string | null }[] = [];
  for (const opp of opps) {
    if (opp.company_id !== companyId || seen.has(opp.id)) continue;
    const r = inquiryRoute(opp, orgId);
    if (!r) continue;
    seen.add(opp.id);
    out.push({ opp, route: r.route, counterpartId: r.counterpartId });
  }
  return out;
}

/** What the directory shows per account (this company only). `lastEnquiryOn` is the Dubai calendar day the newest linked inquiry was recorded; null when there is none. */
export interface EnquiryStats { total: number; open: number; won: number; lastEnquiryOn: string | null }

export function enquiryStats(opps: readonly (Pick<OppLite, "id" | "company_id" | "agency_org_id" | "client_org_id" | "stage" | "created_at">)[], orgId: string, companyId: string): EnquiryStats {
  const linked = linkedInquiries(opps, orgId, companyId).map((i) => i.opp);
  const newest = linked.map((o) => o.created_at).filter((d) => !!d && !Number.isNaN(Date.parse(d))).sort().at(-1);
  return {
    total: linked.length,
    open: linked.filter((o) => isOpenStage(o.stage)).length,
    won: linked.filter((o) => isWonStage(o.stage)).length,
    lastEnquiryOn: newest ? dubaiDate(newest) : null,
  };
}

export const OPEN_STAGES_FOR_REPLY = new Set(["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation"]);
export const dubaiDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });

/** First client response recorded on or after the day the quote was sent (a date, or null when none is recorded). */
export function replyRecordedOn(oppId: string, sentOn: string, activities: readonly ActivityLite[]): string | null {
  const dates = activities.filter((a) => a.opportunity_id === oppId && a.kind === "client_response").map((a) => dubaiDate(a.occurred_at)).filter((d) => d >= sentOn).sort();
  return dates[0] ?? null;
}

export interface QuoteRow {
  key: string;
  opportunityId: string;
  source: "proposal" | "zoho";
  /** "Proposal v2" or the Zoho quote reference. */
  label: string;
  status: string;
  sentOn: string | null;
  replyOn: string | null;
  /** True ONLY when the quote is recorded as sent, the inquiry is still open and no client response is recorded since. Otherwise the plain status is shown. */
  awaitingReply: boolean;
  /** The words shown. */
  display: string;
}

const PROPOSAL_STATUS: Record<string, string> = { draft: "Draft", sent: "Sent", superseded: "Superseded", accepted: "Accepted" };

export function deriveQuotes(opps: readonly Pick<OppLite, "id" | "stage">[], proposals: readonly ProposalLite[], zoho: readonly ZohoLite[], activities: readonly ActivityLite[]): QuoteRow[] {
  const stageBy = new Map(opps.map((o) => [o.id, o.stage]));
  const rows: QuoteRow[] = [];
  const decide = (opportunityId: string, sent: boolean, sentOn: string | null, plain: string) => {
    const reply = sent && sentOn ? replyRecordedOn(opportunityId, sentOn, activities) : null;
    const awaitingReply = sent && !!sentOn && reply === null && OPEN_STAGES_FOR_REPLY.has(stageBy.get(opportunityId) ?? "");
    const display = awaitingReply ? "Awaiting reply" : reply ? `${plain} · reply recorded ${reply}` : plain;
    return { reply, awaitingReply, display };
  };
  for (const p of proposals) {
    if (!stageBy.has(p.opportunity_id)) continue;
    const d = decide(p.opportunity_id, p.status === "sent", p.sent_on, PROPOSAL_STATUS[p.status] ?? p.status);
    rows.push({ key: `p-${p.id}`, opportunityId: p.opportunity_id, source: "proposal", label: `Proposal v${p.version}`, status: p.status, sentOn: p.sent_on, replyOn: d.reply, awaitingReply: d.awaitingReply, display: d.display });
  }
  for (const z of zoho) {
    if (!stageBy.has(z.opportunity_id) || (!z.quote_ref && !z.quote_sent_on)) continue;
    const d = decide(z.opportunity_id, !!z.quote_sent_on, z.quote_sent_on, z.quote_sent_on ? "Sent" : "Not sent");
    rows.push({ key: `z-${z.opportunity_id}`, opportunityId: z.opportunity_id, source: "zoho", label: z.quote_ref ? `Quote ${z.quote_ref}` : "Quote (no reference)", status: z.quote_sent_on ? "sent" : "not_sent", sentOn: z.quote_sent_on, replyOn: d.reply, awaitingReply: d.awaitingReply, display: d.display });
  }
  return rows.sort((a, b) => (b.sentOn ?? "").localeCompare(a.sentOn ?? ""));
}

export type ProjectInfo =
  | { kind: "project"; reference: string; name: string; status: string; completed: boolean }
  | { kind: "handover"; status: string }       // a project is expected (handover recorded) but the project itself cannot be opened by this person
  | { kind: "none" }                          // not won, or no handover recorded
  | { kind: "unknown" };                      // the project/handover read failed: never shown as "none"

export interface InquiryRow {
  opp: OppLite;
  route: Route;
  counterpartId: string | null;
  project: ProjectInfo;
}

export interface AccountView {
  inquiries: InquiryRow[];
  quotes: QuoteRow[];
  followUps: { followUp: FollowUpLite; opp: OppLite; state: "overdue" | "today" | "upcoming" }[];
  /** Open follow-ups placed on the account itself because it has no inquiry (they belong to no opportunity). Counted with the others. */
  accountFollowUps: { followUp: FollowUpLite; state: "overdue" | "today" | "upcoming" }[];
  lastActivity: { at: string; kind: string; opp: OppLite } | null;
  hasHistory: boolean;
  counts: {
    inquiries: number; open: number; won: number; lost: number;
    direct: number; throughAgency: number; asAgency: number;
    /** null when the projects could not be read. Counted once per project; only projects this person can open. */
    completedProjects: number | null;
    /** Won inquiries whose handover exists but whose project this person cannot open (so their completion is not counted). */
    projectsNotVisible: number;
    inquiriesAwaitingReply: number; openFollowUps: number; overdueFollowUps: number;
  };
}

export const COUNT_DEFINITIONS = [
  "Inquiries: every inquiry of the selected company that names this account as its agency or its end client, counted once (even if the account is both).",
  "Direct: this account is the end client and no other agency is recorded. Through an agency: this account is the end client and another agency is recorded. As the agency: this account is the agency. The three add up to the inquiries.",
  "Won inquiries are inquiries confirmed as won. A won inquiry is not a completed project: completed projects are counted separately, once per project, and only for projects you can open.",
  "An inquiry shows on the agency's page and again on its end client's page, because each page shows that account's own work. Do not add two accounts' counts together.",
  "Awaiting reply is shown only where the quote is recorded as sent, the inquiry is still open and no client response has been recorded since it was sent. Otherwise the plain status is shown.",
];

export function deriveAccount(input: {
  orgId: string;
  companyId: string;
  now: Date;
  opportunities: readonly OppLite[];
  proposals: readonly ProposalLite[];
  zoho: readonly ZohoLite[];
  activities: readonly ActivityLite[];
  followUps: readonly FollowUpLite[];
  projects: Section<readonly ProjectLite[]>;
  /** Handover status per won inquiry id (from the Sales-readable handover check); absent = none recorded. Only consulted when no readable project exists. */
  handovers: Section<ReadonlyMap<string, string>>;
}): AccountView {
  const inquiries: InquiryRow[] = linkedInquiries(input.opportunities, input.orgId, input.companyId).map((i) => ({ ...i, project: { kind: "none" } as ProjectInfo }));
  const seen = new Set(inquiries.map((i) => i.opp.id));
  const projectBy = new Map<string, ProjectLite>();
  if (input.projects.status === "ok") for (const p of input.projects.data) if (p.crm_opportunity_id && seen.has(p.crm_opportunity_id)) projectBy.set(p.crm_opportunity_id, p);
  let projectsNotVisible = 0;
  for (const i of inquiries) {
    const p = projectBy.get(i.opp.id);
    if (p) { i.project = { kind: "project", reference: p.reference, name: p.name, status: p.status, completed: p.status === "completed" || p.completed_at !== null }; continue; }
    if (i.opp.stage !== "won") continue;
    if (input.projects.status === "error" || input.handovers.status === "error") { i.project = { kind: "unknown" }; continue; }
    const h = input.handovers.data.get(i.opp.id);
    if (h) { i.project = { kind: "handover", status: h }; if (h === "accepted") projectsNotVisible++; }
  }
  const oppIds = new Set(inquiries.map((i) => i.opp.id));
  const oppBy = new Map(inquiries.map((i) => [i.opp.id, i.opp]));
  const quotes = deriveQuotes(inquiries.map((i) => i.opp), input.proposals.filter((p) => oppIds.has(p.opportunity_id)), input.zoho.filter((z) => oppIds.has(z.opportunity_id)), input.activities);
  const acts = input.activities.filter((a) => oppIds.has(a.opportunity_id)).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const lastActivity = acts[0] ? { at: acts[0].occurred_at, kind: acts[0].kind, opp: oppBy.get(acts[0].opportunity_id)! } : null;
  const todayDubai = dubaiDate(input.now.toISOString());
  const stateOf = (dueAt: string) => { const day = dubaiDate(dueAt); return (day < todayDubai ? "overdue" : day === todayDubai ? "today" : "upcoming") as "overdue" | "today" | "upcoming"; };
  const followUps = input.followUps
    .filter((f) => f.status === "open" && f.opportunity_id !== null && oppIds.has(f.opportunity_id))
    .sort((a, b) => a.due_at.localeCompare(b.due_at))
    .map((f) => ({ followUp: f, opp: oppBy.get(f.opportunity_id!)!, state: stateOf(f.due_at) }));
  const accountFollowUps = input.followUps
    .filter((f) => f.status === "open" && f.opportunity_id === null && f.organisation_id === input.orgId && f.company_id === input.companyId)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))
    .map((f) => ({ followUp: f, state: stateOf(f.due_at) }));
  const count = (route: Route) => inquiries.filter((i) => i.route === route).length;
  const completed = input.projects.status === "ok" ? new Set([...projectBy.values()].filter((p) => p.status === "completed" || p.completed_at !== null).map((p) => p.id)).size : null;
  return {
    inquiries,
    quotes,
    followUps,
    accountFollowUps,
    lastActivity,
    hasHistory: inquiries.length > 0,
    counts: {
      inquiries: inquiries.length,
      open: inquiries.filter((i) => isOpenStage(i.opp.stage)).length,
      won: inquiries.filter((i) => isWonStage(i.opp.stage)).length,
      lost: inquiries.filter((i) => i.opp.stage === "lost").length,
      direct: count("direct"), throughAgency: count("through_agency"), asAgency: count("as_agency"),
      completedProjects: completed, projectsNotVisible,
      inquiriesAwaitingReply: new Set(quotes.filter((q) => q.awaitingReply).map((q) => q.opportunityId)).size,
      openFollowUps: followUps.length + accountFollowUps.length,
      overdueFollowUps: [...followUps, ...accountFollowUps].filter((f) => f.state === "overdue").length,
    },
  };
}
