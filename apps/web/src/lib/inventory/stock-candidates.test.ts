import { describe, expect, it } from "vitest";
import { candidateBase, candidateMatches, cleanSearch, countStillOutstanding, draftFromCandidate, unitProblemFor, whereText, type Candidate } from "./stock-candidates";

const unit = (over: Partial<Candidate> = {}): Candidate =>
  candidateBase({ key: "u1", type: "unit", unitId: "unit-1", code: "UAE-E-00042", itemId: "i1", itemName: "Laptop X1", lifecycle: "active", custody: "warehouse", where: "In the warehouse: Dubai", ...over });
const counted = (over: Partial<Candidate> = {}): Candidate =>
  candidateBase({ key: "b1", type: "counted", code: "UAE-S-00007", itemId: "i2", itemName: "XLR cable", tracking: "quantity", qty: 20, binId: "bin-a", binLabel: "A1", condition: "good", where: "bin A1", ...over });

describe("draftFromCandidate", () => {
  it("a counted row never fills in a quantity, even when the whole bin is known", () => {
    const d = draftFromCandidate(counted(), "issue", "x");
    expect(d.qty).toBe("");
    expect(d.maxQty).toBe(20);
    expect(d.binId).toBe("bin-a");
    expect(d.unitId).toBeNull();
  });
  it("a unit becomes a unit line with its code", () => {
    const d = draftFromCandidate(unit(), "issue", "x");
    expect(d).toMatchObject({ unitId: "unit-1", code: "UAE-E-00042", binId: "" });
  });
  it("returns default to good, so one click completes the check", () => {
    expect(draftFromCandidate(unit({ custody: "employee" }), "return", "x").condition).toBe("good");
    expect(draftFromCandidate(counted(), "return", "x").condition).toBe("good");
  });
  it("a condition check and a transfer arrival start from what it is now", () => {
    expect(draftFromCandidate(unit({ condition: "needs_inspection" }), "check", "x").condition).toBe("needs_inspection");
    expect(draftFromCandidate(counted({ condition: "damaged" }), "receive_transfer", "x")).toMatchObject({ condition: "damaged", fromCondition: "damaged" });
  });
});

describe("unitProblemFor", () => {
  it("lets a usable unit on the shelf be issued", () => {
    expect(unitProblemFor("issue", unit())).toBeNull();
    expect(unitProblemFor("issue", unit({ condition: "fair" }))).toBeNull();
  });
  it("says in words why a unit cannot be used", () => {
    expect(unitProblemFor("issue", unit({ lifecycle: "draft" }))).toMatch(/not been counted/);
    expect(unitProblemFor("dispatch", unit({ lifecycle: "missing" }))).toMatch(/missing/);
    expect(unitProblemFor("dispatch", unit({ lifecycle: "retired" }))).toMatch(/retired/);
    expect(unitProblemFor("issue", unit({ custody: "employee", where: "With an employee: Sara" }))).toMatch(/not on the shelf: with an employee/);
    expect(unitProblemFor("issue", unit({ inKit: true }))).toMatch(/packed in a kit/);
    expect(unitProblemFor("issue", unit({ condition: "damaged" }))).toMatch(/damaged and is held back/);
  });
  it("holds back by condition only for kinds that need usable equipment", () => {
    expect(unitProblemFor("check", unit({ condition: "damaged" }))).toBeNull();
    expect(unitProblemFor("repair_out", unit({ condition: "damaged" }))).toBeNull();
  });
  it("accepts a returned unit whoever holds it, and repair-in only for units at the repairer", () => {
    expect(unitProblemFor("return", unit({ custody: "employee" }))).toBeNull();
    expect(unitProblemFor("repair_in", unit({ custody: "repair" }))).toBeNull();
    expect(unitProblemFor("repair_in", unit())).toMatch(/not out for repair/);
    expect(unitProblemFor("adjust", unit({ lifecycle: "missing" }))).toMatch(/missing/);
  });
  it("lets equipment that went out and never came back be marked missing, but not retired or moved, from where it was sent", () => {
    expect(unitProblemFor("adjust", unit({ custody: "project", where: "On a project: P-1" }), "missing")).toBeNull();
    expect(unitProblemFor("adjust", unit({ custody: "employee", where: "With an employee: Sara" }), "missing")).toBeNull();
    expect(unitProblemFor("adjust", unit({ custody: "project", where: "On a project: P-1" }), "retire")).toMatch(/not on the shelf/);
    expect(unitProblemFor("dispatch", unit({ custody: "project", where: "On a project: P-1" }))).toMatch(/not on the shelf/);
  });
  it("never blocks counted rows here", () => {
    expect(unitProblemFor("issue", counted())).toBeNull();
  });
});

describe("whereText", () => {
  it("says where something is in plain words", () => {
    expect(whereText({ custody: "warehouse", lifecycle: "active", binLabel: "A1", employeeName: null, projectName: null, repairReference: null, inKit: false }, "Dubai")).toBe("In the warehouse: Dubai, bin A1");
    expect(whereText({ custody: "employee", lifecycle: "active", binLabel: null, employeeName: "Sara Ali", projectName: null, repairReference: null, inKit: false })).toBe("With an employee: Sara Ali");
    expect(whereText({ custody: "repair", lifecycle: "active", binLabel: null, employeeName: null, projectName: null, repairReference: "JOB-1", inKit: false })).toBe("Out for repair (JOB-1)");
    expect(whereText({ custody: "warehouse", lifecycle: "draft", binLabel: null, employeeName: null, projectName: null, repairReference: null, inKit: false })).toBe("Not counted yet");
  });
});

describe("search", () => {
  it("makes typed text safe for a filter", () => {
    expect(cleanSearch("  a%b,c(d)  e*  ")).toBe("a b c d e");
    expect(cleanSearch("x".repeat(200))).toHaveLength(60);
  });
  it("matches every word against name, detail, code, serial, bin and place", () => {
    const c = unit({ serial: "SN-77", detail: "5 m" });
    expect(candidateMatches(c, "laptop 77")).toBe(true);
    expect(candidateMatches(c, "uae-e-00042")).toBe(true);
    expect(candidateMatches(c, "laptop zzz")).toBe(false);
    expect(candidateMatches(c, "   ")).toBe(true);
    expect(candidateMatches(counted(), "a1 xlr")).toBe(true);
  });
});

describe("countStillOutstanding (what a partial return leaves with the holder)", () => {
  const held = [unit(), unit({ key: "u2", unitId: "unit-2", code: "UAE-E-00043" }), counted({ qty: 4 })];
  const line = (over: Record<string, string | null>) => ({ unitId: null as string | null, itemId: "i2", binId: "bin-a", qty: "", ...over });
  it("counts units and quantities that are not listed at all", () => {
    expect(countStillOutstanding(held, [])).toBe(3);
    expect(countStillOutstanding(held, [line({ unitId: "unit-1", itemId: "i1", binId: "" })])).toBe(2);
  });
  it("a quantity returned in part (3 of 4) still has the rest outstanding, a full one does not", () => {
    const units = [line({ unitId: "unit-1", itemId: "i1", binId: "" }), line({ unitId: "unit-2", itemId: "i1", binId: "" })];
    expect(countStillOutstanding(held, [...units, line({ qty: "3" })])).toBe(1);
    expect(countStillOutstanding(held, [...units, line({ qty: "4" })])).toBe(0);
    expect(countStillOutstanding(held, [...units, line({ qty: "" })])).toBe(1); // nothing typed yet: nothing is coming back
  });
});
