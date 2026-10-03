import { test, expect } from "../../src/fixtures";
import { getCredentials, isMutationAuthorized } from "../../src/config";
import { getEmployeeNameByAuthEmail } from "../../src/identity";
import { tagNote } from "../../src/recordTag";
import { targetTimezone } from "../../src/overnightWindow";
import { AttendanceClockPage } from "../../src/pages/AttendanceClockPage";
import { AttendanceRegisterPage } from "../../src/pages/AttendanceRegisterPage";

/**
 * Recovery Leave windows redesign — the MUTATING end-to-end checks, against the SAME
 * dedicated E2E accounts every other spec in this suite uses. Runs ONLY under the dedicated
 * `preview-recovery-windows-mutating` project (zero retries), from
 * e2e-preview-recovery-windows.yml — never from the Production workflows.
 *
 * What this leaves behind (real, permanent, tagged with this run's id in every free-text
 * field it writes): one employee clock session (Office) and one HR-recorded session, plus
 * HR's correction of it, on the Employee test account. Every duration used is deliberately
 * SHORT (under 2 hours): that earns NOTHING under every band of the policy on any day type,
 * so this suite can never create a Recovery Leave credit, a pending approval, or a ledger
 * entry. It never approves or rejects anything.
 *
 * Never auto-rerun a failed mutating test: a half-completed run may already have written
 * the HR-recorded session; look at the register (HR "Recorded by HR" rows tagged with the
 * run id) before running again.
 */
test.describe("recovery windows: evidence to register @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — skipping mutating recovery-window tests.");

  test("an employee's clock-in and clock-out show on the HR register with the right clock status, and presence stays Present", async ({ employeePage, hrAdminPage, sysAdminPage }) => {
    const employeeName = await getEmployeeNameByAuthEmail(sysAdminPage, getCredentials("employee").email);
    const clock = new AttendanceClockPage(employeePage);
    await clock.goto();
    if (await clock.isClockedIn()) await clock.clockOut(); // clean starting state

    await clock.clockIn({ workMode: "office" });
    const register = new AttendanceRegisterPage(hrAdminPage);
    await register.goto();
    await register.expectClockStatus(employeeName, "Clocked in");
    await expect(await register.uniqueRowFor(employeeName)).toContainText("so far — still clocked in");

    await clock.clockOut();
    await register.goto();
    await register.expectClockStatus(employeeName, "Clocked out");
    const row = await register.uniqueRowFor(employeeName);
    await expect(row).toContainText("Present"); // attendance stays Present after clock-out
    await expect(row.getByText("Clocked in", { exact: true })).toHaveCount(0);
  });

  test("HR adds missing attendance (recorded by HR, with a reason), then corrects it — original and corrected evidence are both kept", async ({ hrAdminPage, sysAdminPage, runId }) => {
    const employeeName = await getEmployeeNameByAuthEmail(sysAdminPage, getCredentials("employee").email);
    const tz = targetTimezone();

    // A past local date well away from today's real activity: 5-60 days ago.
    const daysAgo = 5 + Math.floor(Math.random() * 56);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - daysAgo * 86_400_000));

    const register = new AttendanceRegisterPage(hrAdminPage);
    await register.goto({ date });
    const row = await register.uniqueRowFor(employeeName);
    const employeeId = await row.getAttribute("data-employee-id");
    await register.openEdit(employeeName);

    const detail = hrAdminPage.locator(`#detail-${employeeId}`);
    const addReason = tagNote(runId, "recovery-windows-add-missing", "employee forgot to clock in");
    await detail.getByLabel(/^Clock-in \(/).last().fill(`${date}T03:00`);
    await detail.getByLabel(/^Clock-out \(/).last().fill(`${date}T04:00`);
    await detail.getByLabel(/^Reason \(required\)/).fill(addReason);
    await detail.getByRole("button", { name: "Add attendance" }).click();
    await expect(hrAdminPage.getByText("Saved. The register will refresh.")).toBeVisible({ timeout: 15_000 });

    await register.goto({ date });
    const after = await register.uniqueRowFor(employeeName);
    await expect(after).toContainText("Recorded by HR");
    await expect(after.getByText("Clocked in", { exact: true })).toHaveCount(0); // never a fake live state
    await expect(after).toContainText("1h 00m");

    // Expand and open Edit: correct the end time (still under 2 hours — earns nothing anywhere).
    await after.getByRole("button", { name: new RegExp(employeeName) }).first().click();
    const expanded = hrAdminPage.locator(`#detail-${employeeId}`);
    if ((await expanded.getByText("Previous calculation").count()) > 0) {
      test.skip(true, "The window-based Recovery Leave policy is not active yet in this environment, so this session uses the previous calculation and cannot be corrected with the window tools. The add-missing-attendance step above still passed.");
    }
    await register.openEdit(employeeName);
    const correctReason = tagNote(runId, "recovery-windows-correct", "clock-out was half an hour later");
    const save = expanded.getByRole("button", { name: "Save correction" });
    await expect(save).toBeDisabled(); // a reason is required before a correction can be saved
    await expanded.getByLabel(/^Clock-out \(/).first().fill(`${date}T04:30`);
    await expanded.getByLabel(/^Reason \(required/).first().fill(correctReason);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(hrAdminPage.getByText("Saved. The register will refresh.").first()).toBeVisible({ timeout: 15_000 });

    await register.goto({ date });
    const corrected = await register.uniqueRowFor(employeeName);
    await expect(corrected).toContainText("1h 30m");
    await corrected.getByRole("button", { name: new RegExp(employeeName) }).first().click();
    const evidence = hrAdminPage.locator(`#detail-${employeeId}`);
    await expect(evidence).toContainText("Corrected by HR");
    await expect(evidence).toContainText(correctReason); // the reason, with the original and corrected times side by side
    await expect(evidence).toContainText("Added by HR");
  });
});
