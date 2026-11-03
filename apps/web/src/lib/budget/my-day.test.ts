import { describe, expect, it } from "vitest";
import type { PbxInbox } from "@/types/budget";
import { budgetDayFromInbox, pmBudgetDay, type PmBudgetRows } from "./my-day";

const inbox = (over: Partial<Record<keyof PbxInbox, unknown>>): PbxInbox =>
  ({ companies: [], budget_approvals: [], final_expense_approvals: [], outstanding_settlement: [], is_finance_anywhere: true, is_executive_anywhere: false, ...over }) as unknown as PbxInbox;
const budget = (version_id: string, over: Record<string, unknown> = {}) => ({ version_id, i_can_decide: true, on_hold: false, ...over });
const actual = (submission_id: string, over: Record<string, unknown> = {}) => ({ submission_id, i_can_decide: true, on_hold: false, ...over });
const settle = (over: Record<string, unknown> = {}) => ({ has_approved_actuals: true, i_can_close: false, i_can_confirm_receipts: false, next: "Receipts not recorded", ...over });
const none = new Set<string>();

describe("budgetDayFromInbox", () => {
  it("counts only what the person can decide now: not on hold, not another person's to decide", () => {
    const day = budgetDayFromInbox(
      inbox({ budget_approvals: [budget("a"), budget("b", { on_hold: true }), budget("c", { i_can_decide: false })], final_expense_approvals: [actual("x"), actual("y", { i_can_decide: false })] }),
      none, none,
    );
    expect(day.waitingForMe.count).toBe(2);
    expect(day.waitingOnOthers).toBe(0);
  });

  it("what the person prepared or submitted is waiting on others, never a decision for them (even if a row said they could decide)", () => {
    const day = budgetDayFromInbox(
      inbox({ budget_approvals: [budget("mine", { i_can_decide: false }), budget("also-mine"), budget("theirs")], final_expense_approvals: [actual("mine-x", { i_can_decide: false })] }),
      new Set(["mine", "also-mine"]), new Set(["mine-x"]),
    );
    expect(day.waitingForMe.count).toBe(1);
    expect(day.waitingOnOthers).toBe(3);
  });

  it("settlement counts only when it is the person's to act on and the expenses are approved: receipts to confirm, or ready and theirs to close", () => {
    const day = budgetDayFromInbox(
      inbox({
        outstanding_settlement: [
          settle({ i_can_confirm_receipts: true }),
          settle({ i_can_close: true, next: "Ready to close" }),
          settle({ i_can_close: true, next: "Receipts not recorded" }),   // theirs to close, but not ready: not a decision yet
          settle({ i_can_close: true, next: "Ready to close", has_approved_actuals: false }),
          settle({}),                                                      // someone else's
        ],
      }),
      none, none,
    );
    expect(day.waitingForMe.count).toBe(2);
  });

  it("links to the matching Finance inbox filter when only one kind waits, otherwise to the whole inbox", () => {
    expect(budgetDayFromInbox(inbox({ budget_approvals: [budget("a")] }), none, none).waitingForMe.href).toBe("/finance/project-budgets?filter=budget");
    expect(budgetDayFromInbox(inbox({ final_expense_approvals: [actual("a")] }), none, none).waitingForMe.href).toBe("/finance/project-budgets?filter=actuals");
    expect(budgetDayFromInbox(inbox({ outstanding_settlement: [settle({ i_can_confirm_receipts: true })] }), none, none).waitingForMe.href).toBe("/finance/project-budgets?filter=settlement");
    expect(budgetDayFromInbox(inbox({ budget_approvals: [budget("a")], final_expense_approvals: [actual("a")] }), none, none).waitingForMe.href).toBe("/finance/project-budgets");
  });

  it("age and who decides: the oldest wait on what is theirs to decide; their own submissions name the shared queue, never a person", () => {
    const day = budgetDayFromInbox(
      inbox({
        budget_approvals: [budget("a", { submitted_at: "2026-10-30T08:00:00Z" }), budget("b", { submitted_at: "2026-10-28T08:00:00Z" }), budget("mine", { i_can_decide: false, submitted_at: "2026-10-25T08:00:00Z", approval_route: "finance" })],
        final_expense_approvals: [actual("mine-x", { i_can_decide: false, submitted_at: "2026-10-27T08:00:00Z", approval_route: "executive" })],
      }),
      new Set(["mine"]), new Set(["mine-x"]),
    );
    expect(day.waitingForMe.oldest).toBe("2026-10-28T08:00:00Z");
    expect(day.waitingOnOthersWith).toEqual({ oldest: "2026-10-25T08:00:00Z", queues: ["Finance", "the CEO or CTO"] });
  });

  it("a person with no budget access (empty lists) has nothing waiting", () => {
    expect(budgetDayFromInbox(inbox({}), none, none)).toEqual({
      waitingForMe: { count: 0, href: "/finance/project-budgets" }, waitingOnOthers: 0, waitingOnOthersHref: "/projects",
      returned: { count: 0, href: "/projects" }, decidedRecently: { count: 0, href: "/projects" },
    });
  });
});

describe("pmBudgetDay (the Project Manager's own projects, from the authoritative budget records)", () => {
  const NOW = new Date("2026-11-10T09:00:00Z");
  const budgets = [{ id: "b1", project_id: "p1" }, { id: "b2", project_id: "p2" }];
  const v = (id: string, budget_id: string, seq: number, status: string, decided_at: string | null = null) => ({ id, budget_id, seq, status, decided_at });
  const rows = (over: Partial<PmBudgetRows> = {}): PmBudgetRows => ({ budgets, versions: [], submissions: [], ...over });

  it("the latest submitted state decides: submitted waits, returned needs the PM, a recent decision is shown, drafts and discards are not a state", () => {
    const day = pmBudgetDay(rows({
      versions: [
        v("v1", "b1", 1, "returned", "2026-11-05T00:00:00Z"), v("v1b", "b1", 2, "draft"),     // returned, with a revision draft started: still theirs to finish
        v("v2", "b2", 1, "approved", "2026-11-09T00:00:00Z"), v("v2b", "b2", 2, "submitted"),  // approved, then an addition waits: it is waiting now
      ],
    }), NOW);
    expect(day.returned).toEqual({ count: 1, projectIds: ["p1"] });
    expect(day.waitingIds).toEqual(["v2b"]);
    expect(day.waitingProjectIds).toEqual(["p2"]);
    expect(day.decided.count).toBe(0);
  });

  it("final-expense sets count the same way, including an approved set sent back by Finance", () => {
    const day = pmBudgetDay(rows({
      versions: [v("v1", "b1", 1, "approved", "2026-11-01T00:00:00Z")],
      submissions: [v("s1", "b1", 1, "approved", "2026-11-02T00:00:00Z"), v("s1b", "b1", 2, "returned", "2026-11-08T00:00:00Z"), v("s2", "b2", 1, "submitted")],
    }), NOW);
    expect(day.returned.count).toBe(1);
    expect(day.waitingIds).toEqual(["s2"]);
  });

  it("approved or rejected shows for 14 days only, then is quiet", () => {
    const recent = pmBudgetDay(rows({ versions: [v("a", "b1", 1, "approved", "2026-11-01T00:00:00Z"), v("r", "b2", 1, "rejected", "2026-11-09T00:00:00Z")] }), NOW);
    expect(recent.decided).toEqual({ count: 2, projectIds: ["p1", "p2"] });
    const old = pmBudgetDay(rows({ versions: [v("a", "b1", 1, "approved", "2026-10-01T00:00:00Z")] }), NOW);
    expect(old.decided.count).toBe(0);
  });

  it("ignores any budget that is not on a project the person manages", () => {
    const day = pmBudgetDay(rows({ versions: [v("x", "other-budget", 1, "returned", "2026-11-05T00:00:00Z"), v("y", "other-budget", 2, "submitted")] }), NOW);
    expect(day.returned.count).toBe(0);
    expect(day.waitingIds).toEqual([]);
  });
});

describe("budgetDayFromInbox with the PM part", () => {
  const pm = { returned: { count: 2, projectIds: ["p1", "p1"] }, waitingIds: ["v-pm", "v-both"], waitingProjectIds: ["p1", "p2"], decided: { count: 1, projectIds: ["p3"] } };
  it("adds the PM's waiting items to Waiting on others once, never counting one the person can decide, and links to the right place", () => {
    const day = budgetDayFromInbox(
      inbox({ budget_approvals: [budget("v-both", { i_can_decide: false }), budget("mine-fin"), budget("v-decide")] }),
      new Set(["v-both", "mine-fin"]), none, { ...pm, waitingIds: ["v-pm", "v-both", "v-decide"] },
    );
    expect(day.waitingOnOthers).toBe(3);           // v-pm, v-both (also authored: once), mine-fin; v-decide is theirs to decide, so not "waiting on others"
    expect(day.waitingForMe.count).toBe(1);        // v-decide
    expect(day.waitingOnOthersHref).toBe("/finance/project-budgets");
  });
  it("a PM with no Finance access: Waiting on others links to their project's budget; returned and decided link by project", () => {
    const day = budgetDayFromInbox(inbox({}), none, none, { ...pm, waitingIds: ["v-pm"], waitingProjectIds: ["p2"], returned: { count: 1, projectIds: ["p1"] } });
    expect(day.waitingOnOthers).toBe(1);
    expect(day.waitingOnOthersHref).toBe("/projects/p2/budget");
    expect(day.returned).toEqual({ count: 1, href: "/projects/p1/budget" });
    expect(day.decidedRecently).toEqual({ count: 1, href: "/projects/p3/budget" });
    expect(budgetDayFromInbox(inbox({}), none, none, { ...pm, returned: { count: 2, projectIds: ["p1", "p2"] } }).returned.href).toBe("/projects");
  });
  it("a person who manages no project gets zeros", () => {
    const day = budgetDayFromInbox(inbox({}), none, none, null);
    expect(day).toMatchObject({ waitingOnOthers: 0, returned: { count: 0 }, decidedRecently: { count: 0 } });
  });
});
