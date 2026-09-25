/**
 * DRY-RUN ONLY. Lists exactly which Production records this suite created
 * for a given run ID, grouped by test user — and nothing else. Never
 * deletes, updates, or mutates anything. This is deliberately a standalone
 * script (not a database RPC or a UI button): the task boundary is explicit
 * that no general-purpose cleanup RPC/button may exist in the product
 * itself. Actually deleting/anonymizing is a separate, later, explicitly
 * authorized step — this script's only job tonight is to prove cleanup CAN
 * be scoped precisely, by printing what it would target.
 *
 * Identification is deliberately narrow, per "refuse unknown/unmarked
 * records": every row this script reports is EITHER
 *   (a) tagged in a free-text field with this exact run ID (see
 *       src/recordTag.ts's tag()/isTagged()), for tables that have one, OR
 *   (b) on this run's synthetic test date (src/recordTag.ts's testDate(),
 *       always in the year 2099+) AND belongs to a known test employee, for
 *       tables with no free-text field (attendance, recovery credit).
 * A row matching neither is never listed, however "test-like" it looks —
 * there is no fallback to a date range or a name/email pattern.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   E2E_EMPLOYEE_EMAIL=... E2E_MANAGER_EMAIL=... E2E_HR_ADMIN_EMAIL=... \
 *   E2E_CEO_EMAIL=... [E2E_FINANCE_EMAIL=...] \
 *   npm run cleanup:dry-run -- E2E-20260925-0130
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isTagged, testDate } from "../src/recordTag";

const TEST_EMAIL_ENV_VARS = ["E2E_EMPLOYEE_EMAIL", "E2E_MANAGER_EMAIL", "E2E_HR_ADMIN_EMAIL", "E2E_CEO_EMAIL", "E2E_FINANCE_EMAIL"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId || !/^E2E-\d{8}-\d{4}$/.test(runId)) {
    console.error("Usage: npm run cleanup:dry-run -- E2E-YYYYMMDD-HHMM");
    process.exit(1);
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const testEmails = TEST_EMAIL_ENV_VARS.map((v) => process.env[v]).filter((v): v is string => !!v);
  if (testEmails.length === 0) {
    console.error("No E2E_*_EMAIL variables set — refusing to run (would have no known test identities to scope to).");
    process.exit(1);
  }

  const testUsers = await resolveTestUsers(supabase, testEmails);
  if (testUsers.length === 0) {
    console.error("None of the configured test emails resolved to a real employee — nothing to report, refusing to guess.");
    process.exit(1);
  }
  const employeeIds = testUsers.map((u) => u.employeeId);
  const employeeIdToLabel = new Map(testUsers.map((u) => [u.employeeId, u.email]));

  console.log(`\nDRY RUN for ${runId} — scoped to ${testUsers.length} known test employee(s). Nothing will be deleted.\n`);

  let totalFound = 0;

  // --- Tables with a free-text field carrying the run tag -----------------
  totalFound += await reportTagged(supabase, "leave_requests", "reason", runId, employeeIds, employeeIdToLabel, ["id", "leave_type_code", "start_date", "end_date", "status", "created_at"]);

  totalFound += await reportTaggedViaClaim(supabase, runId, employeeIds, employeeIdToLabel);

  // --- Tables with no free-text field: identified by synthetic test date --
  const candidateTestDates = Array.from({ length: 10 }, (_, i) => testDate(runId, i));
  totalFound += await reportByTestDate(supabase, "attendance_records", "work_date", candidateTestDates, employeeIds, employeeIdToLabel, ["id", "work_date", "status", "work_mode", "created_at"] as const);
  totalFound += await reportByTestDate(supabase, "recovery_credit_requests", "work_date", candidateTestDates, employeeIds, employeeIdToLabel, ["id", "work_date", "status", "event_type", "created_at"] as const);

  console.log(`\nTotal records identified for ${runId}: ${totalFound}`);
  console.log("This was a DRY RUN. No rows were modified or deleted.\n");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function resolveTestUsers(
  supabase: AnySupabaseClient,
  emails: string[],
): Promise<Array<{ email: string; userId: string; employeeId: string }>> {
  const results: Array<{ email: string; userId: string; employeeId: string }> = [];
  // supabase-js has no "get user by email" admin call; list and filter
  // client-side. Test account counts are small, so one page is enough.
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (error) {
    console.error(`Failed to list auth users: ${error.message}`);
    process.exit(1);
  }
  for (const email of emails) {
    const authUser = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!authUser) {
      console.warn(`  (warning) test email ${email} has no matching auth user — skipping`);
      continue;
    }
    const { data: employee } = await supabase.from("employees").select("id").eq("user_id", authUser.id).is("deleted_at", null).maybeSingle();
    if (!employee) {
      console.warn(`  (warning) test user ${email} has no linked employee record — skipping`);
      continue;
    }
    results.push({ email, userId: authUser.id, employeeId: employee.id as string });
  }
  return results;
}

async function reportTagged(
  supabase: AnySupabaseClient,
  table: string,
  textColumn: string,
  runId: string,
  employeeIds: string[],
  labels: Map<string, string>,
  selectColumns: string[],
): Promise<number> {
  const { data, error } = (await supabase
    .from(table)
    .select([...selectColumns, "employee_id", textColumn].join(","))
    .in("employee_id", employeeIds)
    .ilike(textColumn, `[${runId}]%`)) as { data: Record<string, unknown>[] | null; error: { message: string } | null };
  if (error) {
    console.warn(`  (warning) could not query ${table}: ${error.message}`);
    return 0;
  }
  const rows = (data ?? []).filter((row: Record<string, unknown>) => isTagged(row[textColumn] as string, runId));
  printGroup(table, rows, labels);
  return rows.length;
}

/** reimbursement_claim_lines carries the tag, but the employee link is one
 * level up on reimbursement_claims — join manually rather than assuming a
 * PostgREST embed shape. */
async function reportTaggedViaClaim(
  supabase: AnySupabaseClient,
  runId: string,
  employeeIds: string[],
  labels: Map<string, string>,
): Promise<number> {
  const { data: claims, error: claimsError } = await supabase.from("reimbursement_claims").select("id, employee_id").in("employee_id", employeeIds);
  if (claimsError) {
    console.warn(`  (warning) could not query reimbursement_claims: ${claimsError.message}`);
    return 0;
  }
  const claimIds = (claims ?? []).map((c: { id: string }) => c.id);
  if (claimIds.length === 0) {
    printGroup("reimbursement_claim_lines", [], labels);
    return 0;
  }
  const claimToEmployee = new Map((claims ?? []).map((c: { id: string; employee_id: string }) => [c.id, c.employee_id]));
  const { data: lines, error: linesError } = await supabase
    .from("reimbursement_claim_lines")
    .select("id, claim_id, description, amount, category, created_at")
    .in("claim_id", claimIds)
    .ilike("description", `[${runId}]%`);
  if (linesError) {
    console.warn(`  (warning) could not query reimbursement_claim_lines: ${linesError.message}`);
    return 0;
  }
  const rows = (lines ?? [])
    .filter((row: { description: string }) => isTagged(row.description, runId))
    .map((row: { claim_id: string } & Record<string, unknown>) => ({ ...row, employee_id: claimToEmployee.get(row.claim_id) }));
  printGroup("reimbursement_claim_lines", rows, labels);
  return rows.length;
}

async function reportByTestDate(
  supabase: AnySupabaseClient,
  table: string,
  dateColumn: string,
  candidateDates: string[],
  employeeIds: string[],
  labels: Map<string, string>,
  selectColumns: readonly string[],
): Promise<number> {
  const { data, error } = (await supabase
    .from(table)
    .select([...selectColumns, "employee_id"].join(","))
    .in("employee_id", employeeIds)
    .in(dateColumn, candidateDates)) as { data: Record<string, unknown>[] | null; error: { message: string } | null };
  if (error) {
    console.warn(`  (warning) could not query ${table}: ${error.message}`);
    return 0;
  }
  const rows = data ?? [];
  printGroup(table, rows, labels);
  return rows.length;
}

function printGroup(table: string, rows: Array<Record<string, unknown>>, labels: Map<string, string>): void {
  console.log(`## ${table} (${rows.length})`);
  if (rows.length === 0) {
    console.log("  (none)\n");
    return;
  }
  const byEmployee = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const employeeId = row.employee_id as string;
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, []);
    byEmployee.get(employeeId)!.push(row);
  }
  for (const [employeeId, employeeRows] of byEmployee) {
    console.log(`  test user: ${labels.get(employeeId) ?? employeeId}`);
    for (const row of employeeRows) {
      console.log(`    ${JSON.stringify(row)}`);
    }
  }
  console.log("");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
