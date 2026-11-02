import { describe, expect, it } from "vitest";
import type { PbxInbox } from "@/types/budget";
import { budgetDayFromInbox } from "./my-day";

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

  it("a person with no budget access (empty lists) has nothing waiting", () => {
    expect(budgetDayFromInbox(inbox({}), none, none)).toEqual({ waitingForMe: { count: 0, href: "/finance/project-budgets" }, waitingOnOthers: 0 });
  });
});
