import { describe, expect, it, vi } from "vitest";
import { applyPolandTerminationLeaveTrueUp, checkPolandTerminationSettlementReadiness } from "./polandTermination";

const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";

/**
 * A minimal stand-in for the chainable supabase-js query builder, tailored
 * to exactly the methods polandTermination.ts calls (select/eq, chained any
 * number of times, then awaited directly OR resolved via .maybeSingle()).
 * Each `.from()` call pops the next canned response off `queue`, in the same
 * fixed sequence the module awaits them in — mirrors the pattern already
 * established in the leave-accrual cron's own route.test.ts.
 */
function createFakeSupabase(queue: Array<{ data: unknown; error?: unknown }>, rpc: ReturnType<typeof vi.fn>) {
  let i = 0;
  return {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle() {
          return Promise.resolve(queue[i++]);
        },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          return Promise.resolve(queue[i++]).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc,
  };
}

function rpcReturning(data: unknown, error: unknown = null) {
  return vi.fn().mockReturnValue({ single: () => Promise.resolve({ data, error }) });
}

const fullTimeFromHire = (hireDate: string) => [{ start_date: hireDate, fte_fraction: "1" }];

describe("applyPolandTerminationLeaveTrueUp", () => {
  it("posts the correct true-up amount for a full-time employee leaving mid-year after the cron already granted a full year", async () => {
    // Hired 2023-01-01, entitled through 2023-06-30: 6 whole calendar months
    // -> ceil(26/12*6) = 13. The cron already posted a full 26 for this
    // year (an 'accrual' row) — rawDelta = 13 - 26 = -13.
    const rpc = rpcReturning({ applied_days: -13, excess_requiring_review: 0, already_posted: false });
    const ledgerRows = [
      { id: "a1", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "accrual", amount_days: 26, reference_type: "policy_run", reversal_of_id: null },
    ];
    const supabase = createFakeSupabase([{ data: fullTimeFromHire("2023-01-01") }, { data: ledgerRows }], rpc);

    const warning = await applyPolandTerminationLeaveTrueUp(supabase as never, EMPLOYEE_ID, "2023-01-01", "2023-06-30");

    expect(warning).toBeNull();
    expect(rpc).toHaveBeenCalledWith("post_poland_termination_leave_adjustment", expect.objectContaining({ p_employee_id: EMPLOYEE_ID, p_amount_days: -13 }));
  });

  it("surfaces a warning (a possible overpayment) when the RPC reports the clawback was capped and days require HR review", async () => {
    const rpc = rpcReturning({ applied_days: -6, excess_requiring_review: 7, already_posted: false });
    const ledgerRows = [
      { id: "a1", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "accrual", amount_days: 26, reference_type: "policy_run", reversal_of_id: null },
      { id: "d1", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "deduction", amount_days: -20, reference_type: "leave_request", reversal_of_id: null },
    ];
    const supabase = createFakeSupabase([{ data: fullTimeFromHire("2023-01-01") }, { data: ledgerRows }], rpc);

    const warning = await applyPolandTerminationLeaveTrueUp(supabase as never, EMPLOYEE_ID, "2023-01-01", "2023-06-30");

    expect(warning).toMatch(/already used/);
    expect(warning).toMatch(/HR review/);
  });

  it("blocks the automatic true-up (never calls the RPC) when the FTE changes mid-way through the exit year", async () => {
    const fteFractionHistory = [
      { start_date: "2023-01-01", fte_fraction: "1" },
      { start_date: "2023-07-01", fte_fraction: "0.5" },
    ];
    const rpc = vi.fn();
    const supabase = createFakeSupabase([{ data: fteFractionHistory }, { data: [] }], rpc);

    const warning = await applyPolandTerminationLeaveTrueUp(supabase as never, EMPLOYEE_ID, "2023-01-01", "2023-12-31");

    expect(warning).toMatch(/could not be automatically trued up/);
    expect(warning).toMatch(/FTE changes during/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks the automatic true-up (never calls the RPC) when no employment_contracts / FTE history exists at all", async () => {
    const rpc = vi.fn();
    const supabase = createFakeSupabase([{ data: [] }, { data: [] }], rpc);

    const warning = await applyPolandTerminationLeaveTrueUp(supabase as never, EMPLOYEE_ID, "2023-01-01", "2023-12-31");

    expect(warning).toMatch(/could not be automatically trued up/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks the automatic true-up (never calls the RPC) when the historical ledger contains an unclassified adjustment", async () => {
    const ledgerRows = [
      { id: "adj1", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "adjustment", amount_days: 5, reference_type: "manual_adjustment", reversal_of_id: null },
    ];
    const rpc = vi.fn();
    const supabase = createFakeSupabase([{ data: fullTimeFromHire("2023-01-01") }, { data: ledgerRows }], rpc);

    const warning = await applyPolandTerminationLeaveTrueUp(supabase as never, EMPLOYEE_ID, "2023-01-01", "2023-12-31");

    expect(warning).toMatch(/unclassified adjustment/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own error as a warning rather than throwing", async () => {
    const rpc = rpcReturning(null, { message: "connection reset" });
    const supabase = createFakeSupabase([{ data: fullTimeFromHire("2023-01-01") }, { data: [] }], rpc);

    const warning = await applyPolandTerminationLeaveTrueUp(supabase as never, EMPLOYEE_ID, "2023-01-01", "2023-06-30");

    expect(warning).toMatch(/connection reset/);
  });

  it("returns no warning and posts nothing extra when the cron already granted exactly the right prorated amount", async () => {
    const rpc = rpcReturning({ applied_days: 0, excess_requiring_review: 0, already_posted: false });
    const ledgerRows = [
      { id: "a1", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "accrual", amount_days: 13, reference_type: "policy_run", reversal_of_id: null },
    ];
    const supabase = createFakeSupabase([{ data: fullTimeFromHire("2023-01-01") }, { data: ledgerRows }], rpc);

    const warning = await applyPolandTerminationLeaveTrueUp(supabase as never, EMPLOYEE_ID, "2023-01-01", "2023-06-30");

    expect(warning).toBeNull();
    expect(rpc).toHaveBeenCalledWith("post_poland_termination_leave_adjustment", expect.objectContaining({ p_amount_days: 0 }));
  });

  it("blocks the automatic true-up (never calls the RPC, never treats the failure as an empty history) when the employment_contracts query itself fails", async () => {
    const rpc = vi.fn();
    const supabase = createFakeSupabase([{ data: null, error: { message: "connection reset" } }], rpc);

    const warning = await applyPolandTerminationLeaveTrueUp(supabase as never, EMPLOYEE_ID, "2023-01-01", "2023-06-30");

    expect(warning).toMatch(/employment contract history couldn't be read/);
    expect(warning).toMatch(/connection reset/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks the automatic true-up (never calls the RPC, never treats the failure as an empty history) when the leave_ledger query itself fails", async () => {
    const rpc = vi.fn();
    const supabase = createFakeSupabase([{ data: fullTimeFromHire("2023-01-01") }, { data: null, error: { message: "statement timeout" } }], rpc);

    const warning = await applyPolandTerminationLeaveTrueUp(supabase as never, EMPLOYEE_ID, "2023-01-01", "2023-06-30");

    expect(warning).toMatch(/Annual Leave ledger history couldn't be read/);
    expect(warning).toMatch(/statement timeout/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("checkPolandTerminationSettlementReadiness — the actual gate Final Settlement uses, read from the completion marker, never inferred from a recomputation", () => {
  it("blocks when the reconciliation query itself fails", async () => {
    const supabase = createFakeSupabase([{ data: null, error: { message: "connection reset" } }], vi.fn());
    const result = await checkPolandTerminationSettlementReadiness(supabase as never, EMPLOYEE_ID, "2026-06-30");
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/connection reset/);
  });

  it("blocks when no reconciliation marker exists yet — the true-up has never completed for this employee", async () => {
    const supabase = createFakeSupabase([{ data: null }], vi.fn());
    const result = await checkPolandTerminationSettlementReadiness(supabase as never, EMPLOYEE_ID, "2026-06-30");
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/has not completed/);
  });

  it("blocks when the marker's termination_date does not match the one Final Settlement is being asked to render", async () => {
    const supabase = createFakeSupabase(
      [{ data: { termination_date: "2026-05-01", excess_requiring_review_days: "0", excess_reviewed_at: null } }],
      vi.fn(),
    );
    const result = await checkPolandTerminationSettlementReadiness(supabase as never, EMPLOYEE_ID, "2026-06-30");
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/has not completed/);
  });

  it("blocks when there is a positive, unacknowledged excess requiring HR review", async () => {
    const supabase = createFakeSupabase(
      [{ data: { termination_date: "2026-06-30", excess_requiring_review_days: "7", excess_reviewed_at: null } }],
      vi.fn(),
    );
    const result = await checkPolandTerminationSettlementReadiness(supabase as never, EMPLOYEE_ID, "2026-06-30");
    expect(result.ready).toBe(false);
    expect(result.excessRequiringReview).toBe(7);
    expect(result.reason).toMatch(/HR must review and acknowledge/);
  });

  it("is ready once a matching marker exists with no excess", async () => {
    const supabase = createFakeSupabase(
      [{ data: { termination_date: "2026-06-30", excess_requiring_review_days: "0", excess_reviewed_at: null } }],
      vi.fn(),
    );
    const result = await checkPolandTerminationSettlementReadiness(supabase as never, EMPLOYEE_ID, "2026-06-30");
    expect(result.ready).toBe(true);
  });

  it("is ready once a matching marker's excess has been explicitly acknowledged", async () => {
    const supabase = createFakeSupabase(
      [{ data: { termination_date: "2026-06-30", excess_requiring_review_days: "7", excess_reviewed_at: "2026-07-01T00:00:00Z" } }],
      vi.fn(),
    );
    const result = await checkPolandTerminationSettlementReadiness(supabase as never, EMPLOYEE_ID, "2026-06-30");
    expect(result.ready).toBe(true);
  });
});
