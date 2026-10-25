import { describe, expect, it } from "vitest";
import { pendingActionHref, removeFromPending, scanIntoList, scanProblemMessage, UNAVAILABLE_CODE_MESSAGE } from "./scan-list";

describe("pending list of scanned codes", () => {
  it("adds a code once, however it is written or how many times it is scanned", () => {
    let r = scanIntoList([], "UAE-E-00042");
    expect(r).toMatchObject({ added: true, code: "UAE-E-00042", problem: null });
    r = scanIntoList(r.list, "uae-e-00042");
    expect(r.added).toBe(false);
    r = scanIntoList(r.list, "https://os.example.com/inventory/scan?c=UAE-E-00042");
    expect(r.added).toBe(false);
    expect(r.list).toEqual([{ code: "UAE-E-00042", kind: "unit" }]);
  });
  it("keeps different units and bin labels as separate lines", () => {
    let list = scanIntoList([], "UAE-E-00042").list;
    list = scanIntoList(list, "UAE-E-00043").list;
    list = scanIntoList(list, "UAE-S-00007").list;
    expect(list.map((l) => l.code)).toEqual(["UAE-E-00042", "UAE-E-00043", "UAE-S-00007"]);
  });
  it("refuses something that is not an Inventory code and leaves the list alone", () => {
    const before = scanIntoList([], "UAE-E-00042").list;
    const r = scanIntoList(before, "https://example.com/pay?x=1");
    expect(r).toMatchObject({ added: false, code: null, problem: "not_inventory" });
    expect(r.list).toEqual(before);
    expect(scanIntoList([], "   ").problem).toBe("empty");
  });
  it("removes a line", () => {
    const list = [{ code: "UAE-E-00042", kind: "unit" as const }, { code: "UAE-E-00043", kind: "unit" as const }];
    expect(removeFromPending(list, "UAE-E-00042")).toEqual([{ code: "UAE-E-00043", kind: "unit" }]);
  });
  it("continues to the matching form with the codes in the address", () => {
    const list = [{ code: "UAE-E-00042", kind: "unit" as const }, { code: "UAE-S-00007", kind: "stock" as const }];
    expect(pendingActionHref("issue", list)).toBe("/inventory?action=issue&codes=UAE-E-00042,UAE-S-00007");
    expect(pendingActionHref("return", list)).toBe("/inventory?action=return&codes=UAE-E-00042,UAE-S-00007");
    expect(pendingActionHref("transfer", list)).toContain("action=transfer");
  });
  it("has one safe message that does not confirm existence", () => {
    expect(UNAVAILABLE_CODE_MESSAGE).toBe("This code is not available to you or does not exist.");
    expect(scanProblemMessage("not_inventory")).toMatch(/not an Enginious Inventory code/);
  });
});
