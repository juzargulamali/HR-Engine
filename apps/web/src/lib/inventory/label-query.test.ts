import { describe, expect, it } from "vitest";
import { labelsHref, MAX_LABELS, parseLabelQuery, parseLabelSize } from "./label-query";

const ID = "3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607";

describe("labels page address", () => {
  it("reads a comma separated list of codes and the size", () => {
    const q = parseLabelQuery({ codes: "UAE-E-00042,uae-e-00043, UAE-S-00007", size: "large" });
    expect(q.codes).toEqual(["UAE-E-00042", "UAE-E-00043", "UAE-S-00007"]);
    expect(q.size).toBe("large");
    expect(q.invalid).toEqual([]);
  });
  it("lists a repeated code once and reports what is not a code", () => {
    const q = parseLabelQuery({ codes: "UAE-E-00042,UAE-E-00042,hello,https://x.example/inventory/scan?c=UAE-E-00050" });
    expect(q.codes).toEqual(["UAE-E-00042", "UAE-E-00050"]);
    expect(q.invalid).toEqual(["hello"]);
  });
  it("falls back to the medium size for anything else", () => {
    expect(parseLabelQuery({}).size).toBe("medium");
    expect(parseLabelQuery({ size: "huge" }).size).toBe("medium");
    expect(parseLabelSize("small")).toBe("small");
  });
  it("accepts a whole item or location by id and refuses a malformed one", () => {
    expect(parseLabelQuery({ item: ID })).toMatchObject({ itemId: ID, locationId: null, badId: false });
    expect(parseLabelQuery({ location: ID })).toMatchObject({ locationId: ID, itemId: null, badId: false });
    expect(parseLabelQuery({ item: "not-an-id" })).toMatchObject({ itemId: null, badId: true });
  });
  it("takes the first value when a parameter is repeated", () => {
    expect(parseLabelQuery({ codes: ["UAE-E-00001", "UAE-E-00002"] }).codes).toEqual(["UAE-E-00001"]);
  });
  it("stops at one sheet's worth of labels and says so", () => {
    const codes = Array.from({ length: MAX_LABELS + 5 }, (_, i) => `UAE-E-${String(i + 1).padStart(5, "0")}`).join(",");
    const q = parseLabelQuery({ codes });
    expect(q.codes).toHaveLength(MAX_LABELS);
    expect(q.truncated).toBe(true);
  });
  it("builds the address of the same sheet in another size", () => {
    const q = parseLabelQuery({ codes: "UAE-E-00042,UAE-E-00043", item: ID });
    expect(labelsHref(q, "small")).toBe(`/inventory/labels?codes=UAE-E-00042,UAE-E-00043&item=${ID}&size=small`);
  });
});
