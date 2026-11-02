import { describe, expect, it } from "vitest";
import { appliedMessage, applyConditionToLines } from "./return-condition";

describe("setting one condition for several ticked lines", () => {
  const lines = [{ key: "u1", individual: true }, { key: "u2", individual: true }, { key: "c1", individual: false }];
  it("writes the chosen condition onto exactly the lines given and keeps every other line as it was", () => {
    const r = applyConditionToLines({ u3: "damaged", u1: "fair" }, lines, "good");
    expect(r.next).toEqual({ u3: "damaged", u1: "good", u2: "good", c1: "good" });
    expect(r.applied).toBe(3);
    expect(r.skipped).toBe(0);
  });
  it("leaves lines alone when the condition does not exist for them (counted stock has no Fair)", () => {
    const r = applyConditionToLines({ c1: "damaged" }, lines, "fair");
    expect(r.next).toEqual({ c1: "damaged", u1: "fair", u2: "fair" });
    expect([r.applied, r.skipped]).toEqual([2, 1]);
    expect(appliedMessage("fair", r.applied, r.skipped)).toMatch(/Fair set on 2 lines\. 1 line was left as it was: counted stock has no “Fair”/);
  });
  it("with nothing chosen it changes nothing at all (there is never a default)", () => {
    const r = applyConditionToLines({ u1: "damaged" }, lines, "");
    expect(r.next).toEqual({ u1: "damaged" });
    expect(r.applied).toBe(0);
  });
  it("applies to no line when none is ticked", () => {
    expect(applyConditionToLines({}, [], "good").next).toEqual({});
  });
});
