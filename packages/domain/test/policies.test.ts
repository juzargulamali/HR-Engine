import { describe, expect, it } from "vitest";
import { resolvePolicyVersionAsOf, type PolicyVersionLike } from "../src/policies";

const V1: PolicyVersionLike = { effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", versionNo: 1, status: "superseded" };
const V2: PolicyVersionLike = { effectiveFrom: "2026-01-01", effectiveTo: null, versionNo: 2, status: "active" };

describe("resolvePolicyVersionAsOf", () => {
  it("resolves the active version covering a date", () => {
    expect(resolvePolicyVersionAsOf([V1, V2], "2026-06-01")).toBe(V2);
  });

  it("never matches a non-active version, even if its date range covers asOf", () => {
    // V1 covers 2025-06-01 but is superseded — a superseded row must never
    // be treated as "in effect," matching resolve_policy()'s own
    // `status = 'active'` filter exactly.
    expect(resolvePolicyVersionAsOf([V1, V2], "2025-06-01")).toBeNull();
  });

  it("is inclusive on both boundary dates", () => {
    expect(resolvePolicyVersionAsOf([V2], "2026-01-01")).toBe(V2);
  });

  it("returns null when nothing covers the date", () => {
    expect(resolvePolicyVersionAsOf([V1, V2], "2024-01-01")).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(resolvePolicyVersionAsOf([], "2026-01-01")).toBeNull();
  });

  it("prefers the higher version number if active versions ever overlap (defensive)", () => {
    const overlapping: PolicyVersionLike[] = [
      { effectiveFrom: "2026-01-01", effectiveTo: null, versionNo: 1, status: "active" },
      { effectiveFrom: "2026-06-01", effectiveTo: null, versionNo: 2, status: "active" },
    ];
    expect(resolvePolicyVersionAsOf(overlapping, "2026-07-01")?.versionNo).toBe(2);
  });
});
