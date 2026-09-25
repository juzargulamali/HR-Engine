import { type Page, expect } from "@playwright/test";

/**
 * apps/web/src/app/login/login-form.tsx: a plain labelled email/password
 * form, POSTed via a Server Action ("Sign in" button, disabled while
 * pending). Selectors here are label/role-based (not test-ids) because
 * that's what the real source renders — verified by reading that file
 * directly, not guessed.
 */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/login");
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.page.getByLabel("Email", { exact: true }).fill(email);
    await this.page.getByLabel("Password", { exact: true }).fill(password);
    await this.page.getByRole("button", { name: /sign in/i }).click();
  }

  /** Successful sign-in redirects off /login. We assert on the URL leaving
   * /login rather than a specific destination, since role-based landing
   * pages may differ and this suite must not assume one. */
  async expectSignedIn(): Promise<void> {
    await expect(this.page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  }

  async expectSignInError(): Promise<void> {
    await expect(this.page.getByRole("alert")).toBeVisible();
    await expect(this.page).toHaveURL(/\/login/);
  }
}
