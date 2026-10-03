import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The scheduling configuration is spread over four places that must agree: vercel.json (the daily
// safety net), the owner's pg_cron script (the 5-minute primary), the migration's status function
// (which looks the job up by name) and the cron route. These tests pin them to each other.
const REPO = path.resolve(import.meta.dirname, "../../../../..");
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");

describe("Recovery Leave processor scheduling configuration", () => {
  it("vercel.json registers the protected safety-net route, at most once a day (the Hobby plan's limit)", () => {
    const { crons } = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const entry = crons.find((c) => c.path === "/api/cron/recovery-windows");
    expect(entry).toBeTruthy();
    const [minute, hour, dayOfMonth] = entry!.schedule.split(" ");
    expect(minute).toMatch(/^\d+$/); // one fixed minute...
    expect(hour).toMatch(/^\d+$/); // ...of one fixed hour: once a day, never "*/5"
    expect(dayOfMonth).toBeDefined();
    // the route file exists and is the one the cron points at
    expect(() => read("apps/web/src/app/api/cron/recovery-windows/route.ts")).not.toThrow();
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
