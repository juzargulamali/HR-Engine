import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Vercel reads cron definitions ONLY from vercel.json in the project's Root Directory. Production's Root Directory is apps/web, so a vercel.json at the repository
// root is never read: jobs listed there look registered and are not. These tests pin the one place the definitions live, and that each registered job is one
// Vercel's session-less call can actually reach. Registering a job is a decision about Production writes: it is made by adding a line here, in a reviewed change.
const REPO = path.resolve(import.meta.dirname, "../../..");
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");
const { crons } = JSON.parse(read("apps/web/vercel.json")) as { crons: { path: string; schedule: string }[] };

/** The paths the proxy lets past the sign-in redirect, read from its source (a cron call carries no session). */
const publicPaths = (() => {
  const m = read("apps/web/src/proxy.ts").match(/const PUBLIC_PATHS = \[([^\]]*)\]/);
  return m ? [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!) : [];
})();

describe("Vercel cron registration (apps/web/vercel.json)", () => {
  it("lives under the deployed app's Root Directory and nowhere else: there is no vercel.json at the repository root that would look registered and not be", () => {
    expect(existsSync(path.join(REPO, "vercel.json"))).toBe(false);
    expect(crons.length).toBeGreaterThan(0);
  });

  it("registers each job once", () => {
    const paths = crons.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("registers /api/cron/employment-changes daily at 00:45 UTC", () => {
    expect(crons.filter((c) => c.path === "/api/cron/employment-changes")).toEqual([{ path: "/api/cron/employment-changes", schedule: "45 0 * * *" }]);
  });

  it("every registered job has a route file that checks the cron secret", () => {
    for (const c of crons) {
      const file = `apps/web/src/app${c.path}/route.ts`;
      expect(existsSync(path.join(REPO, file)), `${c.path}: ${file} is missing`).toBe(true);
      expect(read(file), `${c.path} does not check the cron secret`).toContain("isAuthorizedCronRequest");
    }
  });

  it("every registered job is reachable without a session (listed in the proxy's PUBLIC_PATHS), so a registered job cannot silently land on the sign-in page", () => {
    expect(publicPaths).toContain("/api/cron/employment-changes");
    for (const c of crons) expect(publicPaths, `${c.path} would be redirected to /login`).toContain(c.path);
  });

  it("every schedule is one fixed minute of one fixed hour, at most once a day (the Hobby plan's limit)", () => {
    for (const c of crons) {
      const [minute, hour] = c.schedule.split(" ");
      expect(minute, c.path).toMatch(/^\d+$/);
      expect(hour, c.path).toMatch(/^\d+$/);
    }
  });
});
