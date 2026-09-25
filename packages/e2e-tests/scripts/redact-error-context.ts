import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Runs after the E2E suite and BEFORE any CI artifact upload (see
 * .github/workflows/e2e-production-qa.yml). Playwright's error-context.md
 * snapshots can show a signed-in test account's email address — e.g.
 * rendered in the app's own nav/header at the moment of failure. Not a
 * secret on the level of a password or session cookie, but not something
 * that needs to leave this run either (confirmed present in an earlier
 * manual run this session — see README.md). Replaces every configured
 * test-account email with a fixed placeholder, in every error-context.md
 * under test-results/, in place.
 *
 * Deliberately does NOT touch trace.zip, playwright-report/, or any other
 * file: this suite's standing CI policy (README.md) is that those never
 * get uploaded as artifacts at all, precisely because they capture raw
 * network activity (including live session cookies) that redacting safely
 * out of a binary/zip format is not something this script attempts.
 */
const EMAIL_ENV_VARS = ["E2E_EMPLOYEE_EMAIL", "E2E_MANAGER_EMAIL", "E2E_HR_EMAIL", "E2E_CEO_EMAIL", "E2E_FINANCE_EMAIL", "E2E_ADMIN_EMAIL"];
const REDACTED = "[REDACTED-TEST-EMAIL]";
const TEST_RESULTS_DIR = path.join(process.cwd(), "test-results");

function findErrorContextFiles(dir: string): string[] {
  let results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      results = results.concat(findErrorContextFiles(full));
    } else if (entry === "error-context.md") {
      results.push(full);
    }
  }
  return results;
}

function main(): void {
  const emails = EMAIL_ENV_VARS.map((v) => process.env[v]).filter((v): v is string => !!v);
  if (emails.length === 0) {
    console.log("[redact] No test-account email env vars set — nothing to redact.");
    return;
  }

  const files = findErrorContextFiles(TEST_RESULTS_DIR);
  let redactedCount = 0;
  for (const file of files) {
    const original = readFileSync(file, "utf8");
    let updated = original;
    for (const email of emails) {
      updated = updated.split(email).join(REDACTED);
    }
    if (updated !== original) {
      writeFileSync(file, updated, "utf8");
      redactedCount++;
    }
  }
  console.log(`[redact] Scanned ${files.length} error-context.md file(s), redacted test-account emails in ${redactedCount}.`);
}

main();
