import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The scheduling configuration is spread over four places that must agree: apps/web/vercel.json (the daily
// safety net, when registered), the owner's pg_cron script (the 5-minute primary), the migration's status function
// (which looks the job up by name) and the cron route. These tests pin them to each other.
const REPO = path.resolve(import.meta.dirname, "../../../../..");
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");

describe("Recovery Leave processor scheduling configuration", () => {
  it("the Recovery safety-net route exists and is protected; if it is ever registered with Vercel (apps/web/vercel.json) it runs at most once a day (the Hobby plan's limit)", () => {
    // It is deliberately NOT registered today (scheduled-job activation is the owner's decision, and the route is behind the sign-in redirect);
    // the pg_cron job is the primary trigger. When it is registered, the entry must be one fixed minute of one fixed hour: never "*/5".
    const { crons } = JSON.parse(read("apps/web/vercel.json")) as { crons: { path: string; schedule: string }[] };
    const entry = crons.find((c) => c.path === "/api/cron/recovery-windows");
    if (entry) {
      const [minute, hour] = entry.schedule.split(" ");
      expect(minute).toMatch(/^\d+$/);
      expect(hour).toMatch(/^\d+$/);
    }
    // the route file exists and refuses a call without the cron secret
    const route = read("apps/web/src/app/api/cron/recovery-windows/route.ts");
    expect(route).toContain("isAuthorizedCronRequest");
  });

  it("the owner's pg_cron script schedules the processor every 5 minutes under the name the status function looks for", () => {
    const script = read("supabase/manual-sql/recovery_windows_30_enable_scheduler.sql");
    expect(script).toContain("'recovery-window-processor'");
    expect(script).toContain("'*/5 * * * *'");
    expect(script).toContain("recovery_process_due('pg_cron')");
    const migration = read("supabase/migrations/20261108000000_recovery_windows_attendance_redesign.sql");
    expect(migration).toContain("jobname = 'recovery-window-processor'");
    expect(migration).toContain("'expected_interval_minutes', 5");
  });

  it("the migration alone starts no scheduler and activates no policy", () => {
    const migration = read("supabase/migrations/20261108000000_recovery_windows_attendance_redesign.sql");
    expect(migration).not.toMatch(/cron\.schedule\s*\(/);
    expect(migration).not.toMatch(/create extension/i);
    // the only places a policy can become active are the controlled function and the test-only guard bypass
    expect(migration).not.toMatch(/insert into policy_versions[^;]*'active'/i);
  });

  it("the processor function is granted only to the service role", () => {
    const migration = read("supabase/migrations/20261108000000_recovery_windows_attendance_redesign.sql");
    expect(migration).toMatch(/revoke execute on function[\s\S]*recovery_process_due\(text, timestamptz, int\)[\s\S]*from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function recovery_process_due\(text, timestamptz, int\) to service_role/);
  });
});
