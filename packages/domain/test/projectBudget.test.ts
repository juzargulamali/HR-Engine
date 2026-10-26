import { describe, expect, it } from "vitest";
import {
  approvalRouteFor, settlementRouteFor, holdExplanation, routeExplanation, categorySubtotals, currencyDecimals, expenseVariance, fundingIsAdvance, inclusiveDays, moneyText, nextAction, parseDecimal, requiresVarianceNote, roundMoney,
  rowTotal, settlementBlockers, settlementFigures, subMoney, sumMoney, suggestedRate, varianceLabel, versionStatusTone, type BudgetFlowState,
} from "../src";

describe("row totals (decimal, per currency)", () => {
  it("food: 3 people x 2 days x 60 = 360", () => expect(rowTotal({ basis: "per_person_day", people: 3, days: 2, rate: 60 }, "AED")).toBe(360));
  it("petrol: 60 km x 0.50 = 30", () => expect(rowTotal({ basis: "per_km", qty: 60, rate: "0.50" }, "AED")).toBe(30));
  it("metro: a fixed 30 over 20-22 October is 30 in total, not per day", () => {
    expect(rowTotal({ basis: "fixed", fixed: 30 }, "AED")).toBe(30);
    // the same fixed total ignores any people, days or rate typed earlier
    expect(rowTotal({ basis: "fixed", fixed: 30, people: 3, days: 3, rate: 10 } as never, "AED")).toBe(30);
  });
  it("truck: 3 trips x 350 = 1,050", () => expect(rowTotal({ basis: "per_trip", qty: 3, rate: 350 }, "AED")).toBe(1050));
  it("per person and quantity x rate", () => {
    expect(rowTotal({ basis: "per_person", people: 4, rate: 25 }, "AED")).toBe(100);
    expect(rowTotal({ basis: "qty_rate", qty: 12, rate: "7.5" }, "AED")).toBe(90);
  });
  it("is null while a needed field is blank or invalid (never a silent zero)", () => {
    expect(rowTotal({ basis: "per_person_day", people: 3, days: "", rate: 60 }, "AED")).toBeNull();
    expect(rowTotal({ basis: "per_km", qty: "abc", rate: 0.5 }, "AED")).toBeNull();
    expect(rowTotal({ basis: "fixed", fixed: null }, "AED")).toBeNull();
    expect(rowTotal({ basis: "fixed", fixed: -5 }, "AED")).toBeNull();
    expect(rowTotal({ basis: "per_trip", qty: 3, rate: "1e3" }, "AED")).toBeNull();
  });
  it("does not use floating point: 0.1 + 0.2 style sums are exact", () => {
    expect(sumMoney([0.1, 0.2], "AED")).toBe(0.3);
    expect(rowTotal({ basis: "qty_rate", qty: 3, rate: "0.1" }, "AED")).toBe(0.3);
    expect(rowTotal({ basis: "qty_rate", qty: "1.005", rate: 100 }, "AED")).toBe(100.5);
  });
  it("rounds half away from zero to the currency's decimals", () => {
    expect(rowTotal({ basis: "qty_rate", qty: 1, rate: "10.005" }, "AED")).toBe(10.01);
    expect(rowTotal({ basis: "qty_rate", qty: 1, rate: "10.004" }, "AED")).toBe(10);
    expect(rowTotal({ basis: "qty_rate", qty: 1, rate: "10.5" }, "JPY")).toBe(11);
    expect(rowTotal({ basis: "qty_rate", qty: 1, rate: "10.0005" }, "KWD")).toBe(10.001);
    expect(roundMoney("2.675", "SAR")).toBe(2.68);
    expect(currencyDecimals("jpy")).toBe(0);
    expect(currencyDecimals("OMR")).toBe(3);
    expect(currencyDecimals("EUR")).toBe(2);
  });
  it("a row total is rounded once, not at every step", () => {
    // 3 x 0.335 x 1 = 1.005 -> 1.01 (rounding the rate first to 0.34 would give 1.02)
    expect(rowTotal({ basis: "per_person", people: 3, rate: "0.335" }, "AED")).toBe(1.01);
  });
  it("sums and differences are exact in the smallest unit", () => {
    expect(sumMoney(["1.10", "2.20", 3.3], "AED")).toBe(6.6);
    expect(subMoney(360, "359.99", "AED")).toBe(0.01);
  });
  it("formats with the code and the currency's own decimals", () => {
    expect(moneyText(1050, "AED")).toBe("AED 1,050.00");
    expect(moneyText(1050, "JPY")).toBe("JPY 1,050");
    expect(moneyText(null, "AED")).toBe("—");
  });
  it("parses decimals safely", () => {
    expect(parseDecimal("12.50")).toEqual({ n: 1250n, s: 2 });
    expect(parseDecimal(" 7 ")).toEqual({ n: 7n, s: 0 });
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal(Number.NaN)).toBeNull();
    expect(parseDecimal("1,000")).toBeNull();
  });
});

describe("days and category subtotals", () => {
  it("counts days inclusively", () => {
    expect(inclusiveDays("2026-10-20", "2026-10-22")).toBe(3);
    expect(inclusiveDays("2026-10-20")).toBe(1);
    expect(inclusiveDays("2026-10-20", "2026-10-20")).toBe(1);
    expect(inclusiveDays("2026-10-22", "2026-10-20")).toBeNull();
    expect(inclusiveDays("20/10/2026", null)).toBeNull();
    expect(inclusiveDays("2026-02-27", "2026-03-02")).toBe(4);
  });
  it("subtotals in category order, unknown categories last", () => {
    const sub = categorySubtotals([{ category: "transport", total: 30 }, { category: "food", total: 360 }, { category: "food", total: 0.4 }, { category: "custom", total: 5 }, { category: "transport", total: null }], "AED");
    expect(sub.map((s) => s.category)).toEqual(["food", "transport", "custom"]);
    expect(sub.find((s) => s.category === "food")!.total).toBe(360.4);
    expect(sub.find((s) => s.category === "transport")!.rows).toBe(2);
  });
});

describe("rates and funding classification", () => {
  it("suggests petrol and meal rates for AED only, never for SAR or EUR", () => {
    expect(suggestedRate("AED", "petrol_per_km")).toBe(0.5);
    expect(suggestedRate("AED", "meal_per_person")).toBe(30);
    expect(suggestedRate("SAR", "petrol_per_km")).toBeNull();
    expect(suggestedRate("EUR", "meal_per_person")).toBeNull();
  });
  it("a Pluto allocation is never an advance; cash and bank transfers are; other is Finance's explicit choice", () => {
    expect(fundingIsAdvance("cash")).toBe(true);
    expect(fundingIsAdvance("bank_transfer")).toBe(true);
    expect(fundingIsAdvance("pluto")).toBe(false);
    expect(fundingIsAdvance("pluto", true)).toBe(false);
    expect(fundingIsAdvance("other")).toBe(false);
    expect(fundingIsAdvance("other", true)).toBe(true);
  });
});

describe("variance", () => {
  it("is actual minus approved, labelled over or under", () => {
    expect(expenseVariance(1100, 1000, "AED")).toEqual({ amount: 100, kind: "over" });
    expect(expenseVariance(900, 1000, "AED")).toEqual({ amount: -100, kind: "under" });
    expect(expenseVariance(1000, 1000, "AED").kind).toBe("on");
    expect(varianceLabel(1100, 1000, "AED")).toBe("Over budget by AED 100.00");
    expect(varianceLabel(900, 1000, "AED")).toBe("Under budget by AED 100.00");
    expect(varianceLabel(1000, 1000, "AED")).toBe("On budget");
  });
  it("asks for a note only for a material difference", () => {
    expect(requiresVarianceNote(1000, 1100, "AED")).toBe(false);
    expect(requiresVarianceNote(1000, 1100.01, "AED")).toBe(true);
    expect(requiresVarianceNote(1000, 899.99, "AED")).toBe(true);
    expect(requiresVarianceNote(1000, 900, "AED")).toBe(false);
    expect(requiresVarianceNote(0, 5, "AED")).toBe(true);
    expect(requiresVarianceNote(0, 0, "AED")).toBe(false);
  });
});

describe("settlement figures: per-source reconciliation", () => {
  const funding = [
    { recipient: "pm", amount: 1000, isAdvance: true },
    { recipient: "pm", amount: 500, isAdvance: true }, // second instalment
    { recipient: "colleague", amount: 200, isAdvance: true },
    { recipient: "pm", amount: 3000, isAdvance: false }, // Pluto allocation: not an advance, not owed back
  ];
  const actuals = [
    { paidVia: "advance" as const, paidBy: "pm", amount: 1200 },
    { paidVia: "advance" as const, paidBy: "colleague", amount: 250 }, // spent 50 more than the advance
    { paidVia: "company_card" as const, paidBy: null, amount: 2000 },
    { paidVia: "direct_company" as const, paidBy: null, amount: 700 },
    { paidVia: "personal" as const, paidBy: "pm", amount: 80 },
    { paidVia: "existing_claim" as const, paidBy: null, amount: 40 },
  ];
  it("keeps advances, card spending, direct payments and personal spending apart", () => {
    const s = settlementFigures("AED", funding, actuals, []);
    expect(s.approvedActualTotal).toBe(4270);
    expect(s.advancesProvided).toBe(1700);
    expect(s.cardAllocations).toBe(3000);
    expect(s.advanceSpent).toBe(1450);
    expect(s.companyCardSpent).toBe(2000);
    expect(s.directPaid).toBe(700);
    expect(s.personalSpent).toBe(80);
    expect(s.existingClaimSpent).toBe(40);
    const pm = s.perPerson.find((p) => p.person === "pm")!;
    expect(pm).toMatchObject({ advanceProvided: 1500, advanceSpent: 1200, advanceBalance: 300, advanceToReturn: 300, reimbursementOwed: 80, reimbursementOutstanding: 80 });
    const co = s.perPerson.find((p) => p.person === "colleague")!;
    expect(co).toMatchObject({ advanceProvided: 200, advanceSpent: 250, advanceBalance: -50, advanceToReturn: 0, advanceOverspend: 50, reimbursementOwed: 50 });
    expect(s.advanceToReturn).toBe(300);
    expect(s.reimbursementOwed).toBe(130);
    // the naive "all spending minus all funding" would say 4270 - 4700 = -430 (company is owed 430): wrong
  });
  it("supports partial returns and reimbursements and ends at zero", () => {
    const part = settlementFigures("AED", funding, actuals, [{ kind: "return", person: "pm", amount: 100 }, { kind: "reimbursement", person: "pm", amount: 30 }]);
    expect(part.perPerson.find((p) => p.person === "pm")).toMatchObject({ advanceToReturn: 200, reimbursementOutstanding: 50 });
    const done = settlementFigures("AED", funding, actuals, [
      { kind: "return", person: "pm", amount: 300 }, { kind: "reimbursement", person: "pm", amount: 80 }, { kind: "reimbursement", person: "colleague", amount: 50 },
    ]);
    expect(done.advanceToReturn).toBe(0);
    expect(done.reimbursementOutstanding).toBe(0);
  });
  it("a card allocation with no spending is not an amount owed back", () => {
    const s = settlementFigures("AED", [{ recipient: "pm", amount: 5000, isAdvance: false }], [], []);
    expect(s.advanceToReturn).toBe(0);
    expect(s.cardAllocations).toBe(5000);
    expect(s.perPerson).toHaveLength(0);
  });
  it("existing-claim lines never create an advance balance or a reimbursement", () => {
    const s = settlementFigures("AED", [], [{ paidVia: "existing_claim", paidBy: null, amount: 99 }], []);
    expect(s.approvedActualTotal).toBe(99);
    expect(s.reimbursementOwed).toBe(0);
    expect(s.perPerson).toHaveLength(0);
  });
  it("counts blank lines as blank, not as zero", () => {
    const s = settlementFigures("AED", [], [{ paidVia: "company_card", paidBy: null, amount: null }, { paidVia: "company_card", paidBy: null, amount: 0 }], []);
    expect(s.blankLines).toBe(1);
    expect(s.approvedActualTotal).toBe(0);
  });
  it("returns more than held shows as a negative balance (overspend), never hidden", () => {
    const s = settlementFigures("AED", [{ recipient: "a", amount: 100, isAdvance: true }], [{ paidVia: "advance", paidBy: "a", amount: 40 }], [{ kind: "return", person: "a", amount: 80 }]);
    expect(s.perPerson[0]).toMatchObject({ advanceBalance: -20, advanceOverspend: 20, reimbursementOwed: 20 });
  });
});

describe("closing settlement and the next action", () => {
  const ready = { hasApprovedActuals: true, actualsAwaitingDecision: false, budgetAwaitingDecision: false, receipts: "received" as const, receiptExceptionReason: null, advanceToReturn: 0, reimbursementOutstanding: 0, overpaidReimbursement: false, settlementClosed: false };
  it("closes only when reconciled, approved and receipts are confirmed (or excepted with a reason)", () => {
    expect(settlementBlockers(ready, "AED")).toEqual([]);
    expect(settlementBlockers({ ...ready, hasApprovedActuals: false }, "AED")[0]).toMatch(/not approved/);
    expect(settlementBlockers({ ...ready, receipts: "not_received" }, "AED")[0]).toMatch(/receipts/);
    expect(settlementBlockers({ ...ready, receipts: "partial" }, "AED")[0]).toMatch(/receipts/);
    expect(settlementBlockers({ ...ready, receipts: "exception", receiptExceptionReason: "Lost in transit, confirmed by the supplier" }, "AED")).toEqual([]);
    expect(settlementBlockers({ ...ready, receipts: "exception", receiptExceptionReason: " " }, "AED")[0]).toMatch(/reason/);
    expect(settlementBlockers({ ...ready, advanceToReturn: 300 }, "AED")[0]).toMatch(/AED 300.00 of advance money/);
    expect(settlementBlockers({ ...ready, reimbursementOutstanding: 50 }, "AED")[0]).toMatch(/AED 50.00 of reimbursement/);
    expect(settlementBlockers({ ...ready, actualsAwaitingDecision: true }, "AED")[0]).toMatch(/waiting/);
    // Finance-submitted expenses: recorded receipts are not enough until an independent CEO/CTO approver confirms them
    expect(settlementBlockers({ ...ready, settlementByApprover: true, receiptsConfirmedByApprover: false }, "AED")[0]).toMatch(/independent CEO or CTO approver/);
    expect(settlementBlockers({ ...ready, settlementByApprover: true, receiptsConfirmedByApprover: true }, "AED")).toEqual([]);
    expect(settlementBlockers({ ...ready, settlementByApprover: false }, "AED")).toEqual([]);
    expect(settlementBlockers({ ...ready, settlementClosed: true }, "AED")).toEqual(["Settlement is already closed."]);
  });
  const base: BudgetFlowState = { hasBudget: true, latestBudget: "approved", latestBudgetKind: "original", hasApprovedBaseline: true, approvalOnHold: false, actuals: null, approvedActuals: false, fundingRecorded: false, receipts: "not_received", settlementClosed: false, blockers: [] };
  it("names who acts next", () => {
    expect(nextAction({ ...base, hasBudget: false, latestBudget: null, hasApprovedBaseline: false })).toMatchObject({ who: "pm", section: "budget" });
    expect(nextAction({ ...base, latestBudget: "draft", hasApprovedBaseline: false })).toMatchObject({ who: "pm", section: "budget" });
    expect(nextAction({ ...base, latestBudget: "submitted", hasApprovedBaseline: false })).toMatchObject({ who: "finance", section: "budget" });
    expect(nextAction({ ...base, latestBudget: "submitted", hasApprovedBaseline: false, approvalOnHold: true }).text).toMatch(/On hold/);
    expect(nextAction({ ...base, latestBudget: "returned", hasApprovedBaseline: false })).toMatchObject({ who: "pm" });
    expect(nextAction(base)).toMatchObject({ section: "funds" });
    expect(nextAction({ ...base, fundingRecorded: true })).toMatchObject({ who: "pm", section: "actuals" });
    expect(nextAction({ ...base, fundingRecorded: true, actuals: "submitted" })).toMatchObject({ who: "finance", section: "actuals" });
    expect(nextAction({ ...base, fundingRecorded: true, actuals: "returned" })).toMatchObject({ who: "pm", section: "actuals" });
    expect(nextAction({ ...base, fundingRecorded: true, actuals: "approved", approvedActuals: true })).toMatchObject({ who: "finance", section: "settlement" });
    expect(nextAction({ ...base, fundingRecorded: true, actuals: "approved", approvedActuals: true, receipts: "received", blockers: ["x"] }).text).toMatch(/settles the difference/);
    expect(nextAction({ ...base, fundingRecorded: true, actuals: "approved", approvedActuals: true, receipts: "received" }).text).toMatch(/closes settlement/);
    expect(nextAction({ ...base, settlementClosed: true })).toMatchObject({ who: "nobody" });
  });
  it("maps each status to one tone", () => {
    expect(versionStatusTone("approved")).toBe("green");
    expect(versionStatusTone("submitted")).toBe("blue");
    expect(versionStatusTone("returned")).toBe("amber");
    expect(versionStatusTone("rejected")).toBe("red");
  });

  it("routes a submission by whether the submitter holds Finance access, and says why in words", () => {
    expect(approvalRouteFor(false)).toBe("finance");
    expect(approvalRouteFor(true)).toBe("executive");
    expect(routeExplanation("executive")).toMatch(/CEO or CTO approver decides it \(either one is enough\)/);
    expect(routeExplanation("finance")).toBe("Decided by Finance.");
    expect(holdExplanation("executive", "Sam")).toMatch(/Sam has Finance access, so a CEO or CTO approver/);
    expect(holdExplanation("finance", null)).toMatch(/no Finance person other than the submitter/);
  });
  it("names the CEO/CTO route in the next required action", () => {
    const base = { hasBudget: true, latestBudget: "submitted" as const, latestBudgetKind: "original" as const, hasApprovedBaseline: false, approvalOnHold: false, actuals: null, approvedActuals: false, fundingRecorded: false, receipts: "not_received" as const, settlementClosed: false, blockers: [] };
    expect(nextAction({ ...base, approvalRoute: "executive" })).toMatchObject({ who: "executive", text: "The CEO or CTO approver approves, returns or rejects the budget." });
    expect(nextAction({ ...base, latestBudgetKind: "addition", approvalRoute: "executive" }).text).toMatch(/CEO or CTO approver decides the additional budget request/);
    expect(nextAction({ ...base, latestBudget: "approved", hasApprovedBaseline: true, actuals: "submitted", approvalRoute: "executive" }).text).toMatch(/CEO or CTO approver reviews/);
    expect(nextAction({ ...base, approvalOnHold: true, approvalRoute: "executive" })).toMatchObject({ who: "nobody" });
  });
  it("settlement stays with Finance for ordinary PMs and moves to the CEO/CTO approver for Finance-submitted expenses", () => {
    expect(settlementRouteFor("finance")).toBe("finance");
    expect(settlementRouteFor(null)).toBe("finance");
    expect(settlementRouteFor("executive")).toBe("executive");
    expect(settlementRouteFor("finance", true)).toBe("executive");   // the author has since gained Finance access: still not their own to close
  });
  it("hands the last settlement steps to the CEO/CTO approver when Finance submitted the expenses", () => {
    const base = { hasBudget: true, latestBudget: "approved" as const, latestBudgetKind: "original" as const, hasApprovedBaseline: true, approvalOnHold: false, actuals: "approved" as const, approvedActuals: true, fundingRecorded: true, receipts: "received" as const, settlementClosed: false, settlementByApprover: true };
    expect(nextAction({ ...base, blockers: ["AED 70.00 of advance money has not been returned.", "The receipts are recorded by Finance but still need confirmation by an independent CEO or CTO approver."] })).toMatchObject({ who: "finance" });
    expect(nextAction({ ...base, blockers: ["The receipts are recorded by Finance but still need confirmation by an independent CEO or CTO approver."] })).toMatchObject({ who: "executive", section: "settlement", text: expect.stringMatching(/confirms the receipts and authorises closing/) });
    expect(nextAction({ ...base, blockers: [] })).toMatchObject({ who: "executive" });
    expect(nextAction({ ...base, settlementByApprover: false, blockers: [] })).toMatchObject({ who: "finance" });
  });
});
