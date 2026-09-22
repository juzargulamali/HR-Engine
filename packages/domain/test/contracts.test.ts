import { describe, expect, it } from "vitest";
import { resolveContractAsOf, type ContractVersionLike } from "../src/contracts";

const PROBATION: ContractVersionLike = { startDate: "2024-02-01", endDate: "2024-07-31", versionNo: 1 };
const PERMANENT: ContractVersionLike = { startDate: "2024-08-01", endDate: null, versionNo: 2 };
const HISTORY = [PROBATION, PERMANENT];

describe("resolveContractAsOf", () => {
  it("resolves a date inside the first (closed) version", () => {
    expect(resolveContractAsOf(HISTORY, "2024-05-01")).toBe(PROBATION);
  });

  it("resolves a date inside the second (open-ended) version", () => {
    expect(resolveContractAsOf(HISTORY, "2025-01-01")).toBe(PERMANENT);
  });

  it("is inclusive on both boundary dates", () => {
    expect(resolveContractAsOf(HISTORY, "2024-02-01")).toBe(PROBATION); // exact start
    expect(resolveContractAsOf(HISTORY, "2024-07-31")).toBe(PROBATION); // exact end
    expect(resolveContractAsOf(HISTORY, "2024-08-01")).toBe(PERMANENT); // next version starts same day
  });

  it("returns null before the earliest version starts", () => {
    expect(resolveContractAsOf(HISTORY, "2024-01-01")).toBeNull();
  });

  it("returns null inside a gap between versions", () => {
    const withGap: ContractVersionLike[] = [
      { startDate: "2024-01-01", endDate: "2024-03-31", versionNo: 1 },
      { startDate: "2024-05-01", endDate: null, versionNo: 2 },
    ];
    expect(resolveContractAsOf(withGap, "2024-04-15")).toBeNull();
  });

  it("prefers the higher version number if versions ever overlap (defensive, not the normal case)", () => {
    const overlapping: ContractVersionLike[] = [
      { startDate: "2024-01-01", endDate: "2024-12-31", versionNo: 1 },
      { startDate: "2024-06-01", endDate: "2024-12-31", versionNo: 2 },
    ];
    expect(resolveContractAsOf(overlapping, "2024-07-01")?.versionNo).toBe(2);
  });

  it("returns null for an empty history", () => {
    expect(resolveContractAsOf([], "2024-01-01")).toBeNull();
  });
});
