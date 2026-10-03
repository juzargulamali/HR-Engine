import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { test, expect } from "../../src/fixtures";
import { gotoWithRetry } from "../../src/gotoWithRetry";
import { LoginPage } from "../../src/pages/LoginPage";

const require = createRequire(import.meta.url);
const { Client } = require("pg") as typeof import("pg");

/**
 * LOCAL STACK ONLY (packages/e2e-tests/local-stack/README.md). The controlled activation of a window-based Recovery Leave
 * policy, driven through the real screens of the real app against the throwaway local database:
 *   - activation is REFUSED until the 5-minute processor is verified running, and the screens say why;
 *   - the Alerts page shows the database fingerprint that the verification SQL also prints;
 *   - a CEO/CTO may only activate on the date an HR Admin already set on the draft;
 *   - the version in force ends the day before; disabling only ends the new version on a future date and deletes nothing.
 * It pokes the database directly (a stub for pg_cron, which the local Postgres does not have) — which is exactly why it can
 * never be pointed at a hosted environment: it refuses to run unless LOCAL_DB_URL is set AND the base URL is local.
 */
const LOCAL_DB_URL = process.env.LOCAL_DB_URL;
const PASSWORD = process.env.LOCAL_STACK_PASSWORD ?? "local-stack-password";

test.describe("policy activation, scheduler gate and fingerprint @local-stack", () => {
  test.skip(!LOCAL_DB_URL, "LOCAL_DB_URL is not set — this spec only runs against the throwaway local stack.");
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.E2E_BASE_URL ?? ""), "E2E_BASE_URL is not local — refusing to run.");
  test.describe.configure({ mode: "serial" });

  let db: InstanceType<typeof Client>;
  let polDraftId: string;
  const tomorrowPlus = (n: number) => {
    const d = new Date(Date.now() + (1 + n) * 86_400_000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  };

  test.beforeAll(async () => {
    db = new Client({ connectionString: LOCAL_DB_URL });
    await db.connect();
    const { rows } = await db.query("select id from policy_versions where country_code = 'PL' and policy_type = 'overtime_rules' and status = 'draft' and payload ->> 'model' = 'recovery_windows' limit 1");
    expect(rows, "the local seed must contain the Poland windows draft").toHaveLength(1);
    polDraftId = rows[0].id;
  });
  test.afterAll(async () => {
    await db?.end();
  });

  async function signedInPage(browser: import("@playwright/test").Browser, email: string): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    const login = new LoginPage(page);
    await login.goto();
    await login.signIn(email, PASSWORD);
    await login.expectSignedIn();
    return page;
  }

  test("before the scheduler is verified: the screens say so, and activation is refused by the database", async ({ hrAdminPage }) => {
    const { rows } = await db.query("select left(fingerprint::text, 8) as fp from recovery_deployment_info");
    await gotoWithRetry(hrAdminPage, "/alerts");
    const status = hrAdminPage.getByTestId("processor-status");
    await expect(status).toContainText(/5-minute processor: not verified/);
    await expect(status).toContainText(/only processed by the daily safety-net run until it is enabled|cannot be activated until it is/i); // the local seed already has the UAE windows policy active
    await expect(hrAdminPage.getByTestId("database-fingerprint")).toHaveText(rows[0].fp); // the same 8 characters the verification SQL prints

    await gotoWithRetry(hrAdminPage, `/policies/${polDraftId}`);
    await expect(hrAdminPage.getByTestId("scheduler-gate")).toContainText(/not verified, so activation will be refused/);
    await hrAdminPage.getByLabel(/^Effective from/).fill(tomorrowPlus(1));
    hrAdminPage.once("dialog", (d) => d.accept());
    await hrAdminPage.getByRole("button", { name: "Activate from this date" }).click();
    await expect(hrAdminPage.getByText(/5-minute Recovery Leave processor is not verified as running/)).toBeVisible({ timeout: 15_000 });
    const { rows: after } = await db.query("select status from policy_versions where id = $1", [polDraftId]);
    expect(after[0].status).toBe("draft"); // the refusal changed nothing
  });

  test("with the scheduler verified, HR sets the planned date; the CEO can activate only that date; the version in force ends the day before", async ({ browser, hrAdminPage }) => {
    // Stand in for pg_cron (not available in the local Postgres): the job row plus a successful run it started.
    await db.query(`
      create schema if not exists cron;
      create table if not exists cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean default true);
      insert into cron.job (jobname, schedule, command, active) select 'recovery-window-processor', '*/5 * * * *', 'select public.recovery_process_due(''pg_cron'')', true
        where not exists (select 1 from cron.job where jobname = 'recovery-window-processor');
      insert into recovery_processor_runs (origin, as_of, started_at, finished_at, status, employees_examined, employees_failed)
        values ('pg_cron', now(), now(), now(), 'succeeded', 0, 0);`);

    const planned = tomorrowPlus(2);
    await gotoWithRetry(hrAdminPage, `/policies/${polDraftId}`);
    await expect(hrAdminPage.getByTestId("scheduler-gate")).toContainText(/verified running — activation is allowed/);
    await hrAdminPage.getByLabel(/^Effective from/).fill(planned);
    await hrAdminPage.getByRole("button", { name: "Save as the draft's planned date" }).click();
    await expect(hrAdminPage.getByText("Planned date saved on the draft.")).toBeVisible({ timeout: 15_000 });

    const ceo = await signedInPage(browser, "pol.exec@e2e.local");
    await gotoWithRetry(ceo, `/policies/${polDraftId}`);
    await expect(ceo.getByText(`Effective date set by HR on this draft: ${planned}`)).toBeVisible();
    await expect(ceo.getByLabel(/^Effective from/)).toHaveCount(0); // the CEO cannot choose or change the date
    ceo.once("dialog", (d) => d.accept());
    await ceo.getByRole("button", { name: `Activate on ${planned}` }).click();
    await expect(ceo.getByText("active", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await ceo.context().close();

    const { rows } = await db.query(
      `select version_no, status, effective_from::text as f, effective_to::text as t, activation_record ->> 'activated_by' as by from policy_versions
       where country_code = 'PL' and policy_type = 'overtime_rules' order by version_no`,
    );
    const dayBefore = new Date(`${planned}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    expect(rows[0]).toMatchObject({ version_no: 2, status: "active", t: dayBefore.toISOString().slice(0, 10) });
    expect(rows[1]).toMatchObject({ version_no: 3, status: "active", f: planned, t: null, by: "00000000-0000-4000-8000-0000000000a8" });
  });

  test("disabling ends the new version on a future date and deletes nothing; the alerts page keeps showing what the processor still has to finish", async ({ hrAdminPage }) => {
    const before = (await db.query("select (select count(*) from attendance_sessions)::int as s, (select count(*) from recovery_windows)::int as w")).rows[0];
    await gotoWithRetry(hrAdminPage, `/policies/${polDraftId}`);
    const last = tomorrowPlus(5);
    await hrAdminPage.getByLabel(/^Last day the window rules apply/).fill(last);
    hrAdminPage.once("dialog", (d) => d.accept());
    await hrAdminPage.getByRole("button", { name: "Stop after this date" }).click();
    await expect.poll(async () => (await db.query("select effective_to::text as t from policy_versions where id = $1", [polDraftId])).rows[0].t, { timeout: 15_000 }).toBe(last);
    const after = (await db.query("select (select count(*) from attendance_sessions)::int as s, (select count(*) from recovery_windows)::int as w")).rows[0];
    expect(after).toEqual(before);
    await gotoWithRetry(hrAdminPage, "/alerts");
    await expect(hrAdminPage.getByTestId("processor-status")).toContainText(/Work still being finished: \d+ open working period/);
    await expect(hrAdminPage.getByTestId("processor-status")).toContainText(/must stay enabled until all are 0/);
  });
});
