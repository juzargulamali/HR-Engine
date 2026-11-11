/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("@/components/sales/follow-up-dialogs", () => ({ NewFollowUpButton: () => "ACTION:add-follow-up" as unknown as null }));
let marks = new Map<string, { finalised: boolean }>();
let marksFail = false;
vi.mock("@/lib/crm/data", () => ({ loadEstimateMarks: async () => { if (marksFail) throw new Error("down"); return marks; } }));
let handover: unknown = { status: "ok", handover: null };
vi.mock("@/lib/crm/handover-attention-data", () => ({ loadHandoverRead: async () => handover }));

import type { DetailSection } from "@/lib/crm/data";
import { handoverGuide, nextAction, stageGuide, type GuideFacts } from "@/lib/crm/enquiry-guide";
import { DetailTabs, TabLink } from "./detail-tabs";
import { EnquiryGuide } from "./enquiry-guide";
import { timelineItems } from "./timeline";
import { TimelineList } from "./timeline-list";
import { buildOppView } from "./view";

afterEach(() => { cleanup(); marks = new Map(); marksFail = false; handover = { status: "ok", handover: null }; });

// Fictional data only.
const NOW = new Date("2026-11-11T08:00:00Z");
const base: GuideFacts = {
  stage: "qualified", stageBeforeHold: null, holdReason: null, holdReviewDate: null, lostReason: null, waitingOn: null, firstResponseAt: "2026-11-01T08:00:00Z",
  followUps: { failed: false, next: { title: "Call the client", dueAt: "2026-11-20T06:00:00Z", assigneeName: "Fictional Sami" } },
  sentProposal: null, sentEstimate: null, quoteRef: null, estimates: { finalisedUnsent: 0, drafts: 0 }, canEdit: true, today: "2026-11-11",
};
const f = (over: Partial<GuideFacts>): GuideFacts => ({ ...base, ...over });
const text = (g: { headline: string; lines: string[] }) => [g.headline, ...g.lines].join(" | ");

describe("the next action is the recorded follow-up, or plainly none", () => {
  it("shows who and how urgent: planned, due today, overdue", () => {
    expect(nextAction(base, NOW)).toMatchObject({ tone: "blue", label: "Planned", title: "Call the client", detail: "Fictional Sami", missing: false });
    expect(nextAction(f({ followUps: { failed: false, next: { title: "Call", dueAt: "2026-11-11T12:00:00Z", assigneeName: "X" } } }), NOW)).toMatchObject({ tone: "amber", label: "Due today" });
    expect(nextAction(f({ followUps: { failed: false, next: { title: "Call", dueAt: "2026-11-05T12:00:00Z", assigneeName: "X" } } }), NOW)).toMatchObject({ tone: "red", label: "Overdue" });
  });
  it("says so when none is recorded on an active enquiry; a hold, a closed enquiry and a failed read are not 'missing'", () => {
    expect(nextAction(f({ followUps: { failed: false, next: null } }), NOW)).toMatchObject({ tone: "amber", title: "No next action is recorded", missing: true });
    expect(nextAction(f({ stage: "on_hold", holdReviewDate: "2026-12-01", followUps: { failed: false, next: null } }), NOW)).toMatchObject({ missing: false, label: "On hold" });
    expect(nextAction(f({ stage: "won" }), NOW)).toMatchObject({ missing: false, label: "Closed" });
    expect(nextAction(f({ followUps: { failed: true } }), NOW)).toMatchObject({ tone: "red", label: "Could not load", missing: false });
  });
});

describe("where it stands: recorded facts only", () => {
  it("a new enquiry with no first response leads to logging it; once recorded the line is gone", () => {
    const g = stageGuide(f({ stage: "new", firstResponseAt: null }));
    expect(text(g)).toMatch(/No first response is recorded yet/);
    expect(g.links[0]).toMatchObject({ label: "Log the first response", tab: "activity", primary: true });
    expect(text(stageGuide(f({ stage: "new" })))).not.toMatch(/first response/);
  });
  it("a finalised estimate that is not recorded as sent leads to the Estimates tab; nothing is assumed sent", () => {
    const g = stageGuide(f({ estimates: { finalisedUnsent: 1, drafts: 0 } }));
    expect(g.tone).toBe("amber");
    expect(text(g)).toMatch(/A finalised estimate is not recorded as sent\. After you send it to the client, record it on the Estimates tab/);
    expect(g.links.find((l) => l.tab === "quotations")).toMatchObject({ label: "Record estimate as sent", primary: true });
    expect(text(g)).not.toMatch(/recorded as sent on/);
    expect(text(stageGuide(f({})))).toMatch(/Nothing is recorded as sent yet/);
    expect(text(stageGuide(f({ estimates: { finalisedUnsent: 0, drafts: 2 } })))).toMatch(/2 draft estimates are not finalised yet/);
  });
  it("awaiting the client: says exactly what was recorded as sent (reference, revision, date) and never invents a reply", () => {
    const g = stageGuide(f({ stage: "estimate_sent", sentEstimate: { reference: "EST-QA-2026-0007", revision: 2, sentOn: "2026-11-06" } }));
    expect(g.headline).toBe("Estimate sent: awaiting the client");
    expect(text(g)).toContain("Estimate EST-QA-2026-0007, revision 2, recorded as sent on 6 Nov 2026.");
    expect(text(g)).toContain("No client reply is assumed");
    const p = stageGuide(f({ stage: "proposal_sent", sentProposal: { version: 3, sentOn: "2026-11-02" }, waitingOn: "client" }));
    expect(text(p)).toContain("Proposal version 3 recorded as sent on 2 Nov 2026.");
    expect(text(p)).toContain("Recorded as waiting on the client.");
    expect(text(stageGuide(f({ stage: "quote_sent", quoteRef: { ref: "QT-1001", sentOn: "2026-11-08" } })))).toContain("Zoho Books quote QT-1001 sent on 8 Nov 2026.");
  });
  it("a failed read is said, not shown as 'nothing sent'", () => {
    const g = stageGuide(f({ stage: "estimate_sent", sentEstimate: "unknown", sentProposal: "unknown", quoteRef: "unknown", estimates: "unknown" }));
    expect(text(g)).toMatch(/Could not load which estimates were recorded as sent/);
    expect(text(g)).toMatch(/Could not load the proposal versions/);
    expect(text(g)).not.toMatch(/Nothing is recorded as sent/);
  });
  it("on hold and lost explain the status with what is recorded", () => {
    expect(text(stageGuide(f({ stage: "on_hold", holdReason: "Client postponed event", holdReviewDate: "2026-11-10", stageBeforeHold: "estimate_sent" })))).toMatch(/review date has arrived.*Client postponed event.*returns it to Estimate sent/);
    expect(text(stageGuide(f({ stage: "lost", lostReason: "Event cancelled" })))).toMatch(/Lost \| Reason recorded: Event cancelled\. \| It is read-only/);
  });
});

describe("won: the delivery handover and who has it", () => {
  const who = { ownerName: "Fictional Sami", canEdit: true };
  const h = (status: string, over: Record<string, unknown> = {}) => ({ status: "ok" as const, handover: { status, pmName: "Fictional Petra", projectId: null, projectReference: null, clarificationNote: null, ...over } });
  it("names each state and the next owner", () => {
    expect(handoverGuide({ status: "ok", handover: null }, who)).toMatchObject({ state: "Handover needed", nextOwner: "Fictional Sami", action: { label: "Prepare the handover", primary: true } });
    expect(handoverGuide(h("draft"), who)).toMatchObject({ state: "Handover needed", action: { label: "Continue the handover" } });
    expect(handoverGuide(h("submitted"), who)).toMatchObject({ state: "Waiting for PM assignment", nextOwner: "A Projects founder" });
    expect(handoverGuide(h("pm_assigned"), who)).toMatchObject({ state: "Waiting for PM acceptance", nextOwner: "Fictional Petra" });
    const q = handoverGuide(h("clarification_requested", { clarificationNote: "What are the final installation dates?" }), who);
    expect(q).toMatchObject({ state: "PM asked a question", nextOwner: "Fictional Sami", action: { label: "Answer and resubmit", primary: true } });
    expect(q.lines[0]).toBe("Fictional Petra asked: What are the final installation dates?");
  });
  it("project created: the link appears only when the database let this person see the project", () => {
    const seen = handoverGuide(h("accepted", { projectId: "p1", projectReference: "PRJ-QA-2026-0003" }), who);
    expect(seen).toMatchObject({ state: "Project created", project: { id: "p1", reference: "PRJ-QA-2026-0003" } });
    const hidden = handoverGuide(h("accepted", { projectId: "p1", projectReference: null }), who);
    expect(hidden.project).toBeNull();
    expect(hidden.lines[0]).toMatch(/You do not have access to the project itself/);
  });
  it("someone who is not the owner is not offered the prepare action; unavailable and failed states are said", () => {
    expect(handoverGuide({ status: "ok", handover: null }, { ownerName: "Fictional Sami", canEdit: false }).action).toMatchObject({ label: "See the handover package", primary: false });
    expect(handoverGuide({ status: "none" }, who).state).toBe("Handover not available");
    expect(handoverGuide({ status: "error" }, who)).toMatchObject({ state: "Could not check the handover", tone: "red" });
  });
});

describe("the guide on the page", () => {
  const opp = {
    id: "o1", company_id: "c1", owner_id: "u1", reference: "OPP-QA-2026-0001", title: "Fictional launch", stage: "qualified", currency: "AED", value: 100, version: 3, first_response_at: null, waiting_on: null,
    stage_before_hold: null, hold_reason: null, hold_review_date: null, lost_reason: null, created_at: "2026-11-01T00:00:00Z", stage_changed_at: "2026-11-01T00:00:00Z", availability_state: "unverified", technologies: [],
  };
  const ctx = { userId: "u1", grants: [{ companyId: "c1", capabilities: ["founder"] }], companies: [{ id: "c1", name: "Fictional Co", settings: null }], people: [], personName: (id: string) => (id === "u2" ? "Fictional Sami" : "Fictional Fiona"), companyName: () => "Fictional Co" };
  const fu = { id: "f1", opportunity_id: "o1", title: "Call the client", due_at: "2030-01-01T06:00:00Z", status: "open", assigned_to: "u2", created_by: "u1", created_at: "2026-11-02T00:00:00Z", completed_at: null, completed_by: null, outcome: null, updated_at: "2026-11-02T00:00:00Z" };
  const page = async (o: { opp?: Record<string, unknown>; followUps?: unknown[]; proposals?: unknown[]; sends?: unknown[]; activities?: unknown[]; events?: unknown[]; failed?: DetailSection[] } = {}) => {
    const followUps = o.followUps ?? [fu];
    const detail = {
      item: { opp: { ...opp, ...o.opp }, value: 100, companyName: "Fictional Co", ownerName: "Fictional Fiona", agency: null, client: null, nextFollowUp: followUps[0] ?? null, openFollowUps: followUps.length, availability: "unverified" },
      contacts: [], activities: o.activities ?? [], followUps, events: o.events ?? [], files: [], proposals: o.proposals ?? [], zoho: null, approvals: [], handover: null, closures: [], estimateSends: o.sends ?? [], estimateSendsInstalled: true,
    };
    return renderToStaticMarkup(await EnquiryGuide({ view: buildOppView(ctx as never, detail as never, new Set(o.failed ?? [])), currentUserId: "u1" }) as React.ReactElement);
  };
  it("shows the next action with its owner and due date, the stage guidance and the latest entries with a way into the full history", async () => {
    const html = await page({ activities: [{ id: "a1", kind: "call", body: "Fictional call about the stand", is_internal: false, occurred_at: "2026-11-03T08:00:00Z", created_by: "u1", created_at: "2026-11-03T08:00:00Z" }] });
    expect(html).toContain("Call the client");
    expect(html).toContain("Owner of this action: <span class=\"font-medium text-foreground\">Fictional Sami</span>");
    expect(html).toContain("No first response is recorded yet");
    expect(html).toContain("Call: Fictional call about the stand");
    expect(html).toContain("Open the full activity and comments");
    expect(html).not.toContain("ACTION:add-follow-up");
  });
  it("no follow-up: says so and offers to add one; failed follow-ups: says it could not load and offers nothing", async () => {
    const none = await page({ followUps: [] });
    expect(none).toContain("No next action is recorded");
    expect(none).toContain("ACTION:add-follow-up");
    const failed = await page({ followUps: [], failed: ["followUps"] });
    expect(failed).toContain("The follow-ups could not be loaded");
    expect(failed).not.toContain("No next action is recorded");
    expect(failed).not.toContain("ACTION:add-follow-up");
  });
  it("a finalised estimate not yet recorded leads to Estimates; a recorded one is named with its revision; an ordinary sent proposal is told apart from an estimate", async () => {
    marks = new Map([["p-est", { finalised: true }]]);
    const proposals = [{ id: "p-est", version: 2, status: "draft", sent_on: null }, { id: "p-deck", version: 1, status: "sent", sent_on: "2026-11-02" }];
    const html = await page({ proposals });
    expect(html).toContain("A finalised estimate is not recorded as sent");
    expect(html).toContain("Proposal version 1 recorded as sent on 2 Nov 2026.");
    expect(html).toContain("Record estimate as sent");
    const sent = await page({ opp: { stage: "estimate_sent" }, proposals, sends: [{ id: "s1", proposal_id: "p-est", reference: "EST-QA-2026-0007", revision: 2, sent_on: "2026-11-06", recorded_at: "2026-11-06T09:00:00Z" }] });
    expect(sent).toContain("Estimate EST-QA-2026-0007, revision 2, recorded as sent on 6 Nov 2026.");
    expect(sent).not.toContain("A finalised estimate is not recorded as sent");
  });
  it("a failed read of which versions are estimates is said, never shown as 'nothing sent'", async () => {
    marksFail = true;
    const html = await page({ proposals: [{ id: "p", version: 1, status: "sent", sent_on: "2026-11-02" }] });
    expect(html).toContain("Could not load the proposal versions.");
    expect(html).not.toContain("Nothing is recorded as sent yet");
  });
  it("won: the handover card with the PM's question and the action; a created project is linked only with a visible reference", async () => {
    handover = { status: "ok", handover: { status: "clarification_requested", pmName: "Fictional Petra", projectId: null, projectReference: null, clarificationNote: "Final installation dates?" } };
    const q = await page({ opp: { stage: "won", closed_at: "2026-11-05T00:00:00Z" }, followUps: [] });
    expect(q).toContain("PM asked a question");
    expect(q).toContain("Fictional Petra asked: Final installation dates?");
    expect(q).toContain("Answer and resubmit");
    expect(q).toContain("/sales/opportunities/o1/handover");
    handover = { status: "ok", handover: { status: "accepted", pmName: "Fictional Petra", projectId: "p1", projectReference: "PRJ-QA-2026-0003", clarificationNote: null } };
    const made = await page({ opp: { stage: "won" }, followUps: [] });
    expect(made).toContain("Project created");
    expect(made).toContain('href="/projects/p1"');
    expect(made).toContain("Open project PRJ-QA-2026-0003");
    handover = { status: "ok", handover: { status: "accepted", pmName: "Fictional Petra", projectId: "p1", projectReference: null, clarificationNote: null } };
    const hidden = await page({ opp: { stage: "won" }, followUps: [] });
    expect(hidden).not.toContain("/projects/p1");
    expect(hidden).toContain("You do not have access to the project itself");
  });
});

describe("the timeline", () => {
  const name = (id: string | null | undefined) => (id === "u2" ? "Fictional Sami" : id ? "Fictional Fiona" : "—");
  const items = timelineItems({
    opportunityId: "o1", firstResponseAt: "2026-11-03T08:00:00Z",
    activities: [
      { id: "a1", opportunity_id: "o1", company_id: "c1", kind: "call", body: "Fictional first call", is_internal: false, occurred_at: "2026-11-03T08:00:00Z", created_by: "u1", created_at: "2026-11-03T08:01:00Z" },
      { id: "a2", opportunity_id: "o1", company_id: "c1", kind: "note", body: "Fictional internal note", is_internal: true, occurred_at: "2026-11-04T08:00:00Z", created_by: "u2", created_at: "2026-11-04T08:00:00Z" },
    ],
    events: [
      { id: "e1", kind: "stage_changed", from_value: "new", to_value: "qualified", reason: null, actor_id: "u1", created_at: "2026-11-03T09:00:00Z" },
      { id: "e2", kind: "proposal", from_value: null, to_value: "Estimate EST-QA-2026-0007 rev 2 recorded as sent on 2026-11-06", reason: "p-est", actor_id: "u1", created_at: "2026-11-06T09:00:00Z" },
      { id: "e3", kind: "handover", from_value: null, to_value: "submitted", reason: null, actor_id: "u1", created_at: "2026-11-07T09:00:00Z" },
    ] as never,
    followUps: [{ id: "f1", opportunity_id: "o1", organisation_id: null, company_id: "c1", assigned_to: "u2", title: "Send the estimate", kind: "email", due_at: "2026-11-06T06:00:00Z", status: "done", completed_at: "2026-11-06T08:00:00Z", completed_by: "u2", outcome: "Sent by email", created_by: "u1", created_at: "2026-11-03T09:30:00Z", updated_at: "2026-11-06T08:00:00Z" }],
  }, name);
  it("is one chronological list, newest first, of staff entries and app-recorded entries, each with who and when", () => {
    expect(items.map((i) => i.id)).toEqual(["e-e3", "e-e2", "fd-f1", "a-a2", "fp-f1", "e-e1", "a-a1"]);
    expect(items.filter((i) => i.type === "staff").map((i) => i.label)).toEqual(["Note", "Call"]);
    expect(items.find((i) => i.id === "e-e2")).toMatchObject({ type: "system", label: "Estimate", text: "Estimate EST-QA-2026-0007 revision 2 recorded as sent to the client on 2026-11-06.", who: "Fictional Fiona", link: { href: "/sales/opportunities/o1/quotations/p-est", label: "Open that estimate revision" } });
    expect(items.find((i) => i.id === "fd-f1")).toMatchObject({ text: "Follow-up completed: Send the estimate. Outcome: Sent by email", who: "Fictional Sami" });
    expect(items.find((i) => i.id === "fp-f1")!.text).toMatch(/^Follow-up planned: Send the estimate\. Due .* for Fictional Sami\.$/);
    expect(items.find((i) => i.id === "e-e3")!.link).toEqual({ href: "/sales/opportunities/o1/handover", label: "Open the handover" });
  });
  it("marks the call that set the first response, and an internal note", () => {
    expect(items.find((i) => i.id === "a-a1")).toMatchObject({ firstResponse: true, internal: false });
    expect(items.find((i) => i.id === "a-a2")).toMatchObject({ firstResponse: false, internal: true });
  });
  it("Comments and notes shows only what people wrote; All activity shows everything; the two look different", () => {
    render(<TimelineList items={items} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getAllByText("recorded by the app")).toHaveLength(5);
    fireEvent.click(screen.getByRole("tab", { name: /Comments and notes 2/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Fictional first call")).toBeTruthy();
    expect(screen.queryByText(/Stage changed/)).toBeNull();
    expect(screen.getByText("First response")).toBeTruthy();
    expect(screen.getByText("Internal note")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /All activity 7/ }));
    expect(screen.getByRole("link", { name: "Open that estimate revision" }).getAttribute("href")).toBe("/sales/opportunities/o1/quotations/p-est");
  });
  it("a link elsewhere on the page opens the tab it names without leaving the page", () => {
    render(<><TabLink tab="activity" href="?tab=activity">Open the full activity</TabLink><DetailTabs initial="overview" tabs={[{ id: "overview", label: "Overview", content: <p>overview body</p> }, { id: "activity", label: "Activity & history", content: <p>activity body</p> }]} /></>);
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByText("Open the full activity"));
    expect(screen.getByRole("tab", { name: "Activity & history" }).getAttribute("aria-selected")).toBe("true");
  });
});
