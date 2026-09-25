import type { FullConfig } from "@playwright/test";
import { generateRunId, getBaseUrl, getSupabaseUrl, isBackupConfirmed, isBrowserTlsBypassAllowed, requireAllCredentials, ROLE_ENV_PREFIX, type Role } from "./config";
import { logTlsPreflightResult, strictTlsCheck } from "./tlsPreflight";

/**
 * Runs once, in the main process, before any worker starts. Three jobs:
 *
 * 1. Fail the whole run immediately and clearly if the environment isn't
 *    safe/complete to test against — a missing base URL or a missing
 *    REQUIRED role's credentials — rather than letting individual tests
 *    fail one by one with confusing, credential-shaped errors.
 * 2. Compute this run's E2E_RUN_ID exactly once and export it via
 *    process.env, so every worker process (each a child of this one) reads
 *    the same value — see src/config.ts's getRunId().
 * 3. If E2E_ALLOW_BROWSER_TLS_BYPASS=true, independently verify (via Node's
 *    own TLS stack, not Chromium) that the certificates this run depends on
 *    are genuinely valid BEFORE any browser launches with certificate
 *    checking relaxed — see src/tlsPreflight.ts. A failure here aborts the
 *    whole run: the bypass exists for one confirmed Chromium-in-container
 *    defect, not as a general license to skip real certificate problems.
 *
 * Never logs a credential value, only which roles are configured. Backup
 * confirmation is deliberately NOT enforced here: read-only specs should
 * still be able to run without it. Mutating specs each gate on
 * isBackupConfirmed() themselves (see tests/README section "Mutating tests").
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const baseUrl = getBaseUrl();

  const runId = process.env.E2E_RUN_ID ?? generateRunId();
  process.env.E2E_RUN_ID = runId;

  if (isBrowserTlsBypassAllowed()) {
    const hostsToCheck = [new URL(baseUrl).hostname];
    const supabaseUrl = getSupabaseUrl();
    if (supabaseUrl) {
      hostsToCheck.push(new URL(supabaseUrl).hostname);
    } else {
      // eslint-disable-next-line no-console
      console.log("[tls-preflight] no SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL env var found — skipping that half of the preflight (E2E_BASE_URL is still checked).");
    }

    const results = await Promise.all(hostsToCheck.map((h) => strictTlsCheck(h)));
    results.forEach(logTlsPreflightResult);

    const failed = results.filter((r) => !r.authorized);
    if (failed.length > 0) {
      throw new Error(
        `Strict Node TLS preflight failed for: ${failed.map((r) => r.hostname).join(", ")}. ` +
          `E2E_ALLOW_BROWSER_TLS_BYPASS is set, which relaxes Chromium's OWN certificate checking — this preflight is what still catches a genuine certificate problem, so the whole run aborts rather than proceeding with a real bad certificate hidden behind that bypass.`,
      );
    }
  }

  const credentials = requireAllCredentials();
  const configuredRoles = (Object.keys(ROLE_ENV_PREFIX) as Role[]).filter((role) => credentials[role] !== null);
  const missingOptionalRoles = (Object.keys(ROLE_ENV_PREFIX) as Role[]).filter((role) => credentials[role] === null);

  // eslint-disable-next-line no-console
  console.log(
    [
      `[e2e] run ID:        ${runId}`,
      `[e2e] base URL:      ${baseUrl}`,
      `[e2e] roles ready:   ${configuredRoles.join(", ")}`,
      missingOptionalRoles.length > 0
        ? `[e2e] roles skipped: ${missingOptionalRoles.join(", ")} (optional, no account configured — dependent specs will skip)`
        : null,
      `[e2e] backup confirmed (E2E_BACKUP_CONFIRMED=true): ${isBackupConfirmed() ? "yes" : "NO — mutating specs will skip"}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
