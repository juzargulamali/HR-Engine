import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Working-period / 24-elapsed-hour recovery windows — the database engine
// (recovery_derive / recovery_recalculate_employee / recovery_process_due),
// against a real Postgres with every migration applied.
//
// Time is controlled, never waited for: recovery_now() (the ONE clock the
// engine reads — exactly now() in Production) is replaced in THIS throwaway
// test database by a fixed instant, and every evidence row is seeded with
// explicit timestamps. Nothing here can touch a Production clock.
//
// Local-time anchors (2027): AE = Asia/Dubai (UTC+4, Mon-Fri working week),
// SA = Asia/Riyadh (UTC+3, Sun-Thu), PL = Europe/Warsaw (UTC+1, UTC+2 in
// summer). 2027-01-05 is a Tuesday; 2027-01-09 a Saturday.

import { COMPANY_AE, COMPANY_PL, COMPANY_SA, H, SYSTEM_ACTOR, createRecoveryFixtures, plusSeconds } from "../src/recoveryFixtures";

describe("Recovery Leave windows — database engine", () => {
  const db = new RlsTestDatabase();
  const { setClock, newPerson, seedSessions, recalc, windows, requests, alerts, singleShift, setupDatabase } = createRecoveryFixtures(db);

  beforeAll(async () => {
    await db.setup();
    await setupDatabase();
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  // ---------------------------------------------------------------------
  // Group 1 — normal-day bands, exact at the second
  // ---------------------------------------------------------------------
  describe("normal working day bands (AE, Tuesday 2027-01-05)", () => {
    const start = "2027-01-05T05:00:00Z"; // 09:00 Dubai
    const cases: Array<[string, number, number]> = [
      ["9h (the normal requirement, no deduction)", 9 * H, 0],
      ["exactly 13h 0m 0s", 13 * H, 0],
      ["13h 0m 1s", 13 * H + 1, 0.5],
      ["exactly 17h 0m 0s", 17 * H, 0.5],
      ["17h 0m 1s", 17 * H + 1, 1],
    ];
    it.each(cases)("%s -> %f day", async (_label, seconds, expected) => {
      const { ws, rs } = await singleShift("AE", start, seconds);
      expect(ws).toHaveLength(1);
      expect(ws[0]!.classification).toBe("normal_day");
      expect(ws[0]!.days).toBe(expected);
      expect(ws[0]!.status).toBe("closed");
      // 24h boundary comes before the 8h rest completes only for shifts over 16h.
      expect(ws[0]!.closed_reason).toBe(seconds > 16 * H ? "elapsed_window" : "rest");
      if (expected === 0) {
        expect(rs).toHaveLength(0); // no request for a window that earns nothing
      } else {
        expect(rs).toHaveLength(1);
        expect(rs[0]!.days).toBe(expected);
        expect(rs[0]!.event_type).toBe("window");
        expect(rs[0]!.created_by).toBe(SYSTEM_ACTOR); // the engine acts as itself, never as an HR user
      }
    });
  });

  describe("weekly rest day and public holiday bands (AE, Saturday 2027-01-09)", () => {
    const start = "2027-01-09T05:00:00Z";
    const cases: Array<[string, number, number]> = [
      ["1h 59m 59s", 2 * H - 1, 0],
      ["exactly 2h 0m 0s", 2 * H, 0.5],
      ["exactly 6h 0m 0s", 6 * H, 0.5],
      ["6h 0m 1s", 6 * H + 1, 1],
      ["12h (never more than one day)", 12 * H, 1],
    ];
    it.each(cases)("%s -> %f day", async (_label, seconds, expected) => {
      const { ws, rs } = await singleShift("AE", start, seconds);
      expect(ws[0]!.classification).toBe("rest_day");
      expect(ws[0]!.days).toBe(expected);
      expect(rs.length).toBe(expected === 0 ? 0 : 1);
    });

    it("a weekday public holiday uses the rest-day bands", async () => {
      const { ws } = await singleShift("AE", "2027-03-02T05:00:00Z", 3 * H);
      expect(ws[0]!.classification).toBe("public_holiday");
      expect(ws[0]!.days).toBe(0.5);
    });

    it("a public holiday that falls on a weekend is counted once, as one classification and one request", async () => {
      const { ws, rs } = await singleShift("AE", "2027-02-06T05:00:00Z", 7 * H);
      expect(ws).toHaveLength(1);
      expect(ws[0]!.classification).toBe("public_holiday");
      expect(ws[0]!.days).toBe(1);
      expect(rs).toHaveLength(1);
      expect(rs[0]!.days).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // Group 2 — every work mode qualifies; business travel is reviewed
  // ---------------------------------------------------------------------
  describe("work modes", () => {
    it.each(["office", "wfh", "client_meeting"])("%s on a rest day earns exactly like any other mode", async (mode) => {
      const { ws } = await singleShift("AE", "2027-01-09T05:00:00Z", 3 * H, { mode });
      expect(ws[0]!.days).toBe(0.5);
      expect(ws[0]!.review_flags).not.toContain("business_travel");
    });

    it("site work / installation earns too (no site-only or midnight restriction any more)", async () => {
      const { ws } = await singleShift("AE", "2027-01-09T05:00:00Z", 3 * H, { mode: "site_work", project: "Tower A" });
      expect(ws[0]!.days).toBe(0.5);
    });

    it("business travel is recorded and flagged for explicit HR verification, with the same hours", async () => {
      const { ws, rs } = await singleShift("AE", "2027-01-09T05:00:00Z", 3 * H, { mode: "business_travel" });
      expect(ws[0]!.days).toBe(0.5);
      expect(ws[0]!.review_flags).toContain("business_travel");
      expect(ws[0]!.hr_verification_required).toBe(true);
      expect(rs[0]!.needs_policy_review).toBe(true);
    });

    it("several modes inside one window add up in one window and keep every allocation", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const lead = (await newPerson(COMPANY_AE, "AE")).employeeId;
      await setClock("2027-01-10T00:00:00Z");
      await seedSessions(person, [
        { start: "2027-01-09T05:00:00Z", end: "2027-01-09T07:00:00Z", mode: "office" },
        { start: "2027-01-09T07:00:00Z", end: "2027-01-09T09:00:00Z", mode: "wfh" },
        { start: "2027-01-09T09:00:00Z", end: "2027-01-09T10:30:00Z", mode: "site_work", project: "Site 7", lead },
      ]);
      await recalc(person);
      const ws = await windows(person);
      expect(ws).toHaveLength(1);
      expect(ws[0]!.secs).toBe(5.5 * H);
      const { rows } = await db.seed(`select work_mode, seconds::float8 as s from recovery_window_allocations where window_id = '${ws[0]!.id}' order by alloc_start`);
      expect(rows.map((r) => r.work_mode)).toEqual(["office", "wfh", "site_work"]);
      expect(rows.reduce((a, r) => a + r.s, 0)).toBe(5.5 * H);
    });
  });

  // ---------------------------------------------------------------------
  // Group 3-5 — flexible starts, working periods and the 8 h rest gap
  // ---------------------------------------------------------------------
  describe("working periods", () => {
    it("a flexible start time anchors the window to the real first clock-in", async () => {
      const { ws } = await singleShift("AE", "2027-01-05T00:20:17Z", 10 * H);
      expect(ws[0]!.window_start.toISOString()).toBe("2027-01-05T00:20:17.000Z");
      expect(ws[0]!.window_end.toISOString()).toBe("2027-01-06T00:20:17.000Z");
    });

    it("14h + 2h off + 4h = 18h recorded in ONE window = 1 day, with no 20h alert", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const lead = (await newPerson(COMPANY_AE, "AE")).employeeId;
      await setClock("2027-01-07T00:00:00Z");
      await seedSessions(person, [
        { start: "2027-01-05T05:00:00Z", end: "2027-01-05T19:00:00Z", lead },
        { start: "2027-01-05T21:00:00Z", end: "2027-01-06T01:00:00Z", lead },
      ]);
      await recalc(person);
      const ws = await windows(person);
      expect(ws).toHaveLength(1);
      expect(ws[0]!.secs).toBe(18 * H);
      expect(ws[0]!.days).toBe(1);
      expect(await alerts(person)).toHaveLength(0);
      expect((await requests(person))).toHaveLength(1);
    });

    it("a 7h 59m 59s clocked-out gap keeps one period; exactly 8h starts a fresh one", async () => {
      const lead = (await newPerson(COMPANY_AE, "AE")).employeeId;
      const a = await newPerson(COMPANY_AE, "AE");
      await setClock("2027-01-08T00:00:00Z");
      await seedSessions(a, [
        { start: "2027-01-05T05:00:00Z", end: "2027-01-05T09:00:00Z", lead },
        { start: plusSeconds("2027-01-05T09:00:00Z", 8 * H - 1), end: plusSeconds("2027-01-05T09:00:00Z", 12 * H - 1), lead },
      ]);
      await recalc(a);
      expect((await db.seed(`select count(*)::int as n from recovery_periods where employee_id = '${a.employeeId}'`)).rows[0].n).toBe(1);
      expect((await windows(a))[0]!.secs).toBe(8 * H);

      const b = await newPerson(COMPANY_AE, "AE");
      await seedSessions(b, [
        { start: "2027-01-05T05:00:00Z", end: "2027-01-05T09:00:00Z", lead },
        { start: plusSeconds("2027-01-05T09:00:00Z", 8 * H), end: plusSeconds("2027-01-05T09:00:00Z", 12 * H), lead },
      ]);
      await recalc(b);
      expect((await db.seed(`select count(*)::int as n from recovery_periods where employee_id = '${b.employeeId}'`)).rows[0].n).toBe(2);
    });

    it("a mode switch inside one session does not start a new period", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      await setClock("2027-01-08T00:00:00Z");
      const sessionId = randomUUID();
      await db.seed(`
        begin;
        select set_config('recovery.defer', 'on', true);
        insert into attendance_sessions (id, employee_id, clock_in_at, clock_out_at, status) values ('${sessionId}', '${person.employeeId}', '2027-01-05T05:00:00Z', '2027-01-05T15:00:00Z', 'closed');
        insert into attendance_segments (session_id, employee_id, work_mode, segment_start, segment_end) values
          ('${sessionId}', '${person.employeeId}', 'office', '2027-01-05T05:00:00Z', '2027-01-05T09:00:00Z'),
          ('${sessionId}', '${person.employeeId}', 'wfh', '2027-01-05T09:00:00Z', '2027-01-05T15:00:00Z');
        select set_config('recovery.defer', 'off', true);
        commit;`);
      await recalc(person);
      const ws = await windows(person);
      expect(ws).toHaveLength(1);
      expect(ws[0]!.secs).toBe(10 * H);
    });
  });

  // ---------------------------------------------------------------------
  // Group 6 — the 20-hour alert
  // ---------------------------------------------------------------------
  describe("20-hour HR alert", () => {
    it("is raised once when accumulated recorded work reaches 20h with no rest, at the right instant, and never twice", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const lead = (await newPerson(COMPANY_AE, "AE")).employeeId;
      await setClock("2027-01-06T20:00:00Z");
      await seedSessions(person, [
        { start: "2027-01-05T05:00:00Z", end: "2027-01-05T15:00:00Z", lead },
        { start: "2027-01-05T17:00:00Z", end: null, lead }, // still open
      ]);
      await recalc(person);
      const a = await alerts(person, "long_work");
      expect(a).toHaveLength(1);
      // 10h worked by 15:00; 10 more hours from 17:00 -> reaches 20h at 03:00 next day.
      expect(a[0]!.triggered_at.toISOString()).toBe("2027-01-06T03:00:00.000Z");
      await recalc(person);
      await recalc(person, "2027-01-06T21:00:00Z");
      expect(await alerts(person, "long_work")).toHaveLength(1);
    });

    it("19h 59m 59s does not trigger it", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      await setClock("2027-01-07T00:00:00Z");
      await seedSessions(person, [{ start: "2027-01-05T05:00:00Z", end: plusSeconds("2027-01-05T05:00:00Z", 20 * H - 1) }]);
      await recalc(person);
      expect(await alerts(person, "long_work")).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // Group 7-8 — 24 elapsed-hour windows, rollovers, catch-up, reconciliation
  // ---------------------------------------------------------------------
  describe("24 elapsed-hour windows", () => {
    it("an open session rolls over automatically with no clock-out: windows split mathematically, nothing fabricated", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const lead = (await newPerson(COMPANY_AE, "AE")).employeeId;
      const start = "2027-01-05T05:00:00Z";
      await setClock(plusSeconds(start, 26 * H));
      await seedSessions(person, [{ start, end: null, lead }]);
      await recalc(person);
      let ws = await windows(person);
      expect(ws.map((w) => [w.secs, w.status])).toEqual([[24 * H, "closed"], [2 * H, "open"]]);
      expect(ws[0]!.closed_reason).toBe("elapsed_window");
      expect(ws[0]!.days).toBe(1);
      expect((await requests(person)).map((r) => r.days)).toEqual([1]); // only the CLOSED window earns a request
      expect((await alerts(person, "window_rollover")).map((a) => a.elapsed)).toEqual([24 * H]);
      // the raw evidence is untouched: still ONE open session and ONE open segment
      const raw = await db.seed(`select count(*)::int as n, count(*) filter (where segment_end is null)::int as open from attendance_segments where employee_id = '${person.employeeId}'`);
      expect(raw.rows[0]).toEqual({ n: 1, open: 1 });

      // 49 hours in: second window closes too, a third is open; two rollovers recorded exactly once each
      await recalc(person, plusSeconds(start, 49 * H));
      ws = await windows(person);
      expect(ws.map((w) => [w.secs, w.status])).toEqual([[24 * H, "closed"], [24 * H, "closed"], [1 * H, "open"]]);
      expect((await alerts(person, "window_rollover")).map((a) => a.elapsed)).toEqual([24 * H, 48 * H]);
      await recalc(person, plusSeconds(start, 49 * H));
      expect((await alerts(person, "window_rollover"))).toHaveLength(2);
    });

    it("a delayed processor derives every missed boundary in one catch-up run", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const lead = (await newPerson(COMPANY_AE, "AE")).employeeId;
      const start = "2027-01-05T05:00:00Z";
      await setClock(plusSeconds(start, 1 * H));
      await seedSessions(person, [{ start, end: null, lead }]);
      await recalc(person);
      expect(await windows(person)).toHaveLength(1);
      // nothing ran for 3+ days:
      await setClock(plusSeconds(start, 73 * H));
      const { rows } = await db.seed(`select recovery_process_due('test') as r`);
      expect(rows[0].r.status).toBe("succeeded");
      const ws = await windows(person);
      expect(ws.map((w) => w.status)).toEqual(["closed", "closed", "closed", "open"]);
      expect(ws.map((w) => w.secs)).toEqual([24 * H, 24 * H, 24 * H, 1 * H]);
      expect((await alerts(person, "window_rollover"))).toHaveLength(3);
      expect((await requests(person))).toHaveLength(3);
    });

    it("a boundary that falls inside a clocked-out gap puts each side in the right window", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const lead = (await newPerson(COMPANY_AE, "AE")).employeeId;
      const start = "2027-01-05T05:00:00Z";
      await setClock(plusSeconds(start, 60 * H));
      await seedSessions(person, [
        { start, end: plusSeconds(start, 23 * H), lead },
        { start: plusSeconds(start, 25 * H), end: plusSeconds(start, 30 * H), lead }, // 2h gap spans the 24h boundary
      ]);
      await recalc(person);
      const ws = await windows(person);
      expect(ws.map((w) => w.secs)).toEqual([23 * H, 5 * H]);
    });

    it("never manufactures windows after an actual rest", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const start = "2027-01-05T05:00:00Z";
      await setClock(plusSeconds(start, 200 * H));
      await seedSessions(person, [{ start, end: plusSeconds(start, 10 * H) }]);
      await recalc(person);
      expect(await windows(person)).toHaveLength(1);
      expect(await alerts(person, "window_rollover")).toHaveLength(0);
    });

    it("window seconds reconcile exactly with the raw segment seconds, including fractions", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const start = "2027-01-05T05:00:00.250Z";
      await setClock(plusSeconds(start, 90 * H));
      await seedSessions(person, [
        { start, end: plusSeconds(start, 7 * H + 0.5) },
        { start: plusSeconds(start, 9 * H), end: plusSeconds(start, 19 * H + 0.75) },
        { start: plusSeconds(start, 22 * H), end: plusSeconds(start, 30 * H) },
      ]);
      await recalc(person);
      const { rows } = await db.seed(`
        select (select sum(extract(epoch from (segment_end - segment_start))) from attendance_segments where employee_id = '${person.employeeId}')::float8 as raw,
               (select sum(recorded_seconds) from recovery_windows where employee_id = '${person.employeeId}')::float8 as windowed,
               (select sum(seconds) from recovery_window_allocations where employee_id = '${person.employeeId}')::float8 as allocated`);
      expect(rows[0].windowed).toBeCloseTo(rows[0].raw, 6);
      expect(rows[0].allocated).toBeCloseTo(rows[0].raw, 6);
    });
  });

  // ---------------------------------------------------------------------
  // Group 9 — regional classification and DST
  // ---------------------------------------------------------------------
  describe("regional classification", () => {
    it("Friday is an ordinary working day in AE but a rest day in SA (same instant, two countries)", async () => {
      const friday = "2027-01-08T05:30:00Z"; // Fri 09:30 Dubai / 08:30 Riyadh / 06:30 Warsaw
      const ae = await singleShift("AE", friday, 14 * H);
      const sa = await singleShift("SA", friday, 14 * H);
      expect(ae.ws[0]!.classification).toBe("normal_day");
      expect(ae.ws[0]!.days).toBe(0.5); // > 13h on a normal day
      expect(sa.ws[0]!.classification).toBe("rest_day");
      expect(sa.ws[0]!.days).toBe(1); // > 6h on a rest day
    });

    it("Sunday is a rest day in AE and PL but an ordinary working day in SA", async () => {
      const sunday = "2027-01-10T06:00:00Z";
      expect((await singleShift("AE", sunday, 3 * H)).ws[0]!.classification).toBe("rest_day");
      expect((await singleShift("PL", sunday, 3 * H)).ws[0]!.classification).toBe("rest_day");
      expect((await singleShift("SA", sunday, 3 * H)).ws[0]!.classification).toBe("normal_day");
    });

    it("a KSA shift that starts Thursday evening and runs across Friday is classified by its START date only", async () => {
      // Thu 2027-01-07 20:00 Riyadh = 17:00Z, 18h long -> ends Friday 14:00 Riyadh.
      const { ws } = await singleShift("SA", "2027-01-07T17:00:00Z", 18 * H);
      expect(ws).toHaveLength(1);
      expect(ws[0]!.local_date).toBe("2027-01-07");
      expect(ws[0]!.classification).toBe("normal_day");
      expect(ws[0]!.days).toBe(1); // 18h > 17h on a normal day
    });

    it("the starting local date follows the EMPLOYEE'S country, not the viewer's: 21:30Z is already Saturday in UAE, still Friday in Poland", async () => {
      const t = "2027-01-08T21:30:00Z";
      expect((await singleShift("AE", t, 3 * H)).ws[0]!.local_date).toBe("2027-01-09");
      expect((await singleShift("PL", t, 3 * H)).ws[0]!.local_date).toBe("2027-01-08");
    });

    it("a public holiday configured for one country does not apply to another", async () => {
      expect((await singleShift("SA", "2027-03-02T06:00:00Z", 3 * H)).ws[0]!.classification).toBe("public_holiday");
      expect((await singleShift("PL", "2027-03-02T06:00:00Z", 3 * H)).ws[0]!.classification).toBe("normal_day");
    });

    it("a Warsaw window across the spring-forward change is still 24 REAL elapsed hours", async () => {
      // 2027-03-28 01:00Z is the moment Warsaw jumps from UTC+1 to UTC+2.
      const start = "2027-03-27T12:00:00Z";
      const person = await newPerson(COMPANY_PL, "PL");
      await setClock(plusSeconds(start, 30 * H));
      await seedSessions(person, [{ start, end: null }]);
      await recalc(person);
      const ws = await windows(person);
      expect(ws[0]!.window_end.getTime() - ws[0]!.window_start.getTime()).toBe(24 * H * 1000);
      expect(ws[0]!.secs).toBe(24 * H);
      expect(ws[1]!.secs).toBe(6 * H);
      expect(ws[0]!.local_date).toBe("2027-03-27"); // Saturday in Warsaw -> rest day
      expect(ws[0]!.classification).toBe("rest_day");
      expect(ws[1]!.local_date).toBe("2027-03-28");
    });
  });
});
