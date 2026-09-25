import { test, expect } from "@playwright/test";

test("login page links to the forgot-password flow", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole("heading", { name: /Forgot your password/i })).toBeVisible();
});
