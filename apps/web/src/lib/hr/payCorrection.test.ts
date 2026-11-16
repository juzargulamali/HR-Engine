import { describe, expect, it } from "vitest";
import { impactLines, payCorrectionErrorMessage, planPayCorrection, recordInForce, type PayRecord } from "./payCorrection";

// Fictional pay history, today 2026-11-16, hired 2024-01-01.
const rec = (id: string, from: string, basic: number, allowances: Record<string, number> = {}, current = false): PayRecord =>
  ({ id, effective_from: from, base_salary: basic, allowances, currency: "AED", is_current: current, created_at: `${from}T08:00:00Z` });
const R1 = rec("r1", "2024-01-01", 4000);
const R2 = rec("r2", "2024-07-01", 4500, { housing: 500 });
const R3 = rec("r3", "2025-01-01", 5000, { housing: 500, other: 200 }, true);
const records = [R3, R1, R2];   // order must not matter
const base = { records, today: "2026-11-16", hireDate: "2024-01-01", pending: [] };
const plan = (over: Partial<Parameters<typeof planPayCorrection>[0]> & { recordId: string }) =>
  planPayCorrection({ ...base, newDate: "", newBasic: 0, newAllowances: {}, ...over });
const refused = (over: Parameters<typeof plan>[0]) => { const p = plan(over); if (p.ok) throw new Error("expected a refusal"); return p.error; };

describe("planPayCorrection: the same rules and sentences as the database function", () => {
  it("accepts a date between the neighbouring records and says which pay is in force today before and after", () => {
    const p = plan({ recordId: "r2", newDate: "2024-08-15", newBasic: 4500, newAllowances: { housing: 500 } });
    expect(p).toMatchObject({ ok: true, dateChanged: true, amountChanged: false });
    if (p.ok) { expect(p.beforeToday?.id).toBe("r3"); expect(p.afterToday?.id).toBe("r3"); expect(p.uncoveredFrom).toBeNull(); }
  });

  it("an amount correction of the record in force today changes the pay in force after", () => {
    const p = plan({ recordId: "r3", newDate: "2025-01-01", newBasic: 5400, newAllowances: { housing: 500, other: 200 } });
    expect(p).toMatchObject({ ok: true, amountChanged: true, dateChanged: false });
    if (p.ok) { expect(p.beforeToday?.base_salary).toBe(5000); expect(p.afterToday?.base_salary).toBe(5400); }
  });

  it("the mistaken opening record: a later real date leaves the time before it uncovered, and says so", () => {
    const only = [rec("o", "2024-01-01", 8000, { other: 500 }, true)];
    const p = planPayCorrection({ ...base, records: only, recordId: "o", newDate: "2025-03-01", newBasic: 8000, newAllowances: { other: 500 } });
    expect(p).toMatchObject({ ok: true, uncoveredFrom: "2024-01-01", uncoveredTo: "2025-03-01" });
  });

  it("refuses a duplicate start, a date past a neighbour (reordering), before hire and after today", () => {
    expect(refused({ recordId: "r2", newDate: "2025-01-01", newBasic: 4500, newAllowances: { housing: 500 } })).toMatch(/Another pay record already starts on 2025-01-01/);
    expect(refused({ recordId: "r2", newDate: "2024-01-01", newBasic: 4500, newAllowances: { housing: 500 } })).toMatch(/Another pay record already starts on 2024-01-01/);
    expect(refused({ recordId: "r2", newDate: "2025-06-01", newBasic: 4500, newAllowances: { housing: 500 } })).toMatch(/after the next pay record, which starts on 2025-01-01.*out of order/);
    expect(refused({ recordId: "r3", newDate: "2024-03-01", newBasic: 5000, newAllowances: { housing: 500, other: 200 } })).toMatch(/before the pay record that starts on 2024-07-01.*out of order/);
    expect(refused({ recordId: "r1", newDate: "2023-12-31", newBasic: 4000, newAllowances: {} })).toMatch(/cannot start before the hire date \(2024-01-01\)/);
    expect(refused({ recordId: "r3", newDate: "2026-11-17", newBasic: 5000, newAllowances: { housing: 500, other: 200 } })).toMatch(/cannot be later than today.*Update pay/);
  });

  it("refuses nothing changed, a zero basic salary, a negative allowance and an unknown record", () => {
    expect(refused({ recordId: "r1", newDate: "2024-01-01", newBasic: 4000, newAllowances: {} })).toMatch(/Nothing changed/);
    expect(refused({ recordId: "r1", newDate: "", newBasic: 0, newAllowances: {} })).toMatch(/more than zero/);
    expect(refused({ recordId: "r1", newDate: "", newBasic: 4100, newAllowances: { other: -1 } })).toMatch(/zero or more/);
    expect(refused({ recordId: "nope", newDate: "", newBasic: 4100, newAllowances: {} })).toMatch(/Couldn’t find/);
  });

  it("pending changes: an amount change of the record one was based on is refused; a date that reaches one is refused; a date-only change before it is fine", () => {
    const pending = [{ effective_date: "2026-12-01", basedOnId: "r3" }];
    expect(refused({ recordId: "r3", newDate: "2025-01-01", newBasic: 5100, newAllowances: { housing: 500, other: 200 }, pending })).toMatch(/pay change for 2026-12-01 is already scheduled.*Cancel that scheduled change first/);
    expect(plan({ recordId: "r3", newDate: "2025-02-01", newBasic: 5000, newAllowances: { housing: 500, other: 200 }, pending }).ok).toBe(true);
    const due = [{ effective_date: "2026-11-10", basedOnId: "r3" }];
    expect(refused({ recordId: "r3", newDate: "2026-11-10", newBasic: 5000, newAllowances: { housing: 500, other: 200 }, pending: due })).toMatch(/scheduled for 2026-11-10.*before it/);
    // A pending change worked out from an older record does not block an amount correction of this one.
    expect(plan({ recordId: "r3", newDate: "", newBasic: 5100, newAllowances: { housing: 500, other: 200 }, pending: [{ effective_date: "2026-12-01", basedOnId: "r2" }] }).ok).toBe(true);
  });
});

describe("recordInForce", () => {
  it("is the latest record that has started, whatever the order given, and null before the first", () => {
    expect(recordInForce(records, "2026-11-16")?.id).toBe("r3");
    expect(recordInForce(records, "2024-12-31")?.id).toBe("r2");
    expect(recordInForce(records, "2024-01-01")?.id).toBe("r1");
    expect(recordInForce(records, "2023-12-31")).toBeNull();
  });
});

describe("impactLines", () => {
  it("says which approved payroll export and which final settlement use the record, and lists a held change; says nothing when nothing does", () => {
    expect(impactLines(null)).toEqual([]);
    expect(impactLines({ payroll_runs: [], final_settlement: null, pending_changes: [{ event_id: "e", effective_date: "2026-12-01", held: false }] })).toEqual([]);
    const lines = impactLines({
      payroll_runs: [{ run_id: "a", period_month: 3, period_year: 2024, status: "approved", sent_at: "2024-04-02T09:00:00Z" }, { run_id: "b", period_month: 11, period_year: 2024, status: "approved", sent_at: null }],
      final_settlement: { termination_date: "2025-06-30", reads_current_pay: true, statutory_rate_recorded: false },
      pending_changes: [{ event_id: "e", effective_date: "2026-12-01", held: true }],
    });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/March 2024 \(sent to payroll on 2 Apr 2024\)/);
    expect(lines[1]).toMatch(/November 2024 \(approved, not marked as sent\)/);
    expect(lines[2]).toMatch(/final settlement \(leaving date 30 Jun 2025\)/);
    expect(lines[3]).toMatch(/held pay change dated 1 Dec 2026/);
  });
});

describe("payCorrectionErrorMessage", () => {
  it("keeps the function's own sentences and never shows a raw database message", () => {
    expect(payCorrectionErrorMessage({ code: "22023", message: "Another pay record already starts on 2025-01-01. Two pay records cannot start on the same day." })).toMatch(/already starts/);
    expect(payCorrectionErrorMessage({ code: "42501", message: "You are not allowed to correct this pay record." })).toBe("You are not allowed to correct this pay record.");
    expect(payCorrectionErrorMessage({ code: "42501", message: "permission denied for function correct_pay_record" })).toBe("You are not allowed to correct this pay record.");
    expect(payCorrectionErrorMessage({ code: "PGRST202", message: "no function" })).toMatch(/not installed/);
    expect(payCorrectionErrorMessage({ code: "55P03", message: "lock_timeout" })).toMatch(/Someone else is changing/);
    const generic = payCorrectionErrorMessage({ code: "XX000", message: 'relation "compensation_details" blew up' });
    expect(generic).toMatch(/Nothing was changed/);
    expect(generic).not.toMatch(/blew up|relation/);
  });
});
