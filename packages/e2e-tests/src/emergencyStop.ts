import { ALL_ROLES, hasCredentials, getCredentials, type Role } from "./config";
import { isTagged } from "./recordTag";

/**
 * Two hard emergency-stop conditions, required by the standing
 * authorization for this suite, enforced as code rather than left to test
 * authors to remember:
 *
 *   1. Never act on an account whose email isn't one of the configured,
 *      approved E2E_* test accounts.
 *   2. Never mutate a pre-existing record found during a run unless it
 *      already carries THAT SAME run's tag.
 *
 * Both throw (never warn-and-continue) — a mutating test hitting either of
 * these must fail loudly, not silently skip or proceed.
 */

function approvedTestEmails(): Set<string> {
  const emails = new Set<string>();
  for (const role of ALL_ROLES as Role[]) {
    if (hasCredentials(role)) emails.add(getCredentials(role).email.toLowerCase());
  }
  return emails;
}

/** Throws unless `email` is exactly one of the approved, dedicated E2E test
 * accounts configured for this run. Call this immediately before any action
 * that targets an account by email (e.g. before deactivating one). */
export function assertApprovedTestEmail(email: string): void {
  const approved = approvedTestEmails();
  if (!approved.has(email.toLowerCase())) {
    throw new Error(
      `EMERGENCY STOP: "${email}" is not one of this run's approved E2E test accounts (${[...approved].join(", ")}). ` + `Refusing to act on an account that wasn't explicitly configured as a dedicated test identity.`,
    );
  }
}

/** Throws unless `existingRecordText` (a leave reason, reimbursement
 * description, etc. already present on a record found in the UI) carries
 * THIS run's tag. Call this before a mutating spec would touch a record it
 * did not just create in the same test (e.g. before reusing/cancelling a
 * row found by a list scan rather than one just submitted). A record with
 * no tag, or a different run's tag, must never be touched. */
export function assertRecordTaggedForThisRun(existingRecordText: string | null | undefined, runId: string): void {
  if (!isTagged(existingRecordText, runId)) {
    throw new Error(`EMERGENCY STOP: found an existing record not tagged with the current run ID ("${runId}"): "${existingRecordText ?? "(empty)"}". Refusing to mutate a record this run did not create.`);
  }
}
