/**
 * All configuration this suite needs comes from environment variables —
 * never hardcoded, never logged, never written to a report or trace file.
 * Playwright traces/videos can capture page content but never these
 * process-level values directly; test code must also avoid typing
 * passwords into anything that gets logged (see fixtures/auth.ts).
 *
 * This module is intentionally strict: a missing required variable throws
 * immediately, with a message naming exactly what's missing and why —
 * "do not run Production tests until network access and encrypted account
 * secrets are available" is enforced here as code, not just as a rule
 * someone has to remember.
 */

export interface RoleCredentials {
  email: string;
  password: string;
}

const OPTIONAL_ROLES = new Set(["finance", "sysAdmin"]);

/** Every role this suite knows how to authenticate as. `finance` and
 * `sysAdmin` are optional — dedicated test accounts for them may not exist
 * in every environment; every other role is required for the suite to
 * start at all.
 *
 * Env var prefixes match the actual names configured for this Production
 * environment's five confirmed test accounts (Employee Test, Manager Test,
 * Admin Test, CEO Test, HR Test) — note "HR" (E2E_HR), not "HR_ADMIN", and
 * "Admin" (E2E_ADMIN) is a distinct Sys Admin account, separate from HR. */
export const ROLE_ENV_PREFIX = {
  employee: "E2E_EMPLOYEE",
  manager: "E2E_MANAGER",
  hrAdmin: "E2E_HR",
  ceo: "E2E_CEO",
  finance: "E2E_FINANCE",
  sysAdmin: "E2E_ADMIN",
} as const;

export type Role = keyof typeof ROLE_ENV_PREFIX;

function readRoleCredentials(role: Role): RoleCredentials | null {
  const prefix = ROLE_ENV_PREFIX[role];
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) {
    if (OPTIONAL_ROLES.has(role)) return null;
    throw new Error(
      `Missing required test credentials for role "${role}": set ${prefix}_EMAIL and ${prefix}_PASSWORD as encrypted environment secrets. ` +
        `Never pass these via chat, a committed file, or the command line — see packages/e2e-tests/README.md.`,
    );
  }
  return { email, password };
}

export function getBaseUrl(): string {
  const url = process.env.E2E_BASE_URL;
  if (!url) {
    throw new Error(
      "E2E_BASE_URL is not set. This suite only runs against a URL you explicitly provide (the confirmed Production URL) — " +
        "it never guesses or defaults to a domain, to avoid accidentally targeting the wrong environment.",
    );
  }
  return url;
}

/** Throws with a clear, specific message if any REQUIRED role credential is missing.
 * Call this once, in global setup, before any browser is launched — fail fast and
 * clearly rather than have individual tests fail confusingly one by one. */
export function requireAllCredentials(): Record<Role, RoleCredentials | null> {
  const result = {} as Record<Role, RoleCredentials | null>;
  for (const role of Object.keys(ROLE_ENV_PREFIX) as Role[]) {
    result[role] = readRoleCredentials(role);
  }
  return result;
}

export function getCredentials(role: Role): RoleCredentials {
  const creds = readRoleCredentials(role);
  if (!creds) {
    throw new Error(`Role "${role}" has no test account configured (this is expected if it hasn't been confirmed to exist yet) — skip tests that need it.`);
  }
  return creds;
}

export function hasCredentials(role: Role): boolean {
  return readRoleCredentials(role) !== null;
}

/**
 * Backup confirmation gate. Mutating specs must call requireBackupConfirmed()
 * in a beforeAll/test.skip guard — see tests/README section "Mutating tests" —
 * rather than relying on a human remembering not to run them. There is
 * deliberately no way to set this to true from inside the test suite itself;
 * it can only come from the person who actually confirmed the backup.
 */
export function isBackupConfirmed(): boolean {
  return process.env.E2E_BACKUP_CONFIRMED === "true";
}

/**
 * `E2E-YYYYMMDD-HHMM`, computed ONCE per suite run (via globalSetup, which
 * writes it to E2E_RUN_ID for every worker process to read) — not per test
 * file or per worker, so every record this run creates carries the same
 * tag, making the dry-run cleanup script's grouping meaningful.
 */
export function generateRunId(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mm = pad(now.getUTCMinutes());
  return `E2E-${y}${m}${d}-${hh}${mm}`;
}

export function getRunId(): string {
  const runId = process.env.E2E_RUN_ID;
  if (!runId) {
    throw new Error("E2E_RUN_ID is not set — globalSetup should have generated and exported it before any test runs.");
  }
  return runId;
}
