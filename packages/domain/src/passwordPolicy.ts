/**
 * One password policy, shared by every place a password gets set (invite
 * completion, forgot-password reset, self-service change) so client-side
 * feedback and server-side enforcement can never drift apart. 10 characters
 * + 3 of 4 character classes — this project's Supabase configuration has no
 * stronger policy documented (supabase/config.toml has no minimum_password_length
 * override), so this is the "sensible default" the brief asks for rather
 * than a project-specific requirement.
 */
export const PASSWORD_MIN_LENGTH = 10;

export const PASSWORD_REQUIREMENTS_TEXT =
  "At least 10 characters, with a mix of at least 3 of: uppercase letters, lowercase letters, numbers, and symbols.";

const CLASS_PATTERNS = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];

/**
 * Returns a list of unmet requirements (empty = the password is acceptable).
 * Deliberately returns plain, specific strings rather than a boolean — both
 * the accessible inline validation message and the server action's error
 * response read directly off this, so there's exactly one place that decides
 * what "a strong enough password" means.
 */
export function getPasswordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  const classesMet = CLASS_PATTERNS.filter((pattern) => pattern.test(password)).length;
  if (classesMet < 3) {
    issues.push("Mix in at least 3 of: uppercase, lowercase, numbers, and symbols.");
  }
  return issues;
}
