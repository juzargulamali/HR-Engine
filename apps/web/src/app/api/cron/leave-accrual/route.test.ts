import { describe, it, expect, vi, beforeEach } from "vitest";

// This route (and the cron/auth + cron/batch helpers it imports) are marked
// "server-only" so an accidental Client Component import fails at build
// time — a guard vitest's Node environment isn't a Next.js build, so it
// throws on the bare import unless stubbed out here.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { GET, classifyLedgerRows, type AnnualLeaveLedgerRow } from "./route";

import { createAdminClient } from "@/lib/supabase/admin";

const CRON_SECRET = "test-cron-secret";

function authorizedRequest(qs = ""): Request {
  return new Request(`https://example.test/api/cron/leave-accrual${qs}`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function isoDateYearsAgo(years: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";
const POLICY_VERSION_ID = "22222222-2222-2222-2222-222222222222";

/**
 * A minimal stand-in for the chainable supabase-js query builder, tailored
 * to exactly the methods this route calls (select/eq/in/is/gte/lte/or,
 * upsert). Each `.from()` call pops the next canned response off `queue`,
 * in the same fixed sequence the route awaits them in (this route makes no
 * parallel/Promise.all calls, so call order is deterministic). A queue entry
 * may be a plain `{data, error}`-shaped object, or a function of the
 * recorded call (table + captured args) for a step whose response depends
 * on what was sent — used here for `upsert`, to simulate the database's
 * real onConflict+ignoreDuplicates behavior against a shared idempotency-key
 * store across separate invocations (the concurrent/repeated-execution test).
 */
function createFakeAdmin(queue: Array<unknown | ((call: { table: string; upsertRows?: unknown[] }) => unknown)>) {
  let i = 0;
  return {
    from(table: string) {
      const call: { table: string; upsertRows?: unknown[] } = { table };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        gte: () => builder,
        lte: () => builder,
        or: () => builder,
        upsert: (rows: unknown[]) => {
          call.upsertRows = rows;
          return builder;
        },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          const entry = queue[i++];
          const result = typeof entry === "function" ? (entry as (c: typeof call) => unknown)(call) : entry;
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

/** Upsert step that dedups against a shared committed-idempotency-key set,
 * mirroring the real unique-constraint + onConflict/ignoreDuplicates
 * behavior a retried or overlapping cron invocation relies on. */
function dedupingUpsertStep(committedKeys: Set<string>) {
  return (call: { upsertRows?: Array<{ idempotency_key: string }> }) => {
    const rows = call.upsertRows ?? [];
    let count = 0;
    for (const row of rows) {
      if (!committedKeys.has(row.idempotency_key)) {
        committedKeys.add(row.idempotency_key);
        count += 1;
      }
    }
    return { error: null, count };
  };
}

const BASE_POLICY_VERSIONS = { data: [{ id: POLICY_VERSION_ID, country_code: "AE" }], error: null };
const BASE_LEAVE_TYPES = {
  data: [
    {
      policy_version_id: POLICY_VERSION_ID,
      leave_type_code: "annual",
      accrual_method: "per_service_year",
      accrual_rate_per_period: null,
      max_balance_days: null,
      min_service_days_to_accrue: 0,
    },
  ],
  error: null,
};

function employeesStep(hireDate: string) {
  return { data: [{ id: EMPLOYEE_ID, country_code: "AE", hire_date: hireDate, recognised_prior_service_years: null }], error: null };
}
const EMPTY = { data: [], error: null };

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.mocked(createAdminClient).mockReset();
});

describe("GET /api/cron/leave-accrual — authorization", () => {
  it("rejects a request without the correct bearer secret", async () => {
    vi.mocked(createAdminClient).mockReturnValue(createFakeAdmin([]) as never);
    const res = await GET(new Request("https://example.test/api/cron/leave-accrual"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/leave-accrual — legacy accrual baseline safety (Blocker 1)", () => {
  it("counts a legacy accrual entry not tagged 'policy_run' toward the baseline, then posts only the remaining delta", async () => {
    const hireDate = isoDateYearsAgo(2); // UAE: 2 completed years => 60 days entitlement-to-date
    const legacyAccrual: AnnualLeaveLedgerRow = {
      id: "a1",
      employee_id: EMPLOYEE_ID,
      leave_type_code: "annual",
      entry_type: "accrual",
      amount_days: 10,
      reference_type: "legacy_migration", // NOT 'policy_run' — the exact bug Blocker 1 fixes
      reversal_of_id: null,
    };
    const admin = createFakeAdmin([
      BASE_POLICY_VERSIONS,
      BASE_LEAVE_TYPES,
      employeesStep(hireDate),
      EMPTY, // employment_contracts
      EMPTY, // alreadyAccrued (this month)
      EMPTY, // leave_balances
      { data: [legacyAccrual], error: null }, // historyRows
      { error: null, count: 1 }, // upsert
    ]);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await GET(authorizedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entriesPosted).toBe(1);
    expect(body.ambiguousBaselines).toEqual([]);
  });

  it("counts an existing onboarding opening-balance grant ('opening_balance') toward the baseline", async () => {
    const hireDate = isoDateYearsAgo(2);
    const openingGrant: AnnualLeaveLedgerRow = {
      id: "a2",
      employee_id: EMPLOYEE_ID,
      leave_type_code: "annual",
      entry_type: "adjustment",
      amount_days: 5,
      reference_type: "opening_balance",
      reversal_of_id: null,
    };
    const captured: { upsertRows?: Array<{ amount_days: number }> } = {};
    const admin = createFakeAdmin([
      BASE_POLICY_VERSIONS,
      BASE_LEAVE_TYPES,
      employeesStep(hireDate),
      EMPTY,
      EMPTY,
      EMPTY,
      { data: [openingGrant], error: null },
      (call: { upsertRows?: Array<{ amount_days: number }> }) => {
        captured.upsertRows = call.upsertRows;
        return { error: null, count: call.upsertRows?.length ?? 0 };
      },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await GET(authorizedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entriesPosted).toBe(1);
    expect(captured.upsertRows?.[0]?.amount_days).toBe(60 - 5);
  });

  it("never lets a prior deduction (or the resulting net balance) reduce the granted baseline", async () => {
    const hireDate = isoDateYearsAgo(2);
    const rows: AnnualLeaveLedgerRow[] = [
      { id: "a3", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "accrual", amount_days: 10, reference_type: "policy_run", reversal_of_id: null },
      { id: "d1", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "deduction", amount_days: -8, reference_type: "leave_request", reversal_of_id: null },
    ];
    // Net balance (2) must NOT be used as the baseline — only the grant (10).
    const balancesStep = { data: [{ employee_id: EMPLOYEE_ID, leave_type_code: "annual", balance_days: 2 }], error: null };
    const captured: { upsertRows?: Array<{ amount_days: number }> } = {};
    const admin = createFakeAdmin([
      BASE_POLICY_VERSIONS,
      BASE_LEAVE_TYPES,
      employeesStep(hireDate),
      EMPTY,
      EMPTY,
      balancesStep,
      { data: rows, error: null },
      (call: { upsertRows?: Array<{ amount_days: number }> }) => {
        captured.upsertRows = call.upsertRows;
        return { error: null, count: call.upsertRows?.length ?? 0 };
      },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await GET(authorizedRequest());
    await res.json();

    // 60 - 10 = 50, NOT 60 - 2 = 58 (which is what a net-balance-derived baseline would wrongly produce).
    expect(captured.upsertRows?.[0]?.amount_days).toBe(50);
  });

  it("skips (never guesses) an employee whose historical baseline is ambiguous, and reports the condition", async () => {
    const hireDate = isoDateYearsAgo(2);
    const ambiguousAdjustment: AnnualLeaveLedgerRow = {
      id: "adj1",
      employee_id: EMPLOYEE_ID,
      leave_type_code: "annual",
      entry_type: "adjustment",
      amount_days: 7,
      reference_type: "manual_adjustment", // generic — could be anything, not provably an opening grant
      reversal_of_id: null,
    };
    const admin = createFakeAdmin([BASE_POLICY_VERSIONS, BASE_LEAVE_TYPES, employeesStep(hireDate), EMPTY, EMPTY, EMPTY, { data: [ambiguousAdjustment], error: null }]);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await GET(authorizedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entriesPosted).toBe(0);
    expect(body.skipped).toBeGreaterThanOrEqual(1);
    expect(body.ambiguousBaselines).toEqual([expect.objectContaining({ employeeId: EMPLOYEE_ID, leaveTypeCode: "annual" })]);
  });

  it("in preflight mode (?mode=preflight), reports the same ambiguous condition read-only and inserts nothing", async () => {
    const hireDate = isoDateYearsAgo(2);
    const ambiguousAdjustment: AnnualLeaveLedgerRow = {
      id: "adj2",
      employee_id: EMPLOYEE_ID,
      leave_type_code: "annual",
      entry_type: "adjustment",
      amount_days: 7,
      reference_type: "manual_adjustment",
      reversal_of_id: null,
    };
    // Queue has NO upsert step — if the route tried to insert, the missing
    // queue entry would resolve to `undefined` and the test would throw
    // when destructuring it below, correctly failing.
    const admin = createFakeAdmin([BASE_POLICY_VERSIONS, BASE_LEAVE_TYPES, employeesStep(hireDate), EMPTY, EMPTY, EMPTY, { data: [ambiguousAdjustment], error: null }]);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await GET(authorizedRequest("?mode=preflight"));
    const body = await res.json();

    expect(body.mode).toBe("preflight");
    expect(body.wouldPost).toBe(0);
    expect(body.ambiguousBaselines).toEqual([expect.objectContaining({ employeeId: EMPLOYEE_ID, leaveTypeCode: "annual" })]);
  });

  it("a reversal of a DEDUCTION (e.g. a cancelled leave request) does not inflate the granted baseline", async () => {
    const hireDate = isoDateYearsAgo(2);
    const rows: AnnualLeaveLedgerRow[] = [
      { id: "a4", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "accrual", amount_days: 10, reference_type: "policy_run", reversal_of_id: null },
      { id: "d2", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "deduction", amount_days: -4, reference_type: "leave_request", reversal_of_id: null },
      { id: "r1", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "reversal", amount_days: 4, reference_type: "leave_request", reversal_of_id: "d2" },
    ];
    const captured: { upsertRows?: Array<{ amount_days: number }> } = {};
    const admin = createFakeAdmin([
      BASE_POLICY_VERSIONS,
      BASE_LEAVE_TYPES,
      employeesStep(hireDate),
      EMPTY,
      EMPTY,
      EMPTY,
      { data: rows, error: null },
      (call: { upsertRows?: Array<{ amount_days: number }> }) => {
        captured.upsertRows = call.upsertRows;
        return { error: null, count: call.upsertRows?.length ?? 0 };
      },
    ]);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await GET(authorizedRequest());
    await res.json();

    // Baseline stays 10 (the accrual), not 14 — the reversal restored a used
    // day, it did not grant a new one.
    expect(captured.upsertRows?.[0]?.amount_days).toBe(50);
  });

  it("classifyLedgerRows: treats an orphan reversal (target row not found) as ambiguous rather than guessing a direction", () => {
    const rows: AnnualLeaveLedgerRow[] = [{ id: "r2", employee_id: EMPLOYEE_ID, leave_type_code: "annual", entry_type: "reversal", amount_days: 3, reference_type: null, reversal_of_id: "missing" }];
    const { ambiguousKeys, grantTotalByKey } = classifyLedgerRows(rows);
    expect(ambiguousKeys.has(`${EMPLOYEE_ID}:annual`)).toBe(true);
    expect(grantTotalByKey.has(`${EMPLOYEE_ID}:annual`)).toBe(false);
  });

  it("does not double-post across a retried/overlapping invocation for the same employee/leave-type/month", async () => {
    const hireDate = isoDateYearsAgo(2);
    const committedKeys = new Set<string>();
    const upsertStep = dedupingUpsertStep(committedKeys);

    const firstRun = createFakeAdmin([BASE_POLICY_VERSIONS, BASE_LEAVE_TYPES, employeesStep(hireDate), EMPTY, EMPTY, EMPTY, EMPTY, upsertStep]);
    vi.mocked(createAdminClient).mockReturnValueOnce(firstRun as never);
    const firstRes = await GET(authorizedRequest());
    const firstBody = await firstRes.json();

    // Second, overlapping/retried invocation reads the SAME (stale, pre-post)
    // state — its own app-level "already accrued this month" check can't see
    // the first run's insert, exactly the race idempotency_key exists for.
    const secondRun = createFakeAdmin([BASE_POLICY_VERSIONS, BASE_LEAVE_TYPES, employeesStep(hireDate), EMPTY, EMPTY, EMPTY, EMPTY, upsertStep]);
    vi.mocked(createAdminClient).mockReturnValueOnce(secondRun as never);
    const secondRes = await GET(authorizedRequest());
    const secondBody = await secondRes.json();

    expect(firstBody.entriesPosted).toBe(1);
    expect(secondBody.entriesPosted).toBe(0); // deduped by the shared idempotency key
    expect(committedKeys.size).toBe(1);
  });
});
