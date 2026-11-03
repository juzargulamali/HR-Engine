import { describe, expect, it } from "vitest";
import {
  approvalCandidates, attentionHeadline, ATTENTION_LIST_ID, budgetCandidates, buildAttention, commercialApprovalCandidates, failed, handoverCandidates, hrCandidates, noteCandidates, ok,
  projectDecisionCandidates, salesCandidates, taskCandidates, type AttentionCandidate, type AttentionSourceResult, type AttentionTask,
} from "./attention";
import { budgetDayFromInbox } from "@/lib/budget/my-day";
import type { PbxInbox } from "@/types/budget";

const now = new Date("2026-11-03T09:00:00Z");
const today = "2026-11-03";
const fmt = (d: string) => `on ${d}`;
const icon = (() => null) as never;
const cand = (over: Partial<AttentionCandidate> & { key: string }): AttentionCandidate => ({ source: "approvals", icon, title: over.key, what: "Do it", tier: 2, at: null, href: "/x", ...over });
const task = (id: string, due: string | null, over: Partial<AttentionTask> = {}): AttentionTask => ({ id, title: `Task ${id}`, status: "in_progress", due_date: due, updatedAt: "2026-10-30T00:00:00Z", projectReference: "P-1", projectName: "Expo", ...over });

describe("buildAttention: the headline number IS the list", () => {
  const mixes: [string, AttentionSourceResult[]][] = [
    ["nothing", [ok("approvals", [])]],
    ["one source", [ok("approvals", [cand({ key: "a" }), cand({ key: "b" })])]],
    ["several sources", [ok("approvals", [cand({ key: "a" })]), ok("project-tasks", [cand({ key: "t1", tier: 0 }), cand({ key: "t2", tier: 1 })]), ok("notes", [cand({ key: "n" })]), ok("hr", [cand({ key: "hr:docs", records: 5 })])]],
    ["with a failed source", [ok("approvals", [cand({ key: "a" })]), failed("sales")]],
    ["with duplicates", [ok("approvals", [cand({ key: "a" })]), ok("budgets", [cand({ key: "a" }), cand({ key: "b" })])]],
  ];
  it.each(mixes)("%s: count, headline and list agree by construction", (_name, sources) => {
    const a = buildAttention(sources);
    expect(a.count).toBe(a.items.length);
    expect(a.headline.text).toBe(attentionHeadline(a.items.length, a.errors).text);
    const n = a.items.length;
    if (n > 0) expect(a.headline.link).toBe(`${n} ${n === 1 ? "item needs" : "items need"} your attention`);
    // one entry per key
    expect(new Set(a.items.map((i) => i.key)).size).toBe(n);
  });
  it("an HR row counts as one item whatever number of records it stands for (the records are shown on the row)", () => {
    const a = buildAttention([ok("hr", hrCandidates({ contracts: 7, probation: 0, docs: 2, identity: 0 }))]);
    expect(a.count).toBe(2);
    expect(a.items.map((i) => [i.key, i.records])).toEqual([["hr:contracts", 7], ["hr:docs", 2]]);
  });
});

describe("duplicates: the same record from two sources counts once", () => {
  it("an overdue task that is also waiting for my review is one item, urgent wording first, the review kept as 'also'", () => {
    const t = task("t1", "2026-10-28");
    const a = buildAttention([
      ok("project-tasks", taskCandidates({ today, open: [t], reviews: [{ ...t, status: "ready_for_review" }] }, fmt)),
    ]);
    // the open (non-review) copy is overdue; the review copy shares the key
    expect(a.items).toHaveLength(1);
    expect(a.items[0]).toMatchObject({ key: "task:t1", tier: 0, what: "Task overdue", also: ["Task waiting for your review"] });
  });
  it("a budget in the approvals source and in pbx_inbox is one item (key = the record's id)", () => {
    const a = buildAttention([
      ok("approvals", [cand({ key: "budget:v1", title: "From approvals", what: "Waiting for your decision", at: "2026-10-31" })]),
      ok("budgets", [cand({ key: "budget:v1", source: "budgets", title: "From the inbox", what: "Project budget waiting for your decision", at: "2026-10-30" })]),
    ]);
    expect(a.count).toBe(1);
    expect(a.items[0]!.sources).toEqual(["approvals", "budgets"]);
    expect(a.items[0]!.at).toBe("2026-10-30");
  });
  it("a handover row and a Sales row about one enquiry are one item", () => {
    const a = buildAttention([
      ok("sales", salesCandidates({ attention: [{ kind: "no_first_response", opportunityId: "o1", reference: "ENQ-1", title: "Stand", detail: "", at: null }] }, fmt)),
      ok("sales-handover", handoverCandidates({ status: "ok", rows: [{ kind: "won_no_handover", opportunityId: "o1", reference: "ENQ-1", title: "Stand", detail: "", scope: "mine", at: "2026-10-20T00:00:00Z" }] }, now)),
      ok("project-decisions", projectDecisionCandidates({ handoverList: [{ id: "h1", opportunityId: "o2", reference: "ENQ-2", title: "Other", status: "submitted", at: "2026-11-01T00:00:00Z" }], scopeList: [] }, now)),
    ]);
    expect(a.items.map((i) => i.key).sort()).toEqual(["opp:o1", "opp:o2"]);
    expect(a.items.find((i) => i.key === "opp:o1")!.also).toHaveLength(1);
  });
  it("two follow-ups of one enquiry are two items; the same follow-up twice is one", () => {
    const f = (id: string) => ({ kind: "overdue" as const, opportunityId: "o1", reference: "ENQ-1", title: "Stand", detail: `Call ${id}`, at: "2026-10-30T08:00:00Z", followUpId: id });
    expect(buildAttention([ok("sales", salesCandidates({ attention: [f("f1"), f("f2")] }, fmt))]).count).toBe(2);
    expect(buildAttention([ok("sales", salesCandidates({ attention: [f("f1"), f("f1")] }, fmt))]).count).toBe(1);
  });
});

describe("order: overdue first, then due today, then the rest by how long they have waited", () => {
  it("sorts by tier, then oldest first, then key", () => {
    const a = buildAttention([
      ok("approvals", [cand({ key: "wait-new", at: "2026-11-02T00:00:00Z" }), cand({ key: "wait-old", at: "2026-10-20T00:00:00Z" }), cand({ key: "undated" })]),
      ok("project-tasks", [cand({ key: "today", tier: 1, at: "2026-11-03" }), cand({ key: "late-new", tier: 0, at: "2026-11-01" }), cand({ key: "late-old", tier: 0, at: "2026-10-01" })]),
    ]);
    expect(a.items.map((i) => i.key)).toEqual(["late-old", "late-new", "today", "wait-old", "wait-new", "undated"]);
  });
  it("tasks: overdue and due today are ranked, later tasks are not in the list, and a task I sent for review is not mine to do", () => {
    const c = taskCandidates({ today, open: [task("later", "2026-11-20"), task("none", null), task("today", today), task("late", "2026-10-30"), task("sent", "2026-10-01", { status: "ready_for_review" })], reviews: [] }, fmt);
    const a = buildAttention([ok("project-tasks", c)]);
    expect(a.items.map((i) => i.key)).toEqual(["task:late", "task:today"]);
    expect(a.items[0]!.when).toBe("Overdue since on 2026-10-30");
    expect(a.items[1]!.when).toBe("Due today");
  });
  it("a leave request that has started and is still undecided ranks as overdue, ahead of an older plain wait", () => {
    const a = buildAttention([ok("approvals", approvalCandidates([
      { approvalId: "1", entityType: "timesheet", entityId: "t", createdAt: "2026-09-01T00:00:00Z", title: "Timesheet", dueDate: null },
      { approvalId: "2", entityType: "leave_request", entityId: "l", createdAt: "2026-10-30T00:00:00Z", title: "Leave request: Aisha Khan", dueDate: "2026-11-02" },
    ], today, now, fmt))]);
    expect(a.items.map((i) => i.title)).toEqual(["Leave request: Aisha Khan", "Timesheet"]);
    expect(a.items[0]).toMatchObject({ tier: 0, href: "/approvals" });
    expect(a.items[0]!.when).toContain("started on 2026-11-02");
  });
});

describe("each counted item says what it is, whose, how late or how long, and where to act", () => {
  it("names the record, the project, the age and the link", () => {
    const a = buildAttention([
      ok("project-tasks", taskCandidates({ today, open: [task("t1", "2026-10-28")], reviews: [task("t2", null, { status: "ready_for_review", updatedAt: "2026-10-31T00:00:00Z" })] }, fmt)),
      ok("project-decisions", projectDecisionCandidates({ handoverList: [], scopeList: [{ id: "s1", projectId: "p1", projectReference: "P-9", projectName: "Gala", title: "Add a stage", at: "2026-10-31T09:00:00Z" }] }, now)),
      ok("notes", noteCandidates({ status: "ok", notes: [{ noteId: "n1", noteNo: "ENG-D-00012", kind: "dispatch", projectId: "p1", projectRef: "P-9", projectName: "Gala", waitingSince: "2026-10-31T09:00:00Z" }] }, now)),
      ok("sales-approvals", commercialApprovalCandidates({ status: "ok", requests: [{ id: "c1", opportunityId: "o1", requestedAt: "2026-11-01T09:00:00Z", reference: "ENQ-3", title: "Pavilion" }] }, now)),
    ]);
    expect(a.items.find((i) => i.key === "task:t1")).toMatchObject({ title: "Task t1", context: "P-1 · Expo", when: "Overdue since on 2026-10-28", href: "/projects/work?task=t1" });
    expect(a.items.find((i) => i.key === "scope:s1")).toMatchObject({ title: "Add a stage", context: "P-9 · Gala", when: "Waiting 3 days", href: "/projects/scope-decisions/s1" });
    expect(a.items.find((i) => i.key === "note:n1")).toMatchObject({ title: "ENG-D-00012", context: "P-9 · Gala", href: "/projects/p1/equipment?note=n1#notes" });
    expect(a.items.find((i) => i.key === "crm-approval:c1")).toMatchObject({ title: "Pavilion", href: "/sales/opportunities/o1?tab=commercial" });
    for (const i of a.items) expect(i.href).toMatch(/^\//);
  });
});

describe("'Waiting on others' is not counted", () => {
  const inbox = (over: Partial<PbxInbox>): PbxInbox => ({ companies: [], budget_approvals: [], final_expense_approvals: [], outstanding_settlement: [], is_finance_anywhere: false, is_executive_anywhere: false, ...over });
  const row = { budget_id: "b1", project_id: "p1", reference: "P-1", name: "Expo", company_id: "c1", company_name: "Co", currency: "AED", pm_name: null, site_timezone: null, kind: "original" as const, seq: 1, total: 1, submitted_at: "2026-10-30T00:00:00Z", submitted_by_name: "Pia", approval_route: "finance" as const, on_hold: false };
  it("a budget the person submitted themselves is not in the list; one they decide is", () => {
    const day = budgetDayFromInbox(inbox({ budget_approvals: [{ ...row, version_id: "mine", i_can_decide: false }, { ...row, version_id: "theirs", i_can_decide: true }] }), new Set(["mine"]), new Set(), null);
    expect(day.waitingOnOthers).toBe(1);
    const a = buildAttention([ok("budgets", budgetCandidates(day, now))]);
    expect(a.items.map((i) => i.key)).toEqual(["budget:theirs"]);
  });
  it("a self-authored item the person could otherwise decide stays out of the list", () => {
    const day = budgetDayFromInbox(inbox({ budget_approvals: [{ ...row, version_id: "mine", i_can_decide: true }] }), new Set(["mine"]), new Set(), null);
    expect(buildAttention([ok("budgets", budgetCandidates(day, now))]).count).toBe(0);
    expect(day.waitingOnOthers).toBe(1);
  });
  it("a task I sent for review waits on someone else: it is not an item", () => {
    expect(taskCandidates({ today, open: [task("sent", "2026-10-01", { status: "ready_for_review" })], reviews: [] }, fmt)).toEqual([]);
  });
  it("a returned budget on my project is mine to act on", () => {
    const day = budgetDayFromInbox(inbox({}), new Set(), new Set(), { returned: { count: 1, projectIds: ["p1"], items: [{ id: "v9", kind: "budget", projectId: "p1", label: "P-1 · Expo", at: "2026-11-01T00:00:00Z" }] }, waitingIds: [], waitingProjectIds: [], decided: { count: 0, projectIds: [] } });
    const a = buildAttention([ok("budgets", budgetCandidates(day, now))]);
    expect(a.items).toEqual([expect.objectContaining({ key: "budget:v9", what: "Project budget returned to you", href: "/projects/p1/budget" })]);
  });
});

describe("a source that fails", () => {
  it("is named in the headline and as an error entry, and the rest still lists", () => {
    const a = buildAttention([ok("project-tasks", [cand({ key: "t", source: "project-tasks" }), cand({ key: "u", source: "project-tasks" }), cand({ key: "v", source: "project-tasks" })]), failed("approvals")]);
    expect(a.count).toBe(3);
    expect(a.errors).toEqual([{ source: "approvals", label: "Approvals" }]);
    expect(a.headline.text).toBe("Your updates for today: 3 items need your attention; 1 part could not be loaded: Approvals.");
  });
  it("names several failed parts", () => {
    const a = buildAttention([failed("approvals"), failed("budgets"), failed("approvals"), ok("hr", [])]);
    expect(a.errors.map((e) => e.label)).toEqual(["Approvals", "Project budgets"]);
    expect(a.headline.text).toContain("2 parts could not be loaded: Approvals, Project budgets");
  });
  it("with nothing else listed it still never says nothing needs attention", () => {
    const a = buildAttention([failed("approvals"), ok("project-tasks", [])]);
    expect(a.count).toBe(0);
    expect(a.headline.text).not.toMatch(/nothing/i);
    expect(a.headline.text).toContain("could not be loaded: Approvals");
    expect(a.headline.text).toContain("may need your attention");
  });
});

describe("all sources load and nothing is waiting", () => {
  it("says so", () => {
    const a = buildAttention([ok("approvals", []), ok("project-tasks", taskCandidates({ today, open: [], reviews: [] }, fmt)), ok("hr", hrCandidates({ contracts: 0, probation: 0, docs: 0, identity: 0 }))]);
    expect(a.count).toBe(0);
    expect(a.errors).toEqual([]);
    expect(a.headline.text).toBe("Nothing needs your attention right now.");
  });
  it("no sources at all (a person with no modules) is also nothing", () => {
    expect(buildAttention([]).headline.text).toBe("Nothing needs your attention right now.");
  });
  it("the headline grammar for one and for many", () => {
    expect(attentionHeadline(1, []).text).toBe("Your updates for today: 1 item needs your attention.");
    expect(attentionHeadline(5, []).text).toBe("Your updates for today: 5 items need your attention.");
  });
});

describe("the headline's link target", () => {
  it("is the id the list is rendered with", () => {
    expect(ATTENTION_LIST_ID).toBe("attention");
  });
});
