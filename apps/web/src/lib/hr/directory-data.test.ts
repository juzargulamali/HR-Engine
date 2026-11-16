import { describe, expect, it } from "vitest";
import { buildDirectoryExceptions, type DirectoryFacts, type DirectoryRow } from "./directory-data";
import { listAddress, safeListHref } from "@/components/workspace/list-memory";

const row = (over: Partial<DirectoryRow> & { id: string }): DirectoryRow => ({ employment_status: "active", company_id: "co1", country_code: "AE", job_title: "Technician", manager_id: "m1", deleted_at: null, ...over });
const none = (ids: string[]) => new Map(ids.map((i) => [i, 0]));
const facts = (over: Partial<DirectoryFacts> = {}): DirectoryFacts => ({
  contracts: none(["a", "b"]), compensation: none(["a", "b"]), identity: [], documents: [], opening: none(["a", "b"]), scheduled: none(["a", "b"]), linked: new Map(), ...over,
});
const keys = (m: Map<string, { key: string }[]>, id: string) => (m.get(id) ?? []).map((x) => x.key);

describe("buildDirectoryExceptions", () => {
  it("flags unfinished setup with a link to the first step, only for people the viewer manages", () => {
    const m = buildDirectoryExceptions([row({ id: "a" }), row({ id: "b", company_id: "other" })], facts(), (c) => c === "co1");
    expect(keys(m, "a")).toEqual(["setup"]);
    expect(m.get("a")![0]!.href).toBe("/employees/a?tab=employment&step=contract");
    expect(m.has("b")).toBe(false);
  });
  it("is quiet for a complete record and never says 'No manager' in a list", () => {
    const f = facts({ contracts: new Map([["a", 1]]), compensation: new Map([["a", 1]]), identity: [{ employee_id: "a", expiry_date: null }], linked: new Map([["a", "u1"]]) });
    expect(keys(buildDirectoryExceptions([row({ id: "a", manager_id: null })], f, () => true), "a")).toEqual([]);
  });
  it("hides a flag whose records could not be read instead of calling it to do", () => {
    const f = facts({ contracts: null, compensation: null, identity: null, documents: null, opening: null, scheduled: null });
    expect(keys(buildDirectoryExceptions([row({ id: "a" })], f, () => true), "a")).toEqual(["setup"]);   // only the account step is known
    const g = facts({ contracts: null, compensation: null, identity: null, documents: null, opening: null, scheduled: null, linked: new Map([["a", "u"]]) });
    expect(keys(buildDirectoryExceptions([row({ id: "a" })], g, () => true), "a")).toEqual([]);
  });
  it("flags documents by their expiry date and scheduled changes", () => {
    const complete = { contracts: new Map([["a", 1]]), compensation: new Map([["a", 1]]), linked: new Map([["a", "u"]]) };
    const past = buildDirectoryExceptions([row({ id: "a" })], facts({ ...complete, identity: [{ employee_id: "a", expiry_date: "2001-01-01" }] }), () => true);
    expect(keys(past, "a")).toEqual(["expired"]);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const near = buildDirectoryExceptions([row({ id: "a" })], facts({ ...complete, documents: [{ employee_id: "a", expiry_date: soon }], identity: [{ employee_id: "a", expiry_date: null }], scheduled: new Map([["a", 2]]) }), () => true);
    expect(keys(near, "a")).toEqual(["expiring", "scheduled"]);
  });
  it("says nothing for someone who has left or was removed", () => {
    const m = buildDirectoryExceptions([row({ id: "a", employment_status: "terminated" }), row({ id: "b", deleted_at: "2026-01-01" })], facts(), () => true);
    expect(keys(m, "a")).toEqual([]);
    expect(keys(m, "b")).toEqual([]);
  });
});

describe("returning from a profile to the directory", () => {
  it("remembers the search, company, status and page, and sends the back link to exactly that list", () => {
    const addr = listAddress("/employees", "q=E010&company=c1&status=active&page=2");
    expect(addr).toBe("/employees?q=E010&company=c1&status=active&page=2");
    expect(safeListHref(addr, "/employees")).toBe(addr);
    expect(safeListHref("/people-access?q=x", "/employees")).toBe("/employees");
  });
});
