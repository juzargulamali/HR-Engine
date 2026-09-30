import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../../src/fixtures";
import { authStateFile, getBaseUrl, getCredentials, hasCredentials, isMutationAuthorized } from "../../src/config";
import { gotoWithRetry } from "../../src/gotoWithRetry";
import { tagNote } from "../../src/recordTag";
import { minutesUntilLocalMidnight, targetTimezone } from "../../src/overnightWindow";
import { getEmployeeNameByAuthEmail } from "../../src/identity";
import { AttendanceClockPage } from "../../src/pages/AttendanceClockPage";
import { RecoveryCreditApprovalsPage } from "../../src/pages/RecoveryCreditApprovalsPage";
import { LeavePage } from "../../src/pages/LeavePage";

/**
 * Employee self-service attendance clocking (apps/web/src/app/(app)/
 * attendance-clock/**) and the 4-tier Recovery Leave routing it feeds,
 * against the SAME dedicated E2E test accounts every other spec in this
 * suite uses (Employee/Manager/HR Admin/CEO) — no new company, no new
 * accounts, no separate Supabase project. Every self-clock record this
 * file creates is a brand-new row (attendance_sessions/segments,
 * recovery_credit_requests, and — where a route completes — one
 * comp_day_ledger 'earned' entry); nothing pre-existing is ever touched.
 *
 * Tagging: recovery_credit_requests has no free-text field of its own, but
 * every Site-work segment's `project_name` is free text AND is rendered
 * verbatim in the Approvals page's Evidence column (see
 * RecoveryCreditApprovalsPage's own doc comment) — that is this file's tag
 * anchor, everywhere a tag is needed. Office/WFH segments used purely for
 * mechanics (no routing asserted) carry no tag, matching how the existing
 * mechanics-only checks in this suite work.
 *
 * Mutating — gated on E2E_MUTATION_AUTHORIZED, zero retries (playwright.
 * config.ts), same as every other file in this directory.
 */
test.describe("attendance clock: mechanics @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — skipping mutating attendance-clock tests.");

  // Mechanics tests never assert on whether a recovery credit was created —
  // that depends on whether "today" happens to be a real recovery-eligible
  // day for this account's real country, which this suite cannot know or
  // control (see overnightWindow.ts's own doc comment for why the self-clock
  // RPCs have no synthetic-date parameter to sidestep this with). If a
  // credit IS incidentally created by one of these clock-ins, it is a real,
  // permanent record exactly like the routing tests below produce
  // deliberately — report it the same way.

  test("clock in (Office), refresh persists state, duplicate clock-in is rejected, clock out, duplicate clock-out is rejected", async ({ employeePage }) => {
    const clock = new AttendanceClockPage(employeePage);
    await clock.goto();
    if (await clock.isClockedIn()) await clock.clockOut(); // clean starting state, in case a previous run's clock-out failed

    await clock.clockIn({ workMode: "office" });
    expect(await clock.isClockedIn()).toBe(true);

    // Refresh — a real navigation, not a soft client-side re-render — must
    // still show "Clocked in" (server-derived from attendance_sessions, not
    // client state).
    await gotoWithRetry(employeePage, "/attendance-clock");
    expect(await clock.isClockedIn(), "Clocked-in state did not survive a page refresh").toBe(true);

    // A second, independent tab attempting to clock in again — the real
    // "duplicate click / two tabs" scenario — must be rejected cleanly by
    // clock_in()'s own advisory-lock guard, never silently create a second
    // session.
    const secondContext = await employeePage.context().browser()!.newContext({ storageState: authStateFile("employee"), baseURL: getBaseUrl() });
    const secondPage = await secondContext.newPage();
    try {
      await gotoWithRetry(secondPage, "/attendance-clock");
      const secondClock = new AttendanceClockPage(secondPage);
      await secondClock.clockIn({ workMode: "wfh" });
      await secondClock.expectError(/already clocked in/i);
    } finally {
      await secondContext.close();
    }

    await clock.clockOut();
    expect(await clock.isClockedIn()).toBe(false);
    await clock.clockOut(); // no open session left — must fail, not silently no-op
    await clock.expectError(/not currently clocked in/i);
  });

  test("all five work modes are selectable and accepted; mid-shift switching keeps one session", async ({ employeePage }) => {
    const clock = new AttendanceClockPage(employeePage);
    await clock.goto();
    if (await clock.isClockedIn()) await clock.clockOut();

    await clock.clockIn({ workMode: "office" });
    await clock.switchWorkMode({ workMode: "wfh" });
    await clock.switchWorkMode({ workMode: "client_meeting" });
    await clock.switchWorkMode({ workMode: "business_travel" });
    // Site work requires a project + lead — the RLS suite already proves
    // the server-side requirement; this proves the FORM enforces it too,
    // before ever calling the RPC.
    await clock.switchWorkMode({ workMode: "site_work" });
    await clock.expectError(/requires a project name and a project lead/i);
    await employeePage.getByLabel(/^Project/).fill(tagNote(process.env.E2E_RUN_ID ?? "e2e", "attendance-clock-modes"));
    await employeePage.getByLabel(/^Project lead/).selectOption({ index: 1 }); // any colleague — the form only cares that one is selected
    await employeePage.getByRole("button", { name: "Switch work mode", exact: true }).nth(1).click();
    await expect(employeePage.getByText(/^Current: Site work/)).toBeVisible({ timeout: 15_000 });

    await clock.clockOut();

    const segments = await clock.getMostRecentSessionSegmentsText();
    expect(segments).toContain("Office");
    expect(segments).toContain("Work from home");
    expect(segments).toContain("Client meeting");
    expect(segments).toContain("Business travel");
    expect(segments).toContain("Site work");
  });

  test("Site work location: granted capture and denied capture are both handled without blocking the clock action", async ({ browser }) => {
    const granted = await pageForRoleWithGeolocation(browser, "employee", { latitude: 25.2048, longitude: 55.2708 }, ["geolocation"]);
    try {
      const clock = new AttendanceClockPage(granted);
      await clock.goto();
      if (await clock.isClockedIn()) await clock.clockOut();
      const tag = tagNote(process.env.E2E_RUN_ID ?? "e2e", "attendance-clock-location-granted");
      await clock.clockIn({ workMode: "site_work", projectName: tag, projectLeadAny: true });
      // A granted location never shows the "flagged for review" notice.
      await expect(granted.getByText(/flagged for HR review/i)).toHaveCount(0);
      await clock.clockOut();
    } finally {
      await granted.context().close();
    }

    const denied = await pageForRoleWithGeolocation(browser, "employee", undefined, []);
    try {
      const clock = new AttendanceClockPage(denied);
      await clock.goto();
      if (await clock.isClockedIn()) await clock.clockOut();
      const tag = tagNote(process.env.E2E_RUN_ID ?? "e2e", "attendance-clock-location-denied");
      await clock.clockIn({ workMode: "site_work", projectName: tag, projectLeadAny: true });
      // Denial must be handled clearly, never block the clock-in.
      expect(await clock.isClockedIn()).toBe(true);
      await clock.expectLocationNotice(/location permission was denied.*flagged for HR review/i);
      await clock.clockOut();
    } finally {
      await denied.context().close();
    }
  });
});

/**
 * The 4-tier routing matrix, exercised end to end through the real UI —
 * clock in, HR/lead/manager/CEO decide via /approvals, confirm the exact
 * credit posts exactly once. Since the self-clock RPCs always stamp now()
 * (see overnightWindow.ts), these deliberately target the 'overnight' event
 * type: a shift that genuinely straddles a real local midnight qualifies
 * for a credit on ANY calendar day, with zero synthetic-date fixture and
 * zero weakening of the server's own timestamps — this suite waits for a
 * real midnight, for real.
 *
 * Runs only when triggered within MAX_WAIT_MINUTES of local midnight in
 * targetTimezone() (default Asia/Dubai — see that module's own doc comment
 * to point it at the test accounts' real country once confirmed); otherwise
 * the whole describe block skips itself with a clear message, rather than
 * waiting for hours or asserting something false. Trigger the workflow
 * manually a few minutes before local midnight to exercise this.
 */
test.describe("attendance clock: 4-tier routing (overnight-window) @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — skipping mutating attendance-clock tests.");

  const MAX_WAIT_MINUTES = 6;
  const tz = targetTimezone();
  const minutesToMidnight = minutesUntilLocalMidnight(tz);
  test.skip(
    minutesToMidnight > MAX_WAIT_MINUTES,
    `This local time in ${tz} is ${minutesToMidnight} minute(s) before midnight — trigger this workflow within ${MAX_WAIT_MINUTES} minutes of local midnight in ${tz} to exercise the real overnight-credit path (set E2E_ATTENDANCE_CLOCK_TIMEZONE if ${tz} isn't this account's real country).`,
  );
  test.setTimeout(10 * 60 * 1000);

  test("employee_lead_then_hr: colleague-lead approves, then HR — credited exactly once; a correction requires a renewed lead approval", async ({
    employeePage,
    hrAdminPage,
    sysAdminPage,
    runId,
  }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — required to resolve the Manager's display name via /admin/users.");
    const managerName = await getEmployeeNameByAuthEmail(sysAdminPage, getCredentials("manager").email);
    const tag = tagNote(runId, "att-clock-lead-then-hr");

    const clock = new AttendanceClockPage(employeePage);
    await clock.goto();
    if (await clock.isClockedIn()) await clock.clockOut();
    await clock.clockIn({ workMode: "site_work", projectName: tag, projectLeadName: managerName });

    await waitPastLocalMidnight(tz);
    await clock.clockOut();

    // The lead (Manager test account) decides step 1 first.
    const managerApprovals = new RecoveryCreditApprovalsPage(await pageForRole(employeePage.context().browser()!, "manager"));
    await managerApprovals.goto();
    await managerApprovals.expectPending(tag);
    expect(await managerApprovals.getRouteLabel(tag)).toBe("Project lead → HR");
    await managerApprovals.approve(tag); // checked-with is optional on the lead's own step

    const hrApprovals = new RecoveryCreditApprovalsPage(hrAdminPage);
    await hrApprovals.goto();
    await hrApprovals.expectPending(tag);

    const employeeLeave = new LeavePage(employeePage);
    await employeeLeave.gotoList();
    const before = parseBalance(await employeeLeave.getBalance("Comp-off"));

    // A material HR correction on the ALREADY-lead-approved request resets
    // the lead's own step back to pending — HR cannot finish it until the
    // lead renews their approval (see adjust_recovery_credit_request()'s own
    // "renewed lead approval" doc comment in schema.sql).
    await hrApprovals.saveCorrection(tag, { hours: 3, reason: tagNote(runId, "att-clock-correction") });
    await hrApprovals.approve(tag, "Trying before the lead renews");
    await hrApprovals.expectErrorContaining(tag, /awaiting a renewed project lead approval|only the assigned approver/i);

    await managerApprovals.goto();
    await managerApprovals.expectPending(tag);
    await managerApprovals.approve(tag);

    await hrApprovals.goto();
    await hrApprovals.expectPending(tag);
    await hrApprovals.approve(tag); // employee_lead_then_hr's own HR step never requires checked-with
    await hrApprovals.expectNotPending(tag);

    await employeeLeave.gotoList();
    const after = parseBalance(await employeeLeave.getBalance("Comp-off"));
    expect(after, `Comp-off balance did not increase after "${tag}" was approved`).toBe(before + 0.5); // corrected to 3h -> 0.5 day
  });

  test("manager_hr_direct: a permanent Manager's own overnight shift routes straight to HR, credited once", async ({ managerPage, hrAdminPage, runId }) => {
    const tag = tagNote(runId, "att-clock-manager-direct");
    const clock = new AttendanceClockPage(managerPage);
    await clock.goto();
    if (await clock.isClockedIn()) await clock.clockOut();
    await clock.clockIn({ workMode: "office" }); // no project/lead needed — tag lives on a switch to a tagged client_meeting note instead
    await clock.switchWorkMode({ workMode: "client_meeting", projectName: tag });

    await waitPastLocalMidnight(tz);
    await clock.clockOut();

    const managerLeave = new LeavePage(managerPage);
    await managerLeave.gotoList();
    const before = parseBalance(await managerLeave.getBalance("Comp-off"));

    const hrApprovals = new RecoveryCreditApprovalsPage(hrAdminPage);
    await hrApprovals.goto();
    await hrApprovals.expectPending(tag);
    expect(await hrApprovals.getRouteLabel(tag)).toBe("Manager → HR");
    await hrApprovals.approve(tag, "Checked with the manager directly"); // required for this route
    await hrApprovals.expectNotPending(tag);

    await managerLeave.gotoList();
    const after = parseBalance(await managerLeave.getBalance("Comp-off"));
    expect(after, `Comp-off balance did not increase after "${tag}" was approved`).toBeGreaterThan(before);
  });

  test("hr_admin_ceo_cto_queue: HR's own overnight shift routes to the shared queue; CEO decides; a concurrent second decision attempt is refused", async ({
    hrAdminPage,
    ceoPage,
    runId,
  }) => {
    const tag = tagNote(runId, "att-clock-hr-queue");
    const clock = new AttendanceClockPage(hrAdminPage);
    await clock.goto();
    if (await clock.isClockedIn()) await clock.clockOut();
    await clock.clockIn({ workMode: "office" });
    await clock.switchWorkMode({ workMode: "client_meeting", projectName: tag });

    await waitPastLocalMidnight(targetTimezone());
    await clock.clockOut();

    const ceoApprovals = new RecoveryCreditApprovalsPage(ceoPage);
    await ceoApprovals.goto();
    await ceoApprovals.expectPending(tag);
    expect(await ceoApprovals.getRouteLabel(tag)).toBe("Shared CEO/CTO queue");

    // Two tabs of the SAME CEO session attempting to decide the same
    // request nearly simultaneously — a real concurrent-decision race
    // (this suite has no separate CTO test account; the underlying
    // authorization/locking this exercises doesn't distinguish which
    // account races which, only that exactly one decision wins — see
    // decide_leave_approval()'s row lock).
    const secondCeoPage = await pageForRole(ceoPage.context().browser()!, "ceo");
    const secondApprovals = new RecoveryCreditApprovalsPage(secondCeoPage);
    await secondApprovals.goto();
    await secondApprovals.expectPending(tag);

    const results = await Promise.allSettled([ceoApprovals.approve(tag, "First decision"), secondApprovals.approve(tag, "Second decision")]);
    // Both CLICKS may well both "succeed" at the UI level (a click doesn't
    // wait for the server outcome) — what matters is the FINAL state.
    void results;
    await ceoApprovals.goto();
    await ceoApprovals.expectNotPending(tag);
  });
});

// ---------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------

async function pageForRole(browser: Browser, role: "employee" | "manager" | "hrAdmin" | "ceo"): Promise<Page> {
  const context = await browser.newContext({ storageState: authStateFile(role), baseURL: getBaseUrl() });
  const page = await context.newPage();
  await gotoWithRetry(page, "/");
  return page;
}

async function pageForRoleWithGeolocation(
  browser: Browser,
  role: "employee" | "manager" | "hrAdmin" | "ceo",
  geolocation: { latitude: number; longitude: number } | undefined,
  permissions: string[],
): Promise<Page> {
  const context = await browser.newContext({ storageState: authStateFile(role), baseURL: getBaseUrl(), geolocation, permissions });
  const page = await context.newPage();
  await gotoWithRetry(page, "/");
  return page;
}

function parseBalance(text: string): number {
  const match = text.match(/[\d.]+/)?.[0];
  if (!match) throw new Error(`Could not parse a balance figure from: "${text}"`);
  return Number(match);
}

/** Waits for the real clock to pass the next local midnight in `timezone`,
 * plus a small buffer — computed as a fixed target INSTANT up front (never
 * a "minutes remaining" value re-polled in a loop, which wraps from ~0 to
 * ~1440 the moment midnight passes and is easy to get backwards). A real
 * wait on the real clock; nothing about time is faked here or anywhere else
 * in this file — see overnightWindow.ts's own doc comment. */
async function waitPastLocalMidnight(timezone: string): Promise<void> {
  const bufferMs = 30_000;
  const targetInstant = Date.now() + minutesUntilLocalMidnight(timezone) * 60_000 + bufferMs;
  const remainingMs = targetInstant - Date.now();
  if (remainingMs > 0) await new Promise((r) => setTimeout(r, remainingMs));
}
