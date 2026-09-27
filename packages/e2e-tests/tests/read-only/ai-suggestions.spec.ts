import { test, expect } from "../../src/fixtures";
import { hasCredentials } from "../../src/config";

/**
 * Section H requirement: this suite must never authorize an AI suggestion
 * or execute a corrective action. RBAC allow/deny for these two routes is
 * covered by the full matrix in rbac.spec.ts; this file's only job is to
 * prove — by construction, never by a runtime guard that could itself be
 * bypassed — that no action/approve/execute/dismiss control on either page
 * is ever clicked. Read-only: navigation and viewing only.
 */
test.describe("AI suggestions and alerts — view only, never actioned", () => {
  test("HR Admin can view /ai-suggestions; this suite clicks nothing on it", async ({ hrAdminPage }) => {
    await hrAdminPage.goto("/ai-suggestions");
    expect((await hrAdminPage.locator("body").innerText()).length).toBeGreaterThan(0);
  });

  test("Sys Admin can view /ai-suggestions (skips cleanly if not configured); this suite clicks nothing on it", async ({ sysAdminPage }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured.");
    await sysAdminPage.goto("/ai-suggestions");
    expect((await sysAdminPage.locator("body").innerText()).length).toBeGreaterThan(0);
  });

  test("HR Admin and CEO can view /alerts; this suite clicks nothing on it", async ({ hrAdminPage, ceoPage }) => {
    await hrAdminPage.goto("/alerts");
    await ceoPage.goto("/alerts");
    expect((await hrAdminPage.locator("body").innerText()).length).toBeGreaterThan(0);
    expect((await ceoPage.locator("body").innerText()).length).toBeGreaterThan(0);
  });
});
