import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Covers the Jibble-driven Recovery Leave redesign end to end:
// import_jibble_time_entry()/sync_jibble_attendance_for_day() (idempotency,
// multiple entries per day, overnight vs. standard eligibility, unmapped
// people, manual-record protection, edits before/after approval) and the
// single-step HR queue (decide_recovery_credit_request()/
// adjust_recovery_credit_request(): two-HR-admin visibility and
// concurrency, self-approval, company isolation, required correction
// reasons, server-side recomputation). See phase4.rls.test.ts and
// leave_policy_configuration.rls.test.ts for the manual-register/overnight-
// form paths and the generic approval-engine mechanics (those are
// unchanged by this file's own additions and stay covered there).

async function actAs(query: Client["query"], userId: string) {
  await query("SET LOCAL ROLE authenticated");
  await query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

const COMPANY_A = "00000000-0000-0000-0000-0000000a0a01";
const COMPANY_B = "00000000-0000-0000-0000-0000000a0b01";

const USER_HR1 = "00000000-0000-0000-0000-0000000a0a11";
const USER_HR2 = "00000000-0000-0000-0000-0000000a0a12";
const USER_MANAGER = "00000000-0000-0000-0000-0000000a0a13";
const USER_WORKER = "00000000-0000-0000-0000-0000000a0a14";
const USER_WORKER2 = "00000000-0000-0000-0000-0000000a0a15";
const USER_HR_OTHER_COMPANY = "00000000-0000-0000-0000-0000000a0b11";

const EMPLOYEE_HR1 = "00000000-0000-0000-0000-0000000a0a21";
const EMPLOYEE_WORKER = "00000000-0000-0000-0000-0000000a0a22";
const EMPLOYEE_WORKER2 = "00000000-0000-0000-0000-0000000a0a23";

const JIBBLE_COMPANY_ID = COMPANY_A;

// content_hash = md5(raw_payload) is what import_jibble_time_entry() uses
// to detect a genuine edit — so this payload MUST reflect the entry's own
// fields (never a constant), or two calls with different start/end/note
// would hash identically and the function would wrongly treat a real edit
// as a byte-identical no-op re-sync.
function rawPayload(args: { start: string | null; end: string | null; note?: string | null; breakMinutes?: number }, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ source: "test", start: args.start, end: args.end, note: args.note ?? null, breakMinutes: args.breakMinutes ?? 0, ...extra });
}

// db.seed() runs as the unrestricted admin/superuser connection — the same
// way a real service_role call (the only role import_jibble_time_entry() is
// granted EXECUTE to) is unrestricted by that grant too. This is the ONE
// function in this file ever called this way; every HR decision/correction
// below goes through actAs()/asUser() exactly like a real authenticated
// session, since those RPCs have no such restriction (they self-check via
// has_role() instead, same as every other approval-engine mutator).
async function importJibbleEntry(
  db: RlsTestDatabase,
  args: {
    entryId: string;
    personId: string;
    start: string | null;
    end: string | null;
    note?: string | null;
    breakMinutes?: number;
    raw?: Record<string, unknown>;
    clientNeedsReview?: boolean;
    clientReviewReason?: string;
  },
) {
  return db.seed(
    `select * from import_jibble_time_entry(
      '${JIBBLE_COMPANY_ID}', '${args.entryId}', '${args.personId}',
      ${args.start ? `'${args.start}'` : "null"}, ${args.end ? `'${args.end}'` : "null"},
      ${args.note ? `'${args.note.replace(/'/g, "''")}'` : "null"}, ${args.breakMinutes ?? 0},
      '${rawPayload(args, args.raw)}'::jsonb,
      ${args.clientNeedsReview ?? false},
      ${args.clientReviewReason ? `'${args.clientReviewReason.replace(/'/g, "''")}'` : "null"}
    )`,
  );
}

describe("Recovery Leave: Jibble import + single-step HR queue", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_HR1}', 'jq-hr1@enginious.ae'),
        ('${USER_HR2}', 'jq-hr2@enginious.ae'),
        ('${USER_MANAGER}', 'jq-manager@enginious.ae'),
        ('${USER_WORKER}', 'jq-worker@enginious.ae'),
        ('${USER_WORKER2}', 'jq-worker2@enginious.ae'),
        ('${USER_HR_OTHER_COMPANY}', 'jq-hr-other@enginious.ae');

      -- Mon-Fri working week (Sat/Sun weekend) — clean, unambiguous
      -- eligibility for the standard/overnight split this file tests.
      insert into countries (code, name, default_currency, working_weekdays) values ('ZJ', 'Zedjibble', 'ZJD', array[1,2,3,4,5])
      on conflict (code) do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${COMPANY_A}', 'Jibble Queue Co', 'ZJ', 'ZJD'),
        ('${COMPANY_B}', 'Other Co', 'ZJ', 'ZJD');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, jibble_person_id) values
        ('${EMPLOYEE_HR1}', '${USER_HR1}', 'JQ-01', '${COMPANY_A}', 'ZJ', 'Hana', 'HrOne', '2024-01-01', null),
        ('${EMPLOYEE_WORKER}', '${USER_WORKER}', 'JQ-02', '${COMPANY_A}', 'ZJ', 'Wale', 'Worker', '2024-01-01', 'jp-worker'),
        ('${EMPLOYEE_WORKER2}', '${USER_WORKER2}', 'JQ-03', '${COMPANY_A}', 'ZJ', 'Wynn', 'WorkerTwo', '2024-01-01', 'jp-worker2');

      insert into user_roles (user_id, role, company_id) values
        ('${USER_HR1}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_HR2}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_MANAGER}', 'line_manager', '${COMPANY_A}'),
        ('${USER_HR_OTHER_COMPANY}', 'hr_admin', '${COMPANY_B}');

      insert into public_holidays (country_code, holiday_date, name) values ('ZJ', '2027-01-01', 'New Year');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("import_jibble_time_entry(): detection", () => {
    it("does not qualify ordinary work on a normal weekday, no matter how many hours", async () => {
      // 2027-01-05 is a Tuesday.
      const { rows } = await importJibbleEntry(db, {
        entryId: "e-weekday-1",
        personId: "jp-worker",
        start: "2027-01-05T08:00:00Z",
        end: "2027-01-05T20:00:00Z",
      });
      expect(rows[0].recovery_credit_request_id).toBeNull();
      expect(rows[0].needs_review).toBe(false);

      const attendance = await db.seed(
        `select status, hours_worked, source from attendance_records where employee_id = '${EMPLOYEE_WORKER}' and work_date = '2027-01-05'`,
      );
      expect(attendance.rows).toEqual([{ status: "present", hours_worked: "12.00", source: "jibble" }]);
    });

    it("credits a weekend day worked (>4h -> 1 day)", async () => {
      // 2027-01-09 is a Saturday.
      const { rows } = await importJibbleEntry(db, {
        entryId: "e-weekend-1",
        personId: "jp-worker",
        start: "2027-01-09T08:00:00Z",
        end: "2027-01-09T13:00:00Z",
        note: "Went into the office to finish the release",
      });
      expect(rows[0].recovery_credit_request_id).toBeTruthy();

      const request = await db.seed(
        `select event_type, proposed_days, status from recovery_credit_requests where id = '${rows[0].recovery_credit_request_id}'`,
      );
      expect(request.rows).toEqual([{ event_type: "standard", proposed_days: "1.0", status: "submitted" }]);

      const jibbleRow = await db.seed(`select note from jibble_time_entries where jibble_entry_id = 'e-weekend-1'`);
      expect(jibbleRow.rows[0].note).toBe("Went into the office to finish the release");
    });

    it("credits a public holiday worked (<=4h -> 0.5 day)", async () => {
      const { rows } = await importJibbleEntry(db, {
        entryId: "e-holiday-1",
        personId: "jp-worker",
        start: "2027-01-01T08:00:00Z",
        end: "2027-01-01T11:00:00Z",
      });
      const request = await db.seed(`select event_type, proposed_days from recovery_credit_requests where id = '${rows[0].recovery_credit_request_id}'`);
      expect(request.rows).toEqual([{ event_type: "standard", proposed_days: "0.5" }]);
    });

    it("subtracts break minutes from the credited hours", async () => {
      // 2027-01-16 is a Saturday. 8am-1pm is 5h; a 90-minute break brings it
      // to 3.5h, which must land on the 0.5-day side of the threshold.
      const { rows } = await importJibbleEntry(db, {
        entryId: "e-break-1",
        personId: "jp-worker",
        start: "2027-01-16T08:00:00Z",
        end: "2027-01-16T13:00:00Z",
        breakMinutes: 90,
      });
      const attendance = await db.seed(`select hours_worked from attendance_records where id = (select attendance_record_id from jibble_time_entries where jibble_entry_id = 'e-break-1')`);
      expect(attendance.rows).toEqual([{ hours_worked: "3.50" }]);
      const request = await db.seed(`select proposed_days from recovery_credit_requests where id = '${rows[0].recovery_credit_request_id}'`);
      expect(request.rows).toEqual([{ proposed_days: "0.5" }]);
    });

    it("sums multiple entries on the same weekend day into ONE credit, not two", async () => {
      // 2027-01-23 is a Saturday — a morning session and an afternoon
      // session (e.g. an unpaid lunch modeled as two clock sessions rather
      // than a breaks field) must sum to one day's worth of hours.
      await importJibbleEntry(db, { entryId: "e-multi-am", personId: "jp-worker", start: "2027-01-23T08:00:00Z", end: "2027-01-23T11:00:00Z" });
      const second = await importJibbleEntry(db, { entryId: "e-multi-pm", personId: "jp-worker", start: "2027-01-23T12:00:00Z", end: "2027-01-23T16:00:00Z" });

      const attendance = await db.seed(`select hours_worked from attendance_records where employee_id = '${EMPLOYEE_WORKER}' and work_date = '2027-01-23'`);
      expect(attendance.rows).toEqual([{ hours_worked: "7.00" }]);

      const requests = await db.seed(
        `select count(*)::int as n from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = '${EMPLOYEE_WORKER}' and work_date = '2027-01-23')`,
      );
      expect(requests.rows).toEqual([{ n: 1 }]);
      expect(second.rows[0].recovery_credit_request_id).toBeTruthy();
    });

    it("re-importing a byte-identical entry is a pure no-op (idempotent under a repeated sync)", async () => {
      const args = { entryId: "e-idem-1", personId: "jp-worker", start: "2027-01-30T08:00:00Z", end: "2027-01-30T13:00:00Z" } as const;
      // 2027-01-30 is a Saturday.
      const first = await importJibbleEntry(db, args);
      const second = await importJibbleEntry(db, args);
      expect(second.rows[0].jibble_row_id).toBe(first.rows[0].jibble_row_id);
      expect(second.rows[0].recovery_credit_request_id).toBe(first.rows[0].recovery_credit_request_id);

      const requests = await db.seed(
        `select count(*)::int as n from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = '${EMPLOYEE_WORKER}' and work_date = '2027-01-30')`,
      );
      expect(requests.rows).toEqual([{ n: 1 }]);
      const rows = await db.seed(`select count(*)::int as n from jibble_time_entries where jibble_entry_id = 'e-idem-1'`);
      expect(rows.rows).toEqual([{ n: 1 }]);
    });

    it("a shift starting on a weekday and crossing midnight credits only the after-midnight hours, as an overnight extension", async () => {
      // country_timezone('ZJ') falls back to Asia/Dubai (UTC+4) — ZJ is
      // deliberately not in that map, exercising the fallback. In LOCAL
      // (Dubai) time this entry is Wed 2027-02-03 23:00 -> Thu 2027-02-04
      // 05:00: an ordinary working day, 6h total, 5h after local midnight.
      const { rows } = await importJibbleEntry(db, {
        entryId: "e-overnight-1",
        personId: "jp-worker",
        start: "2027-02-03T19:00:00Z",
        end: "2027-02-04T01:00:00Z",
      });
      const request = await db.seed(`select event_type, proposed_days, work_date::text from recovery_credit_requests where id = '${rows[0].recovery_credit_request_id}'`);
      expect(request.rows).toEqual([{ event_type: "overnight", proposed_days: "1.0", work_date: "2027-02-03" }]);

      const attendance = await db.seed(`select hours_worked, active_hours_after_midnight from attendance_records where employee_id = '${EMPLOYEE_WORKER}' and work_date = '2027-02-03'`);
      expect(attendance.rows).toEqual([{ hours_worked: "6.00", active_hours_after_midnight: "5.00" }]);
    });

    it("a shift starting on a WEEKEND and crossing midnight credits the FULL shift as standard — never split, never double-counted", async () => {
      // In LOCAL (Dubai, UTC+4) time this entry is Sat 2027-02-06 20:00 ->
      // Sun 2027-02-07 04:00: 8 hours total, 4 of them after local midnight.
      // Since Saturday itself already qualifies, the whole 8 hours count
      // once, as 'standard' — not a separate 4h 'standard' credit plus a 4h
      // 'overnight' one.
      const { rows } = await importJibbleEntry(db, {
        entryId: "e-overlap-1",
        personId: "jp-worker",
        start: "2027-02-06T16:00:00Z",
        end: "2027-02-07T00:00:00Z",
      });
      const requests = await db.seed(
        `select id, event_type, proposed_days from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = '${EMPLOYEE_WORKER}' and work_date = '2027-02-06')`,
      );
      expect(requests.rows).toEqual([{ id: rows[0].recovery_credit_request_id, event_type: "standard", proposed_days: "1.0" }]);

      const attendance = await db.seed(`select hours_worked from attendance_records where employee_id = '${EMPLOYEE_WORKER}' and work_date = '2027-02-06'`);
      expect(attendance.rows).toEqual([{ hours_worked: "8.00" }]);
    });

    it("flags an entry for an unmapped Jibble person, without touching attendance", async () => {
      const { rows } = await importJibbleEntry(db, {
        entryId: "e-unmapped-1",
        personId: "jp-nobody",
        start: "2027-01-09T08:00:00Z",
        end: "2027-01-09T13:00:00Z",
      });
      expect(rows[0].needs_review).toBe(true);
      expect(rows[0].review_reason).toMatch(/No employee in this company is mapped/);
      expect(rows[0].attendance_record_id).toBeNull();
    });

    it("flags an entry whose end is not after its start", async () => {
      const { rows } = await importJibbleEntry(db, {
        entryId: "e-invalid-1",
        personId: "jp-worker",
        start: "2027-01-09T13:00:00Z",
        end: "2027-01-09T08:00:00Z",
      });
      expect(rows[0].needs_review).toBe(true);
      expect(rows[0].review_reason).toMatch(/end time is not after its start time/);
    });

    it("never overwrites a MANUALLY recorded attendance day — the manual path always wins", async () => {
      // 2027-02-13 is a Saturday. asUserCommit — import_jibble_time_entry()
      // below runs as a SEPARATE connection (db.seed()) and must see this
      // manual row; a plain asUser() call always rolls back (see harness.ts).
      await db.asUserCommit(USER_HR1, (query) =>
        query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          "2027-02-13",
          JSON.stringify([{ employee_id: EMPLOYEE_WORKER, status: "present", hours_worked: 3 }]),
        ]),
      );
      const { rows } = await importJibbleEntry(db, {
        entryId: "e-manual-protect-1",
        personId: "jp-worker",
        start: "2027-02-13T08:00:00Z",
        end: "2027-02-13T18:00:00Z",
      });
      expect(rows[0].needs_review).toBe(true);

      const attendance = await db.seed(`select hours_worked, source from attendance_records where employee_id = '${EMPLOYEE_WORKER}' and work_date = '2027-02-13'`);
      expect(attendance.rows).toEqual([{ hours_worked: "3.00", source: "manual" }]);
    });
  });

  describe("import_jibble_time_entry(): edits and idempotency across approval state", () => {
    it("an edit BEFORE approval refreshes the still-pending request's proposed_days", async () => {
      // 2027-02-20 is a Saturday.
      const first = await importJibbleEntry(db, { entryId: "e-edit-pending-1", personId: "jp-worker", start: "2027-02-20T08:00:00Z", end: "2027-02-20T11:00:00Z" });
      let request = await db.seed(`select proposed_days from recovery_credit_requests where id = '${first.rows[0].recovery_credit_request_id}'`);
      expect(request.rows).toEqual([{ proposed_days: "0.5" }]);

      // The same entry, corrected in Jibble to a longer shift.
      const edited = await importJibbleEntry(db, { entryId: "e-edit-pending-1", personId: "jp-worker", start: "2027-02-20T08:00:00Z", end: "2027-02-20T14:00:00Z" });
      expect(edited.rows[0].recovery_credit_request_id).toBe(first.rows[0].recovery_credit_request_id);
      request = await db.seed(`select proposed_days from recovery_credit_requests where id = '${first.rows[0].recovery_credit_request_id}'`);
      expect(request.rows).toEqual([{ proposed_days: "1.0" }]);
    });

    it("an edit AFTER approval is flagged for review and never touches the posted ledger/request", async () => {
      // 2027-02-27 is a Saturday.
      const first = await importJibbleEntry(db, { entryId: "e-edit-approved-1", personId: "jp-worker", start: "2027-02-27T08:00:00Z", end: "2027-02-27T11:00:00Z" });
      const requestId = first.rows[0].recovery_credit_request_id as string;
      // asUserCommit — a later, separate db.seed() read needs to see this
      // decision; a plain asUser() call always rolls back (see harness.ts).
      await db.asUserCommit(USER_HR1, (query) => query("select decide_recovery_credit_request($1, 'approved', 'Checked with the lead')", [requestId]));

      const before = await db.seed(`select status, proposed_days, comp_day_ledger_id from recovery_credit_requests where id = '${requestId}'`);
      expect(before.rows[0].status).toBe("approved");

      const edited = await importJibbleEntry(db, { entryId: "e-edit-approved-1", personId: "jp-worker", start: "2027-02-27T08:00:00Z", end: "2027-02-27T18:00:00Z" });
      expect(edited.rows[0].needs_review).toBe(true);
      expect(edited.rows[0].review_reason).toMatch(/edited after its recovery credit was already approved/);

      const after = await db.seed(`select status, proposed_days, comp_day_ledger_id from recovery_credit_requests where id = '${requestId}'`);
      expect(after.rows).toEqual(before.rows);

      const ledgerCount = await db.seed(
        `select count(*)::int as n from comp_day_ledger where reference_type = 'attendance_record' and reference_id = (select attendance_record_id from recovery_credit_requests where id = '${requestId}')`,
      );
      expect(ledgerCount.rows).toEqual([{ n: 1 }]);
    });
  });

  describe("single HR decision: shared queue, concurrency, self-approval, company isolation", () => {
    async function submitWeekendRequest(entryId: string, dateIso: string, personId = "jp-worker2", employeeId = EMPLOYEE_WORKER2) {
      const { rows } = await importJibbleEntry(db, { entryId, personId, start: `${dateIso}T08:00:00Z`, end: `${dateIso}T13:00:00Z` });
      return rows[0].recovery_credit_request_id as string;
    }

    it("both HR Admins can see the same pending queue item", async () => {
      const requestId = await submitWeekendRequest("e-queue-visible-1", "2027-03-06");
      for (const hr of [USER_HR1, USER_HR2]) {
        const { rows } = await db.asUser(hr, (query) =>
          query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and decision = 'pending'", [requestId]),
        );
        expect(rows).toHaveLength(1);
      }
    });

    it("only one of two HR Admins can decide it — the second gets 'already been decided'", async () => {
      const requestId = await submitWeekendRequest("e-queue-race-1", "2027-03-13");

      await db.asUserCommit(USER_HR1, (query) =>
        query("select decide_recovery_credit_request($1, 'approved', 'Checked with the lead')", [requestId]),
      );

      await expect(
        db.asUser(USER_HR2, (query) => query("select decide_recovery_credit_request($1, 'approved', 'Checked with the lead')", [requestId])),
      ).rejects.toThrow(/No pending approval found/);

      const request = await db.seed(`select status from recovery_credit_requests where id = '${requestId}'`);
      expect(request.rows).toEqual([{ status: "approved" }]);
    });

    it("an HR Admin cannot decide a recovery credit request from a DIFFERENT company", async () => {
      const requestId = await submitWeekendRequest("e-cross-company-1", "2027-03-20");
      await expect(
        db.asUser(USER_HR_OTHER_COMPANY, (query) =>
          query("select decide_recovery_credit_request($1, 'approved', 'Checked with someone')", [requestId]),
        ),
      ).rejects.toThrow(/Only an active hr_admin/);
    });

    it("an HR Admin from a different company cannot even SEE the request via the approvals table", async () => {
      const requestId = await submitWeekendRequest("e-cross-company-2", "2027-03-27");
      const { rows } = await db.asUser(USER_HR_OTHER_COMPANY, (query) =>
        query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1", [requestId]),
      );
      expect(rows).toEqual([]);
    });

    it("naming a project lead in 'checked_with' text grants them no access — it's just a string, not a role", async () => {
      const requestId = await submitWeekendRequest("e-project-lead-1", "2027-04-03");
      // USER_MANAGER plays the "project lead" here: not hr_admin, no
      // special-cased access despite being the person HR would check with.
      await expect(
        db.asUser(USER_MANAGER, (query) =>
          query("select decide_recovery_credit_request($1, 'approved', 'Wale (project lead) confirmed this')", [requestId]),
        ),
      ).rejects.toThrow(/Only an active hr_admin/);
    });
  });

  describe("HR corrections (adjust_recovery_credit_request)", () => {
    async function submitWeekendRequest(entryId: string, dateIso: string) {
      const { rows } = await importJibbleEntry(db, { entryId, personId: "jp-worker", start: `${dateIso}T08:00:00Z`, end: `${dateIso}T13:00:00Z` });
      return rows[0].recovery_credit_request_id as string;
    }

    it("requires a reason when the work date or hours actually change", async () => {
      const requestId = await submitWeekendRequest("e-adjust-reason-1", "2027-04-10");
      await expect(
        db.asUser(USER_HR1, (query) =>
          query("select adjust_recovery_credit_request($1, $2, $3, null, null)", [requestId, "2027-04-11", 8]),
        ),
      ).rejects.toThrow(/A reason is required/);
    });

    it("does NOT require a reason when nothing actually changes (e.g. only recording checked_with)", async () => {
      // submitWeekendRequest's 08:00-13:00 window is 5h -> 1.0 day already.
      const requestId = await submitWeekendRequest("e-adjust-nochange-1", "2027-04-17");
      const before = await db.seed(`select work_date::text, proposed_days from recovery_credit_requests where id = '${requestId}'`);
      await db.asUserCommit(USER_HR1, (query) =>
        query("select adjust_recovery_credit_request($1, $2, $3, null, $4)", [requestId, "2027-04-17", 5, "Confirmed with the lead"]),
      );
      const after = await db.seed(`select work_date::text, proposed_days, checked_with, correction_reason, corrected_at from recovery_credit_requests where id = '${requestId}'`);
      expect(after.rows[0].work_date).toEqual(before.rows[0].work_date);
      expect(after.rows[0].proposed_days).toEqual(before.rows[0].proposed_days);
      expect(after.rows[0].checked_with).toBe("Confirmed with the lead");
      expect(after.rows[0].correction_reason).toBeNull();
      expect(after.rows[0].corrected_at).toBeNull();
    });

    it("recomputes proposed_days server-side from the corrected hours via the same threshold every path uses", async () => {
      const requestId = await submitWeekendRequest("e-adjust-recompute-1", "2027-04-24");
      const before = await db.seed(`select proposed_days from recovery_credit_requests where id = '${requestId}'`);
      expect(before.rows).toEqual([{ proposed_days: "1.0" }]);

      await db.asUserCommit(USER_HR1, (query) =>
        query("select adjust_recovery_credit_request($1, $2, $3, $4, null)", [requestId, "2027-04-24", 3, "Actually left early, HR over-recorded"]),
      );
      const after = await db.seed(`select proposed_days, correction_reason, corrected_by, corrected_at from recovery_credit_requests where id = '${requestId}'`);
      expect(after.rows[0].proposed_days).toBe("0.5");
      expect(after.rows[0].correction_reason).toBe("Actually left early, HR over-recorded");
      expect(after.rows[0].corrected_by).toBe(USER_HR1);
      expect(after.rows[0].corrected_at).toBeTruthy();
    });

    it("never overwrites the ORIGINAL Jibble evidence — attendance_records/jibble_time_entries keep the imported values forever", async () => {
      const requestId = await submitWeekendRequest("e-adjust-evidence-1", "2027-05-01");
      const record = await db.seed(`select attendance_record_id from recovery_credit_requests where id = '${requestId}'`);
      const recordId = record.rows[0].attendance_record_id;

      await db.asUserCommit(USER_HR1, (query) =>
        query("select adjust_recovery_credit_request($1, $2, $3, $4, null)", [requestId, "2027-05-02", 1, "HR mis-keyed the original date"]),
      );

      const original = await db.seed(`select work_date::text, hours_worked, source from attendance_records where id = '${recordId}'`);
      expect(original.rows).toEqual([{ work_date: "2027-05-01", hours_worked: "5.00", source: "jibble" }]);

      const corrected = await db.seed(`select work_date::text, proposed_days from recovery_credit_requests where id = '${requestId}'`);
      expect(corrected.rows[0].work_date).toBe("2027-05-02");
      expect(corrected.rows[0].proposed_days).toBe("0.5");
    });

    it("is blocked once the request has already been decided", async () => {
      const requestId = await submitWeekendRequest("e-adjust-decided-1", "2027-05-08");
      await db.asUserCommit(USER_HR1, (query) => query("select decide_recovery_credit_request($1, 'approved', 'Checked with the lead')", [requestId]));

      await expect(
        db.asUser(USER_HR2, (query) =>
          query("select adjust_recovery_credit_request($1, $2, $3, $4, null)", [requestId, "2027-05-09", 8, "Too late"]),
        ),
      ).rejects.toThrow(/already been decided and can no longer be adjusted/);
    });

    it("blocks a non-HR-Admin from adjusting a recovery credit request", async () => {
      const requestId = await submitWeekendRequest("e-adjust-role-1", "2027-05-15");
      await expect(
        db.asUser(USER_MANAGER, (query) =>
          query("select adjust_recovery_credit_request($1, $2, $3, $4, null)", [requestId, "2027-05-16", 8, "Not your call"]),
        ),
      ).rejects.toThrow(/Only HR Admin may adjust/);
    });
  });

  // Covers the second-pass "fail closed" hardening: a client-side parse
  // ambiguity (apps/web/src/lib/jibble/client.ts's parseJibbleEntry(), not
  // reachable from SQL — simulated here via p_client_needs_review/
  // p_client_review_reason, exactly what the sync route passes through)
  // must never silently contribute to an hours calculation, and a day with
  // one ambiguous entry among several must still credit the clean ones
  // while visibly flagging the day as incomplete.
  describe("fail-closed parsing: ambiguous/missing data is excluded from hour totals, never guessed", () => {
    it("an entry the client flagged as ambiguous is excluded entirely — no credit, day flagged", async () => {
      const result = await importJibbleEntry(db, {
        entryId: "e-ambig-1",
        personId: "jp-worker",
        start: "2027-05-22T04:00:00Z", // Saturday 08:00 local (ZJ -> Asia/Dubai, UTC+4)
        end: "2027-05-22T09:00:00Z", // 13:00 local — 5h shift
        clientNeedsReview: true,
        clientReviewReason: "Breaks field is present but not an array or number.",
      });
      expect(result.rows[0].needs_review).toBe(true);
      expect(result.rows[0].review_category).toBe("ambiguous_parse");
      expect(result.rows[0].review_reason).toMatch(/Breaks field is present/);
      // Excluded from the day's totals entirely -> nothing to credit.
      expect(result.rows[0].recovery_credit_request_id).toBeNull();

      const request = await db.seed(`select count(*)::int as n from recovery_credit_requests r
        join attendance_records a on a.id = r.attendance_record_id
        where a.work_date = '2027-05-22' and a.employee_id = '${EMPLOYEE_WORKER}'`);
      expect(request.rows[0].n).toBe(0);
    });

    it("an ambiguous entry alongside a clean entry on the same day still credits the clean hours, but flags both", async () => {
      // Clean 3h session (<=4h -> 0.5 day) plus a second, ambiguous session
      // that must NOT contribute its own hours to the total.
      const clean = await importJibbleEntry(db, {
        entryId: "e-ambig-clean-1",
        personId: "jp-worker2",
        start: "2027-05-29T04:00:00Z", // Saturday 08:00 local
        end: "2027-05-29T07:00:00Z", // 11:00 local — 3h
      });
      const ambiguous = await importJibbleEntry(db, {
        entryId: "e-ambig-mixed-1",
        personId: "jp-worker2",
        start: "2027-05-29T10:00:00Z", // 14:00 local
        end: "2027-05-29T14:00:00Z", // 18:00 local — 4h, but flagged
        clientNeedsReview: true,
        clientReviewReason: "Multiple note-like fields disagree.",
      });

      // Both entries end up flagged: the ambiguous one for its own reason,
      // the clean one because the DAY it belongs to still has an excluded
      // sibling entry — informative, not an error on the clean entry
      // itself. `clean`'s own return value was captured BEFORE the
      // ambiguous sibling existed (it hadn't been imported yet), so its
      // needs_review update — applied retroactively by the ambiguous
      // entry's own sync run — is only visible on a fresh read, not on
      // that earlier return value.
      expect(ambiguous.rows[0].review_category).toBe("ambiguous_parse");
      const cleanRowId = clean.rows[0].jibble_row_id;
      const cleanNow = await db.seed(`select needs_review, review_category from jibble_time_entries where id = '${cleanRowId}'`);
      expect(cleanNow.rows[0].needs_review).toBe(true);
      expect(cleanNow.rows[0].review_category).toBe("ambiguous_entries_excluded");

      const request = await db.seed(`select r.proposed_days from recovery_credit_requests r
        join attendance_records a on a.id = r.attendance_record_id
        where a.work_date = '2027-05-29' and a.employee_id = '${EMPLOYEE_WORKER2}'`);
      // Only the clean 3h contributed -> <=4h threshold -> 0.5 day, not the
      // 7h combined total a naive sum would have produced.
      expect(request.rows).toEqual([{ proposed_days: "0.5" }]);
    });

    it("an entry with no recognizable start time is flagged missing_start and never reaches attendance", async () => {
      const result = await importJibbleEntry(db, {
        entryId: "e-missing-start-1",
        personId: "jp-worker",
        start: null,
        end: "2027-06-05T09:00:00Z",
      });
      expect(result.rows[0].needs_review).toBe(true);
      expect(result.rows[0].review_category).toBe("missing_start");
      expect(result.rows[0].attendance_record_id).toBeNull();
      expect(result.rows[0].recovery_credit_request_id).toBeNull();
    });
  });

  describe("jibble_sync_checkpoints: operational sync status, HR-Admin-only, company-scoped", () => {
    it("only an HR Admin in the checkpoint's own company can read it", async () => {
      await db.seed(`select record_jibble_sync_checkpoint('${JIBBLE_COMPANY_ID}', '2027-06-01T00:00:00Z', 'ok', null)`);

      const own = await db.asUser(USER_HR1, (query) =>
        query("select last_run_status from jibble_sync_checkpoints where company_id = $1", [JIBBLE_COMPANY_ID]),
      );
      expect(own.rows).toEqual([{ last_run_status: "ok" }]);

      const otherCompany = await db.asUser(USER_HR_OTHER_COMPANY, (query) =>
        query("select last_run_status from jibble_sync_checkpoints where company_id = $1", [JIBBLE_COMPANY_ID]),
      );
      expect(otherCompany.rows).toEqual([]);

      const nonAdmin = await db.asUser(USER_MANAGER, (query) =>
        query("select last_run_status from jibble_sync_checkpoints where company_id = $1", [JIBBLE_COMPANY_ID]),
      );
      expect(nonAdmin.rows).toEqual([]);
    });

    it("rejects an invalid status", async () => {
      await expect(
        db.seed(`select record_jibble_sync_checkpoint('${JIBBLE_COMPANY_ID}', now(), 'bogus', null)`),
      ).rejects.toThrow(/Invalid sync status/);
    });

    it("upserts in place rather than creating a second row per company", async () => {
      await db.seed(`select record_jibble_sync_checkpoint('${JIBBLE_COMPANY_ID}', '2027-06-02T00:00:00Z', 'partial', 'one page failed')`);
      const rows = await db.seed(
        `select count(*)::int as n, max(last_run_status) as status from jibble_sync_checkpoints where company_id = '${JIBBLE_COMPANY_ID}'`,
      );
      expect(rows.rows[0]).toEqual({ n: 1, status: "partial" });
    });
  });
});
