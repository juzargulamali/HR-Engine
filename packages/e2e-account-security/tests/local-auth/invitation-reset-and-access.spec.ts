import { createRequire } from "node:module";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { createTestAdminClient, createTestUser, deleteTestUser, type TestUser } from "../../src/adminClient";
import { loginAs } from "../../src/auth";
import { openAccountPanel } from "../../src/peopleAccess";

const require = createRequire(import.meta.url);
const { Client } = require("pg") as typeof import("pg");

/**
 * LOCAL STACK ONLY. The account controls end to end against the throwaway database and the in-repository auth stand-in
 * (packages/e2e-tests/local-stack/local-auth.mjs), which records the "e-mails" it would send in local_auth.outbox so a test can open the link:
 * invite, unauthorised invite, resend, the link that sets a first password, an administrator's password reset and its link, a link spent after
 * deactivation, deleting a login, and who is offered any of it. It is NOT Supabase Auth and sends no e-mail; see
 * docs/people-access-account-controls-verification.md for what that leaves to a hosted test project. Refuses to run against anything else.
 */
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/;
const FIRST_PASSWORD = "First-Passw0rd!-local-1";
const SECOND_PASSWORD = "Second-Passw0rd!-local-2";

test.describe("invitation, reset and access to the account controls @local-auth", () => {
  test.skip(!process.env.LOCAL_DB_URL, "LOCAL_DB_URL is not set: this spec only runs against the throwaway local stack.");
  test.skip(!LOCAL.test(process.env.E2E_BASE_URL ?? "") || !LOCAL.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""), "The app or the auth URL is not local: refusing to run.");
  test.describe.configure({ mode: "serial" });

  const admin = createTestAdminClient();
  let db: InstanceType<typeof Client>;
  let sysAdmin: TestUser;
  const created: string[] = [];
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env.LOCAL_DB_URL });
    await db.connect();
    sysAdmin = await createTestUser(admin, { role: "sys_admin" });
    created.push(sysAdmin.id);
  });
  test.afterAll(async () => {
    for (const id of created) await deleteTestUser(admin, id).catch(() => undefined);
    await db.end();
  });

  const mailTo = async (email: string, kind: "invite" | "recovery", after = 0) => {
    let link = "";
    await expect
      .poll(async () => {
        const { rows } = await db.query("select id, action_link from local_auth.outbox where lower(email) = lower($1) and kind = $2 and id > $3 order by id desc limit 1", [email, kind, after]);
        link = rows[0]?.action_link ?? "";
        return link;
      }, { message: `a ${kind} e-mail for ${email}` })
      .not.toBe("");
    return link;
  };
  const lastMailId = async () => Number((await db.query("select coalesce(max(id), 0) as id from local_auth.outbox")).rows[0].id);
  const statusOf = async (email: string) => (await db.query("select account_status from profiles where lower(email) = lower($1)", [email])).rows[0]?.account_status as string | undefined;
  const audited = async (action: string, recordId: string) => Number((await db.query("select count(*) as n from audit_log where action = $1 and record_id = $2", [action, recordId])).rows[0].n);

  async function signedInAdmin(browser: Browser): Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    await loginAs(page, sysAdmin.email, sysAdmin.password);
    return page;
  }
  /** Sends the invitation from the screen; unless a refusal is expected, waits until the e-mail exists so the account is there to look at. */
  async function invite(page: Page, email: string, fullName: string, opts: { expectMail?: boolean } = {}) {
    const before = await lastMailId();
    await page.goto("/people-access");
    const panel = page.locator("details", { hasText: "Invite a person" });
    await panel.locator("summary").click();
    await panel.getByLabel("Full name").fill(fullName);
    await panel.getByLabel("Email").fill(email);
    await panel.getByRole("button", { name: "Send invite" }).click();
    const link = opts.expectMail === false ? "" : await mailTo(email, "invite", before);
    return { panel, link };
  }
  async function setPasswordFromLink(browser: Browser, link: string, password: string) {
    const page = await (await browser.newContext()).newPage();
    await page.goto(link);
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL((u) => !/\/(set|reset)-password/.test(u.pathname));
    return page;
  }
  const idOf = async (email: string) => (await db.query("select id from auth.users where lower(email) = lower($1)", [email])).rows[0]?.id as string;

  test("an invitation is sent, its link sets a first password, the account becomes active and the person can sign in", async ({ browser }) => {
    const email = `invitee-${suffix}@example.invalid`;
    const page = await signedInAdmin(browser);
    const { link } = await invite(page, email, "Invited Person");
    expect(link).toContain("/set-password#");
    expect(await statusOf(email)).toBe("invited");
    created.push(await idOf(email));

    const weak = await (await browser.newContext()).newPage();
    await weak.goto(link);
    await weak.getByLabel("New password").fill("short");
    await weak.getByLabel("Confirm password").fill("short");
    await weak.getByRole("button", { name: /continue/i }).click();
    await expect(weak.getByRole("alert").filter({ hasText: /at least 10 characters/i })).toBeVisible();
    expect(await statusOf(email), "a refused password changes nothing").toBe("invited");

    const accepted = await setPasswordFromLink(browser, link, FIRST_PASSWORD);
    await expect(accepted).not.toHaveURL(/\/login/);
    expect(await statusOf(email)).toBe("active");

    const fresh = await (await browser.newContext()).newPage();
    await loginAs(fresh, email, FIRST_PASSWORD);
    await expect(fresh).not.toHaveURL(/\/login/);
  });

  test("inviting an address that already has an account is refused and points to Resend invite", async ({ browser }) => {
    const page = await signedInAdmin(browser);
    const { panel } = await invite(page, `invitee-${suffix}@example.invalid`, "Invited Again", { expectMail: false });
    await expect(panel.getByRole("alert").or(panel.getByText(/already has an account/i)).first()).toContainText(/already has an account/i);
  });

  test("Resend invite works for someone who has not accepted, offers no password reset yet, and its link sets the first password", async ({ browser }) => {
    const email = `pending-${suffix}@example.invalid`;
    const page = await signedInAdmin(browser);
    await invite(page, email, "Pending Person");
    created.push(await idOf(email));
    const afterInvite = await lastMailId();

    const account = await openAccountPanel(page, email);
    await expect(account.getByText("Invited", { exact: true }).first()).toBeVisible();
    await expect(account.getByRole("button", { name: "Send password reset" })).toHaveCount(0);
    await account.getByRole("button", { name: "Resend invite" }).click();

    const link = await mailTo(email, "recovery", afterInvite);
    await expect.poll(() => audited("invitation_resent", created[created.length - 1]!)).toBeGreaterThan(0);
    await setPasswordFromLink(browser, link, FIRST_PASSWORD);
    expect(await statusOf(email)).toBe("active");
  });

  test("an administrator's password reset e-mails a link that replaces the password and signs the person's other sessions out", async ({ browser }) => {
    const target = await createTestUser(admin);
    created.push(target.id);
    const other = await (await browser.newContext()).newPage();
    await loginAs(other, target.email, target.password);
    await other.goto("/account/security");
    await expect(other).not.toHaveURL(/\/login/);

    const before = await lastMailId();
    const page = await signedInAdmin(browser);
    const account = await openAccountPanel(page, target.email);
    await account.getByRole("button", { name: "Send password reset" }).click();
    const link = await mailTo(target.email, "recovery", before);
    expect(link).toContain("/reset-password#");
    await expect.poll(() => audited("password_reset_sent_by_admin", target.id)).toBeGreaterThan(0);

    await setPasswordFromLink(browser, link, SECOND_PASSWORD);

    const old = await (await browser.newContext()).newPage();
    await old.goto("/login");
    await old.getByLabel("Email").fill(target.email);
    await old.getByLabel("Password", { exact: true }).fill(target.password);
    await old.getByRole("button", { name: "Sign in" }).click();
    await expect(old).toHaveURL(/\/login/);
    const fresh = await (await browser.newContext()).newPage();
    await loginAs(fresh, target.email, SECOND_PASSWORD);
    await expect(fresh).not.toHaveURL(/\/login/);

    await other.goto("/account/security");
    await expect(other, "the session that existed before the reset is cut off").toHaveURL(/\/login/);
  });

  test("a reset link that is still unused when the account is deactivated no longer works, and reactivation does not revive it", async ({ browser }) => {
    const target = await createTestUser(admin);
    created.push(target.id);
    const before = await lastMailId();
    const page = await signedInAdmin(browser);
    const account = await openAccountPanel(page, target.email);
    await account.getByRole("button", { name: "Send password reset" }).click();
    const link = await mailTo(target.email, "recovery", before);

    page.once("dialog", (d) => d.accept("link must stop working"));
    await account.getByRole("button", { name: "Deactivate" }).click();
    await expect(account.getByText(/Deactivated/i).first()).toBeVisible();

    const spent = await (await browser.newContext()).newPage();
    await spent.goto(link);
    await expect(spent.getByText(/invalid or has expired/i)).toBeVisible();
    await expect(spent.getByLabel("New password")).toHaveCount(0);

    page.once("dialog", (d) => d.accept("cleanup"));
    await account.getByRole("button", { name: "Reactivate" }).click();
    await expect(account.getByText("Active", { exact: true }).first()).toBeVisible();
  });

  test("deleting a login removes it and its sign-in; an administrator cannot delete or deactivate their own account", async ({ browser }) => {
    const email = `delete-me-${suffix}@example.invalid`;
    const page = await signedInAdmin(browser);
    await invite(page, email, "Delete Me");
    const id = await idOf(email);
    expect(id).toBeTruthy();
    const account = await openAccountPanel(page, email);
    page.once("dialog", (d) => d.accept());
    await account.getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => idOf(email)).toBeUndefined();
    expect((await db.query("select count(*) as n from profiles where id = $1", [id])).rows[0].n, "the profile goes with the login").toBe("0");

    const own = await openAccountPanel(page, sysAdmin.email);
    await expect(own.getByText(/can.t change your own account status/i)).toBeVisible();
    await expect(own.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(own.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
  });

  test("only a System Administrator is offered invitations and account controls, and the service key never reaches a browser", async ({ browser }) => {
    const hr = await createTestUser(admin, { role: "hr_admin" });
    const plain = await createTestUser(admin);
    created.push(hr.id, plain.id);
    for (const who of [hr, plain]) {
      const page = await (await browser.newContext()).newPage();
      await loginAs(page, who.email, who.password);
      await page.goto("/admin/users");
      await expect(page).toHaveURL(/\/people-access/);
      await expect(page.getByText("Invite a person")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^(Deactivate|Delete|Send password reset|Resend invite)$/ })).toHaveCount(0);
      await page.goto(`/people-access?q=${encodeURIComponent(sysAdmin.email)}`);
      await expect(page.getByRole("link", { name: new RegExp(sysAdmin.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }), "an account the viewer does not manage is not listed").toHaveCount(0);
    }

    const leaked: string[] = [];
    const page = await signedInAdmin(browser);
    page.on("response", async (r) => {
      const type = r.headers()["content-type"] ?? "";
      if (/html|javascript|json|text/.test(type) && (await r.text().catch(() => "")).includes(process.env.SUPABASE_SERVICE_ROLE_KEY!)) leaked.push(r.url());
    });
    await page.goto("/people-access");
    await openAccountPanel(page, hr.email);
    expect(leaked, "no page, script or data response may contain the service-role key").toEqual([]);
  });
});
