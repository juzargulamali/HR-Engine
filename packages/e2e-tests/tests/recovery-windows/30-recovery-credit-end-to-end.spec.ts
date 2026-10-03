import { test, expect } from "../../src/fixtures";
import { getCredentials, hasCredentials, isMutationAuthorized } from "../../src/config";
import { getEmployeeNameByAuthEmail } from "../../src/identity";
import { tagNote } from "../../src/recordTag";
import { targetTimezone } from "../../src/overnightWindow";
import { AttendancePage } from "../../src/pages/AttendancePage";
import { AttendanceRegisterPage } from "../../src/pages/AttendanceRegisterPage";
import { LeavePage } from "../../src/pages/LeavePage";
import { RecoveryCreditApprovalsPage } from "../../src/pages/RecoveryCreditApprovalsPage";

/**
 * Recovery Leave windows — END-TO-END CREDIT PROOF. Unlike every other spec in this directory (which only check what
 * the screens SHOW), this one proves that recorded evidence turns into an approved, posted credit exactly once:
 *
 *   HR records evidence (browser) -> the window closes and the engine raises ONE request routed "Project lead -> HR"
 *   -> the lead approves, then HR approves (browser) -> the employee's own Comp-off balance rises by exactly the
 *   entitlement -> HR corrects the evidence upward (browser) -> ONLY the difference is requested, approved, and posted
 *   -> the balance ends at exactly the corrected entitlement, never the sum of both calculations.
 *
 * It uses a PAST local rest day (Saturday/Sunday in the UAE) on which the window-based policy is already in force and
 * the employee has no recorded sessions, so a short HR-recorded session earns half a day (2h..6h on a rest day) and a
 * corrected one over 6h earns a whole day. It leaves, on the dedicated Employee test account, one HR-recorded session
 * (tagged with this run's id in its project name and reasons) and a REAL +1.0 day Recovery Leave credit with its
 * approvals — it is permanent, so it needs its own explicit authorization (E2E_RECOVERY_CREDIT_AUTHORIZED=true) on top
 * of E2E_MUTATION_AUTHORIZED. Zero retries, like every mutating project: never re-run a failed run before looking at
 * what it already wrote (the register for the chosen date, and the approvals/leave pages).
 *
 * Run it only against a database where the window-based policy has been deliberately activated and at least one rest
 * day has passed since its effective date (the date picker below skips with a clear message otherwise), or against the
 * throwaway local stack (packages/e2e-tests/local-stack/README.md).
 */
test.describe("recovery credit end to end @mutating @credit", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true').");
  test.skip(
    process.env.E2E_RECOVERY_CREDIT_AUTHORIZED !== "true",
    "This spec creates a REAL, permanent Recovery Leave credit on the Employee test account. Set E2E_RECOVERY_CREDIT_AUTHORIZED=true to allow it.",
  );
  test.setTimeout(5 * 60 * 1000);

  function localDate(tz: string, daysAgo: number): { date: string; weekday: string } {
    const when = new Date(Date.now() - daysAgo * 86_400_000);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(when);
    return { date, weekday };
  }


  /**
   * A past local rest day (Sat/Sun) on which the window-based rules are in force AND the employee has nothing recorded,
   * skipping the first `skip` such days (so two tests in one run never share a day). Skips the test with the reason when
   * there is none in the last 28 days.
   */
  async function pickFreeRestDay(hrPage: import("@playwright/test").Page, employeeName: string, tz: string, skip: number): Promise<string> {
    const attendance = new AttendancePage(hrPage);
    const register = new AttendanceRegisterPage(hrPage);
    let seen = 0;
    for (let daysAgo = 1; daysAgo <= 28; daysAgo += 1) {
      const candidate = localDate(tz, daysAgo);
      if (candidate.weekday !== "Sat" && candidate.weekday !== "Sun") continue;
      await attendance.goto({ date: candidate.date });
      if ((await attendance.modelInForce()) !== "windowed") continue;
      await register.goto({ date: candidate.date });
      await register.expandRow(employeeName);
      const detail = register.detailFor(await register.employeeIdOf(employeeName));
      if ((await detail.getByText("No clock sessions recorded for this date.").count()) === 0) continue;
      if (seen === skip) return candidate.date;
      seen += 1;
    }
    test.skip(true, "No past rest day in the last 28 days is both covered by the window-based policy and free of recorded sessions for the Employee test account.");
    return "";
  }

  async function parseComp(leave: LeavePage): Promise<number> {
    await leave.gotoList();
    const text = await leave.getBalance("Comp-off");
    const n = text.match(/[\d.]+/)?.[0];
    expect(n, `Could not parse a "Comp-off" balance figure from: "${text}"`).toBeDefined();
    return Number(n);
  }

  test("evidence -> one request -> lead then HR approve -> +0.5 posted; correction -> only the +0.5 difference -> total 1.0", async ({ employeePage, managerPage, hrAdminPage, sysAdminPage, runId }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — required to resolve names via /admin/users.");
    const employeeName = await getEmployeeNameByAuthEmail(sysAdminPage, getCredentials("employee").email);
    const managerName = await getEmployeeNameByAuthEmail(sysAdminPage, getCredentials("manager").email);
    const tz = targetTimezone();
    const tag = tagNote(runId, "recovery-credit-e2e");

    // 1. Pick a past rest day where the window rules are in force and the employee has nothing recorded yet.
    const day = await pickFreeRestDay(hrAdminPage, employeeName, tz, 0);
    const register = new AttendanceRegisterPage(hrAdminPage);

    const leave = new LeavePage(employeePage);
    const before = await parseComp(leave);

    // 2. HR records 09:00-12:30 of site work (3h 30m on a rest day = 0.5 day) under the manager as project lead.
    await register.goto({ date: day });
    await register.addMissingAttendance(employeeName, {
      date: day,
      start: "09:00",
      end: "12:30",
      mode: "site_work",
      project: tag,
      leadName: managerName,
      reason: tagNote(runId, "recovery-credit-e2e-evidence", "employee forgot to clock this shift"),
    });
    await register.goto({ date: day });
    await expect(await register.uniqueRowFor(employeeName)).toContainText("3h 30m");

    // 3. The lead sees ONE request for it, with the exact evidence, and approves (step 1 of "Project lead -> HR").
    const leadApprovals = new RecoveryCreditApprovalsPage(managerPage);
    await leadApprovals.goto();
    await leadApprovals.expectPending(tag);
    expect(await leadApprovals.getRouteLabel(tag)).toBe("Project lead → HR");
    const leadRow = managerPage.getByRole("row", { name: new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(leadRow).toContainText("3h 30m 00s"); // recorded time to the second
    await expect(leadRow).toContainText(/0\.5 day/);
    await expect(leadRow).toContainText(day); // the window's starting local date
    await leadApprovals.approve(tag);
    await leadApprovals.expectNotPending(tag);
    expect(await parseComp(leave), "the credit must not post after only the lead's step").toBe(before);

    // 4. HR approves (final step) -> the credit posts once.
    const hrApprovals = new RecoveryCreditApprovalsPage(hrAdminPage);
    await hrApprovals.goto();
    await hrApprovals.expectPending(tag);
    await hrApprovals.approve(tag);
    await hrApprovals.expectNotPending(tag);
    expect(await parseComp(leave)).toBe(before + 0.5);

    // 5. HR corrects the clock-out to 15:30 (6h 30m on a rest day = 1 day). ONLY the +0.5 difference is requested.
    await register.goto({ date: day });
    await register.correctClockOut(employeeName, day, "15:30", tagNote(runId, "recovery-credit-e2e-correction", "clock-out was later"));
    await register.goto({ date: day });
    await expect(await register.uniqueRowFor(employeeName)).toContainText("6h 30m");

    await leadApprovals.goto();
    await leadApprovals.expectPending(tag);
    const topUpRow = managerPage.getByRole("row", { name: new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(topUpRow).toContainText(/only the difference is requested/i);
    await expect(topUpRow).toContainText(/0\.5 day/);
    await leadApprovals.approve(tag);
    await leadApprovals.expectNotPending(tag);
    expect(await parseComp(leave), "the top-up must not post after only the lead's step").toBe(before + 0.5);

    await hrApprovals.goto();
    await hrApprovals.expectPending(tag);
    await hrApprovals.approve(tag);
    await hrApprovals.expectNotPending(tag);
    expect(await parseComp(leave), "total must be the corrected entitlement (1.0), never the sum of both calculations (1.5)").toBe(before + 1);

    // 6. Nothing is left waiting, and re-opening the pages creates nothing new.
    await hrApprovals.goto();
    await hrApprovals.expectNotPending(tag);
    expect(await parseComp(leave)).toBe(before + 1);
  });

  test("HR verification gate: business-travel evidence cannot be approved by HR until HR records what was verified; then the credit posts once", async ({
    employeePage,
    managerPage,
    hrAdminPage,
    sysAdminPage,
    runId,
  }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — required to resolve names via /admin/users.");
    const employeeName = await getEmployeeNameByAuthEmail(sysAdminPage, getCredentials("employee").email);
    const managerName = await getEmployeeNameByAuthEmail(sysAdminPage, getCredentials("manager").email);
    const tz = targetTimezone();
    const tag = tagNote(runId, "recovery-credit-e2e-verification");
    const day = await pickFreeRestDay(hrAdminPage, employeeName, tz, 0); // the first free day: the previous test has used its own by now

    const leave = new LeavePage(employeePage);
    const before = await parseComp(leave);
    const register = new AttendanceRegisterPage(hrAdminPage);
    await register.goto({ date: day });
    await register.addMissingAttendance(employeeName, {
      date: day,
      start: "10:00",
      end: "13:30",
      mode: "business_travel",
      project: tag,
      leadName: managerName,
      reason: tagNote(runId, "recovery-credit-e2e-verification-evidence", "business travel recorded by HR"),
    });

    // The lead's own step is a provisional release, not the final approval, so it is not blocked.
    const leadApprovals = new RecoveryCreditApprovalsPage(managerPage);
    await leadApprovals.goto();
    await leadApprovals.expectPending(tag);
    await leadApprovals.approve(tag);
    await leadApprovals.expectNotPending(tag);

    // HR's final step IS blocked: Approve is disabled, the reason is on screen, and nothing posts.
    const hrApprovals = new RecoveryCreditApprovalsPage(hrAdminPage);
    await hrApprovals.goto();
    await hrApprovals.expectPending(tag);
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hrRow = hrAdminPage.getByRole("row", { name: new RegExp(escaped) });
    await expect(hrRow).toContainText(/Business travel/i);
    await expect(hrRow.getByRole("note")).toContainText(/HR must verify this window before it can be approved/);
    await expect(hrRow.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    expect(await parseComp(leave)).toBe(before);

    // HR records what was verified (required) -> Approve becomes available -> the credit posts once.
    await hrRow.getByLabel("Verification note").fill(tagNote(runId, "recovery-credit-e2e-verified", "confirmed the trip was working time with the project lead"));
    await hrRow.getByRole("button", { name: "Mark window as verified" }).click();
    await expect(hrRow).toContainText(/HR verified this window/, { timeout: 15_000 });
    await expect(hrRow.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
    await hrApprovals.approve(tag);
    await hrApprovals.expectNotPending(tag);
    expect(await parseComp(leave)).toBe(before + 0.5);
  });
});
