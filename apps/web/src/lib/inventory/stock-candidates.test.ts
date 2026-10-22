import { describe, expect, it } from "vitest";
import { candidateBase, candidateMatches, cleanSearch, draftFromCandidate, unitProblemFor, whereText, type Candidate } from "./stock-candidates";

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
