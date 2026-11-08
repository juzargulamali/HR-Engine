import { describe, expect, it } from "vitest";
import { deriveAccount, inquiryRoute, type ActivityLite, type FollowUpLite, type OppLite, type ProjectLite, type ProposalLite, type Section, type ZohoLite } from "./account";

const CO = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_CO = "bbbbbbbb-0000-4000-8000-000000000002";
const AGENCY = "ag", CLIENT = "cl", ZETA = "other-agency";
const NOW = new Date("2026-11-10T08:00:00Z");

const opp = (id: string, extra: Partial<OppLite> = {}): OppLite => ({
  id, company_id: CO, reference: `UAE-${id}`, title: `Job ${id}`, stage: "new", agency_org_id: null, client_org_id: null, owner_id: "u", currency: "AED", value: null, closed_at: null, created_at: "", ...extra,
});
const ok = <T,>(data: T): Section<T> => ({ status: "ok", data });
const base = { companyId: CO, now: NOW, proposals: [] as ProposalLite[], zoho: [] as ZohoLite[], activities: [] as ActivityLite[], followUps: [] as FollowUpLite[], projects: ok<ProjectLite[]>([]), handovers: ok(new Map<string, string>()) };

describe("how the work came", () => {
  it("derives direct, through an agency and as the agency from the inquiry's own organisations", () => {
    expect(inquiryRoute({ agency_org_id: null, client_org_id: CLIENT }, CLIENT)).toEqual({ route: "direct", counterpartId: null });
    expect(inquiryRoute({ agency_org_id: AGENCY, client_org_id: CLIENT }, CLIENT)).toEqual({ route: "through_agency", counterpartId: AGENCY });
    expect(inquiryRoute({ agency_org_id: AGENCY, client_org_id: CLIENT }, AGENCY)).toEqual({ route: "as_agency", counterpartId: CLIENT });
    expect(inquiryRoute({ agency_org_id: AGENCY, client_org_id: null }, AGENCY)).toEqual({ route: "as_agency", counterpartId: null });
    expect(inquiryRoute({ agency_org_id: CLIENT, client_org_id: CLIENT }, CLIENT)).toEqual({ route: "direct", counterpartId: null });
    expect(inquiryRoute({ agency_org_id: ZETA, client_org_id: ZETA }, CLIENT)).toBeNull();
  });
});

describe("counts: once per account, won apart from completed, company only", () => {
  const opps = [
    opp("1", { client_org_id: CLIENT }),                                              // direct, open
    opp("2", { client_org_id: CLIENT, agency_org_id: AGENCY, stage: "won" }),        // through agency, won, completed project
    opp("3", { client_org_id: CLIENT, agency_org_id: AGENCY, stage: "won" }),        // won, project in progress
    opp("4", { client_org_id: CLIENT, agency_org_id: CLIENT, stage: "lost" }),       // both fields = this org: counted once, direct
    opp("5", { client_org_id: CLIENT, stage: "won" }),                               // won, handover accepted but project not visible
    opp("6", { client_org_id: CLIENT, company_id: OTHER_CO }),                        // another company: never counted
    opp("1", { client_org_id: CLIENT }),                                              // the same row twice: counted once
  ];
  const projects: ProjectLite[] = [
    { id: "p2", reference: "PRJ-2", name: "Two", status: "completed", completed_at: "2026-10-01", crm_opportunity_id: "2" },
    { id: "p3", reference: "PRJ-3", name: "Three", status: "in_progress", completed_at: null, crm_opportunity_id: "3" },
  ];
  const v = deriveAccount({ ...base, orgId: CLIENT, opportunities: opps, projects: ok(projects), handovers: ok(new Map([["5", "accepted"]])) });
  it("counts each inquiry once and only for the selected company", () => {
    expect(v.counts).toMatchObject({ inquiries: 5, open: 1, won: 3, lost: 1, direct: 3, throughAgency: 2, asAgency: 0 });
    expect(v.counts.direct + v.counts.throughAgency + v.counts.asAgency).toBe(v.counts.inquiries);
  });
  it("keeps won inquiries apart from completed projects and says what it cannot see", () => {
    expect(v.counts.won).toBe(3);
    expect(v.counts.completedProjects).toBe(1);
    expect(v.counts.projectsNotVisible).toBe(1);
    expect(v.inquiries.find((i) => i.opp.id === "5")?.project).toEqual({ kind: "handover", status: "accepted" });
    expect(v.inquiries.find((i) => i.opp.id === "3")?.project).toMatchObject({ kind: "project", completed: false });
  });
  it("shows the same inquiry on the agency's page as work done as the agency, not added to the client", () => {
    const a = deriveAccount({ ...base, orgId: AGENCY, opportunities: opps });
    expect(a.counts).toMatchObject({ inquiries: 2, asAgency: 2, throughAgency: 0, direct: 0 });
  });
  it("never turns a failed projects read into 'no completed projects'", () => {
    const failed = deriveAccount({ ...base, orgId: CLIENT, opportunities: opps, projects: { status: "error" } });
    expect(failed.counts.completedProjects).toBeNull();
    expect(failed.inquiries.find((i) => i.opp.id === "2")?.project).toEqual({ kind: "unknown" });
    const failedHandover = deriveAccount({ ...base, orgId: CLIENT, opportunities: opps, handovers: { status: "error" } });
    expect(failedHandover.inquiries.find((i) => i.opp.id === "5")?.project).toEqual({ kind: "unknown" });
  });
});

describe("quotes: 'awaiting reply' only where the data supports it", () => {
  const opps = [opp("1", { client_org_id: CLIENT, stage: "quote_sent" }), opp("2", { client_org_id: CLIENT, stage: "negotiation" }), opp("3", { client_org_id: CLIENT, stage: "won" }), opp("4", { client_org_id: CLIENT, stage: "on_hold" })];
  const proposals: ProposalLite[] = [
    { id: "a", opportunity_id: "1", version: 1, status: "sent", sent_on: "2026-11-01" },      // no reply: awaiting
    { id: "b", opportunity_id: "2", version: 1, status: "sent", sent_on: "2026-11-01" },      // client responded after: not awaiting
    { id: "c", opportunity_id: "3", version: 1, status: "sent", sent_on: "2026-10-01" },      // inquiry closed: plain status
    { id: "d", opportunity_id: "1", version: 2, status: "draft", sent_on: null },             // draft: plain
    { id: "e", opportunity_id: "4", version: 1, status: "sent", sent_on: "2026-11-01" },      // on hold: plain
  ];
  const activities: ActivityLite[] = [
    { id: "x", opportunity_id: "2", kind: "client_response", occurred_at: "2026-11-03T10:00:00Z" },
    { id: "y", opportunity_id: "1", kind: "call", occurred_at: "2026-11-04T10:00:00Z" },     // our own call is not a reply
    { id: "z", opportunity_id: "1", kind: "client_response", occurred_at: "2026-10-20T10:00:00Z" }, // reply BEFORE it was sent: not a reply to it
  ];
  const zoho: ZohoLite[] = [{ opportunity_id: "1", quote_ref: "Q-FICT-1", quote_sent_on: "2026-11-02" }, { opportunity_id: "2", quote_ref: "Q-FICT-2", quote_sent_on: null }];
  const v = deriveAccount({ ...base, orgId: CLIENT, opportunities: opps, proposals, activities, zoho });
  const q = (key: string) => v.quotes.find((x) => x.key === key)!;
  it("flags a sent quote on an open inquiry with no later client response, and nothing else", () => {
    expect(q("p-a")).toMatchObject({ awaitingReply: true, display: "Awaiting reply" });
    expect(q("z-1")).toMatchObject({ awaitingReply: true });
    expect(q("p-b")).toMatchObject({ awaitingReply: false, display: "Sent · reply recorded 2026-11-03" });
    expect(q("p-c")).toMatchObject({ awaitingReply: false, display: "Sent" });
    expect(q("p-d")).toMatchObject({ awaitingReply: false, display: "Draft" });
    expect(q("p-e")).toMatchObject({ awaitingReply: false, display: "Sent" });
    expect(q("z-2")).toMatchObject({ awaitingReply: false, display: "Not sent" });
  });
  it("counts an inquiry once even when it has a proposal and a Zoho quote awaiting reply", () => {
    expect(v.counts.inquiriesAwaitingReply).toBe(1);
  });
});

describe("history, last activity and follow-ups", () => {
  it("an imported account with no linked history has no activity, quotes or follow-ups, and says so", () => {
    const v = deriveAccount({ ...base, orgId: "imported", opportunities: [opp("1", { client_org_id: CLIENT })] });
    expect(v.hasHistory).toBe(false);
    expect(v.lastActivity).toBeNull();
    expect(v.quotes).toEqual([]);
    expect(v.followUps).toEqual([]);
    expect(v.counts).toMatchObject({ inquiries: 0, won: 0, completedProjects: 0, openFollowUps: 0 });
  });
  it("reports the most recent activity and splits follow-ups into overdue, today and upcoming", () => {
    const v = deriveAccount({
      ...base, orgId: CLIENT, opportunities: [opp("1", { client_org_id: CLIENT }), opp("2", { client_org_id: CLIENT, stage: "won" })],
      activities: [
        { id: "a", opportunity_id: "1", kind: "call", occurred_at: "2026-11-01T10:00:00Z" },
        { id: "b", opportunity_id: "2", kind: "meeting", occurred_at: "2026-11-05T10:00:00Z" },
      ],
      followUps: [
        { id: "f1", opportunity_id: "1", organisation_id: null, created_by: "omar", company_id: CO, title: "Overdue", due_at: "2026-11-08T05:00:00Z", status: "open", assigned_to: "omar" },
        { id: "f2", opportunity_id: "1", organisation_id: null, created_by: "omar", company_id: CO, title: "Today", due_at: "2026-11-10T09:00:00Z", status: "open", assigned_to: "omar" },
        { id: "f3", opportunity_id: "1", organisation_id: null, created_by: "omar", company_id: CO, title: "Later", due_at: "2026-11-20T09:00:00Z", status: "open", assigned_to: "sara" },
        { id: "f4", opportunity_id: "1", organisation_id: null, created_by: "omar", company_id: CO, title: "Done", due_at: "2026-11-01T09:00:00Z", status: "done", assigned_to: "omar" },
        { id: "f5", opportunity_id: "elsewhere", organisation_id: null, created_by: "omar", company_id: CO, title: "Not this account", due_at: "2026-11-01T09:00:00Z", status: "open", assigned_to: "omar" },
      ],
    });
    expect(v.lastActivity).toMatchObject({ kind: "meeting", opp: { id: "2" } });
    expect(v.followUps.map((f) => [f.followUp.title, f.state])).toEqual([["Overdue", "overdue"], ["Today", "today"], ["Later", "upcoming"]]);
    expect(v.counts).toMatchObject({ openFollowUps: 3, overdueFollowUps: 1 });
  });

  it("follow-ups placed on the account itself (no inquiry) are listed and counted with the others, for this account and company only", () => {
    const fu = (id: string, over: Record<string, unknown>) => ({ id, opportunity_id: null, organisation_id: CLIENT, title: id, due_at: "2026-11-20T09:00:00Z", status: "open", assigned_to: "omar", created_by: "sara", company_id: CO, ...over }) as FollowUpLite;
    const v = deriveAccount({
      ...base, orgId: CLIENT, opportunities: [],
      followUps: [fu("late", { due_at: "2026-11-08T05:00:00Z" }), fu("later", {}), fu("closed", { status: "done" }), fu("other-account", { organisation_id: "someone-else" }), fu("other-company", { company_id: OTHER_CO })],
    });
    expect(v.hasHistory).toBe(false);          // still an account with no inquiry: the history card and its wording are unchanged
    expect(v.followUps).toEqual([]);
    expect(v.accountFollowUps.map((f) => [f.followUp.title, f.state])).toEqual([["late", "overdue"], ["later", "upcoming"]]);
    expect(v.counts).toMatchObject({ openFollowUps: 2, overdueFollowUps: 1, inquiries: 0 });
  });
});
