/**
 * All configuration this suite needs comes from environment variables —
 * never hardcoded, never logged, never written to a report or trace file.
 * Playwright traces/videos can capture page content but never these
 * process-level values directly; test code must also avoid typing
 * passwords into anything that gets logged.
 *
 * This module is intentionally strict: a missing required variable throws
 * immediately, with a message naming exactly what's missing and why —
 * "do not run Production tests until the encrypted account secrets are
 * available" is enforced here as code, not just as a rule someone has to
 * remember.
 */

export interface RoleCredentials {
  email: string;
  password: string;
}

const OPTIONAL_ROLES = new Set(["finance", "sysAdmin"]);

/** Every role this suite knows how to authenticate as. `finance` and
 * `sysAdmin` are optional — dedicated test accounts for them may not exist
 * in every environment; every other role is required for the suite to
 * start at all. These are the SAME fixed, dedicated E2E accounts every
 * run, never disposable users created/deleted by this suite. */
export const ROLE_ENV_PREFIX = {
  employee: "E2E_EMPLOYEE",
  manager: "E2E_MANAGER",
  hrAdmin: "E2E_HR",
  ceo: "E2E_CEO",
  finance: "E2E_FINANCE",
  sysAdmin: "E2E_ADMIN",
} as const;

export type Role = keyof typeof ROLE_ENV_PREFIX;

export const ALL_ROLES = Object.keys(ROLE_ENV_PREFIX) as Role[];

/**
 * Where the auth-setup project (tests/auth.setup.ts) saves each role's
 * signed-in storageState, and where src/fixtures.ts reads it back from.
 * Gitignored (packages/e2e-tests/.auth/) — a storageState file is live
 * session cookies/tokens and must never be committed.
 */
export function authStateFile(role: Role): string {
  return new URL(`../.auth/${role}.json`, import.meta.url).pathname;
}

function readRoleCredentials(role: Role): RoleCredentials | null {
  const prefix = ROLE_ENV_PREFIX[role];
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) {
    if (OPTIONAL_ROLES.has(role)) return null;
    throw new Error(
      `Missing required test credentials for role "${role}": set ${prefix}_EMAIL and ${prefix}_PASSWORD as encrypted environment secrets (GitHub Environment "production-qa"). ` +
        `Never pass these via chat, a committed file, or the command line.`,
    );
  }
  return { email, password };
}

/** The app's own Supabase project URL, if this environment happens to
 * expose it as a plain (non-secret) env var — the project URL itself isn't
 * sensitive, unlike its anon/service-role keys, which this suite never
 * reads. Returns null (not a guess) if neither is set. Used only by
 * src/hostGuard.ts to recognize a sign-in redirect through the app's own
 * Supabase project as expected, not a hijacked/unexpected external origin. */
export function getSupabaseUrl(): string | null {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
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
 * Per-run mutation authorization gate. Every mutating spec calls
 * isMutationAuthorized() in a test.skip guard rather than relying on a
 * human remembering not to run it. There is deliberately no way to set
 * this to true from inside the test suite itself; it can only come from
 * the person who explicitly authorized mutation on the dedicated test
 * accounts for THIS run (leave/reimbursement approvals, Employee account
 * deactivate/reactivate). This name and this doc comment deliberately do
 * NOT say "backup" — this suite makes no claim that a Supabase backup was
 * taken, and never should. Some of what this gate allows is not reversible
 * via the UI at all (see README.md's "What is and isn't reversible").
 */
export function isMutationAuthorized(): boolean {
  return process.env.E2E_MUTATION_AUTHORIZED === "true";
}

/**
 * `E2E-YYYYMMDD-HHMMSS` (UTC), computed ONCE per suite invocation (via
 * globalSetup, which writes it to E2E_RUN_ID for every worker process to
 * read) — not per test file or per worker, so every record this run
 * creates carries the same tag. Because the mutating GitHub Actions
 * workflow invokes `playwright test` multiple times (once per project:
 * baseline, read-only, mutating, reconciliation — see README.md), the
 * workflow itself computes E2E_RUN_ID ONCE at the start and passes it to
 * every step as an env var; globalSetup here only generates a fresh one
 * as a fallback for a plain local/manual invocation.
 */
export function generateRunId(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mm = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  return `E2E-${y}${m}${d}-${hh}${mm}${ss}`;
}

export function getRunId(): string {
  const runId = process.env.E2E_RUN_ID;
  if (!runId) {
    throw new Error("E2E_RUN_ID is not set — globalSetup should have generated and exported it before any test runs.");
  }
  return runId;
}

/** Where baseline/reconciliation state for a run is written/read, since the
 * capture and verification steps are separate `playwright test` process
 * invocations (see tests/baseline, tests/reconcile). Gitignored — this is
 * scratch state for one run, never committed. */
export function stateFile(runId: string): string {
  return new URL(`../.e2e-state/${runId}.json`, import.meta.url).pathname;
}
