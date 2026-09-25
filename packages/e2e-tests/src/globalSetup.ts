import type { FullConfig } from "@playwright/test";
import { generateRunId, getBaseUrl, isBackupConfirmed, requireAllCredentials, ROLE_ENV_PREFIX, type Role } from "./config";

/**
 * Runs once, in the main process, before any worker starts. Two jobs:
 *
 * 1. Fail the whole run immediately and clearly if the environment isn't
 *    safe/complete to test against — a missing base URL or a missing
 *    REQUIRED role's credentials — rather than letting individual tests
 *    fail one by one with confusing, credential-shaped errors.
 * 2. Compute this run's E2E_RUN_ID exactly once and export it via
 *    process.env, so every worker process (each a child of this one) reads
 *    the same value — see src/config.ts's getRunId().
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
