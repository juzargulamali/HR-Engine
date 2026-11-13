import { describe, expect, it } from "vitest";
import { moveAnnouncement, moveId, parseQuickRows, QUICK_ADD_MAX, reorderIds } from "./ordering";

describe("parseQuickRows", () => {
  it("reads a pasted Excel list (name TAB quantity), a typed list, and every common way of writing a quantity", () => {
    const { rows, skipped } = parseQuickRows("Batak unit\t4\nPower distribution box\t2\r\nNetwork switch x 1\n12 x Spare sensors\nFlight case ×3\n\n   \nCable ties");
    expect(rows).toEqual([
      { name: "Batak unit", qty: "4" }, { name: "Power distribution box", qty: "2" }, { name: "Network switch", qty: "1" },
      { name: "Spare sensors", qty: "12" }, { name: "Flight case", qty: "3" }, { name: "Cable ties", qty: "" },
    ]);
    expect(skipped).toBe(0);
  });
  it("does not guess: a name with a number in it stays whole, a bad or zero quantity is left empty, a decimal comma is a decimal", () => {
    expect(parseQuickRows("2x4 timber\nUSB-C cable 2m\nPlinth\t0\nFoam\t1,5\nTape\tmany").rows).toEqual([
      { name: "2x4 timber", qty: "" }, { name: "USB-C cable 2m", qty: "" }, { name: "Plinth", qty: "" }, { name: "Foam", qty: "1.5" }, { name: "Tape", qty: "" },
    ]);
  });
  it("keeps extra pasted columns out of the name and stops at the limit, saying so", () => {
    expect(parseQuickRows("Batak unit\t4\tnotes here").rows[0]).toEqual({ name: "Batak unit", qty: "4" });
    const many = parseQuickRows(Array.from({ length: QUICK_ADD_MAX + 5 }, (_, n) => `Row ${n}`).join("\n"));
    expect(many.rows).toHaveLength(QUICK_ADD_MAX);
    expect(many.truncated).toBe(true);
    expect(parseQuickRows("").rows).toEqual([]);
  });
});

describe("reordering", () => {
  const ids = ["a", "b", "c", "d"];
  it("moves one id to a place, clamps, and returns an equal list when nothing moves", () => {
    expect(reorderIds(ids, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(reorderIds(ids, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(reorderIds(ids, 1, 99)).toEqual(["a", "c", "d", "b"]);
    expect(reorderIds(ids, 2, 2)).toEqual(ids);
    expect(reorderIds(ids, 9, 0)).toEqual(ids);
    expect(ids).toEqual(["a", "b", "c", "d"]);                    // the input is never changed
  });
  it("one step up or down, and not past either end", () => {
    expect(moveId(ids, "c", -1)).toEqual(["a", "c", "b", "d"]);
    expect(moveId(ids, "c", 1)).toEqual(["a", "b", "d", "c"]);
    expect(moveId(ids, "a", -1)).toEqual(ids);
    expect(moveId(ids, "d", 1)).toEqual(ids);
    expect(moveId(ids, "zz", 1)).toEqual(ids);
  });
  it("announces the new position", () => expect(moveAnnouncement("L0003", 2, 5)).toBe("L0003 moved to position 2 of 5."));
});
