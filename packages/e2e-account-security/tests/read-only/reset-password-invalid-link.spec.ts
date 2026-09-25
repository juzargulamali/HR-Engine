import { test, expect } from "@playwright/test";

test("visiting /reset-password with no token shows an invalid-link message, not a form", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  await expect(page.getByLabel("New password")).not.toBeVisible();
});

test("visiting /reset-password with a garbage token also shows the invalid-link message", async ({ page }) => {
  // A syntactically-present but bogus token — setSession() rejects it the
  // same way an expired or already-used real token would, exercising the
  // same code path without needing a genuine expired Supabase link.
  await page.goto("/reset-password#access_token=not-a-real-token&refresh_token=not-a-real-token");
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
});

test("visiting /set-password with no token shows its own invalid-link message", async ({ page }) => {
  await page.goto("/set-password");
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  await expect(page.getByText(/ask HR to send you a new invite/i)).toBeVisible();
});
