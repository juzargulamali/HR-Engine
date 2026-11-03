import { describe, expect, it } from "vitest";
import { failing, fakeSupabase, type FakeResult } from "@/test/fake-supabase";
import { loadDirectReportsNav } from "./direct-reports";

const client = (employees: FakeResult | (() => FakeResult)) => fakeSupabase({ employees }) as unknown as Parameters<typeof loadDirectReportsNav>[0];

describe("loadDirectReportsNav", () => {
  it("is false without an employee record, and without reading anything", async () => {
    expect(await loadDirectReportsNav(client(failing()), null)).toEqual({ hasDirectReports: false });
  });
  it("is true with at least one report, false with none", async () => {
    expect(await loadDirectReportsNav(client({ data: null, error: null, count: 3 }), "e1")).toEqual({ hasDirectReports: true });
    expect(await loadDirectReportsNav(client({ data: null, error: null, count: 0 }), "e1")).toEqual({ hasDirectReports: false });
  });
  it("a failed read keeps the entry and says the menu could not load", async () => {
    expect(await loadDirectReportsNav(client(failing()), "e1")).toEqual({ hasDirectReports: true, loadFailed: true });
  });
});
