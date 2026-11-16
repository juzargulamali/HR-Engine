import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalEmployeeNumber, checkEmployeeNumber, duplicateEmployeeNumberMessage, employeeNumberErrorMessage, sameEmployeeNumber } from "./employee-number";

const vectors = JSON.parse(readFileSync(path.join(process.cwd(), "../../supabase/tests/employee-number-vectors.json"), "utf8")) as {
  vectors: { input: string; canonical: string }[]; equivalentGroups: string[][]; differentNumbers: string[][];
};

describe("employee number rule (the same vectors are run against the database function)", () => {
  it.each(vectors.vectors)("$input -> $canonical", ({ input, canonical }) => {
    expect(canonicalEmployeeNumber(input)).toBe(canonical);
  });
  it("the canonical form is stable: canonicalising it again changes nothing", () => {
    for (const v of vectors.vectors) expect(canonicalEmployeeNumber(v.canonical)).toBe(v.canonical);
  });
  it("E02, e002 and E002 are one number, saved as E002", () => {
    expect(sameEmployeeNumber("E02", "e002")).toBe(true);
    expect(sameEmployeeNumber("e002", "E002")).toBe(true);
    expect(canonicalEmployeeNumber("E02")).toBe("E002");
  });
  it("every equivalence group collapses to one number, and the different numbers stay different", () => {
    for (const g of vectors.equivalentGroups) expect(new Set(g.map(canonicalEmployeeNumber)).size).toBe(1);
    for (const [a, b] of vectors.differentNumbers) expect(sameEmployeeNumber(a!, b!)).toBe(false);
  });
});

describe("checkEmployeeNumber", () => {
  it("gives the canonical form to save, and refuses an empty or over-long entry in words", () => {
    expect(checkEmployeeNumber(" e02 ")).toEqual({ ok: true, canonical: "E002" });
    expect(checkEmployeeNumber("   ")).toEqual({ ok: false, message: "Enter the employee number." });
    expect(checkEmployeeNumber("X".repeat(41))).toMatchObject({ ok: false });
    expect(checkEmployeeNumber("X".repeat(40))).toMatchObject({ ok: true });
  });
});

describe("duplicate-number sentences", () => {
  it("name the canonical number, say it is shared across companies and what counts as the same number; say what was typed when that differs", () => {
    expect(duplicateEmployeeNumberMessage("E02", "E002")).toBe("Employee number E002 is reserved for another employee (current, removed or former), in this or another company. E02 is the same number as E002. Numbers that differ only in capitals, spaces or leading zeros are the same number, and a number is never reused. Use a different number.");
    expect(duplicateEmployeeNumberMessage("E002", "E002")).toBe("Employee number E002 is reserved for another employee (current, removed or former), in this or another company. Numbers that differ only in capitals, spaces or leading zeros are the same number, and a number is never reused. Use a different number.");
  });
  it("a database duplicate is shown as the database's own sentence; a bare duplicate gets a plain one; other errors pass through", () => {
    expect(employeeNumberErrorMessage({ code: "23505", message: "Employee number E002 is reserved for another employee." })).toBe("Employee number E002 is reserved for another employee.");
    expect(employeeNumberErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "x"' })).toBe("That employee number is reserved for another employee, in this or another company. Nothing was saved.");
    expect(employeeNumberErrorMessage({ code: "42501", message: "denied" })).toBe("denied");
  });
});
