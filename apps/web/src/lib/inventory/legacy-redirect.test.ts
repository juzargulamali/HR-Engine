import { describe, expect, it } from "vitest";
import { carryParams, legacyStockTarget } from "./legacy-redirect";

describe("old /inventory links", () => {
  it("send a printed label's panel, an action, and a request's deep link to the stock list with every parameter kept", () => {
    expect(legacyStockTarget({ unit: "u1" })).toBe("/inventory/stock?unit=u1");
    expect(legacyStockTarget({ open: "item-1", bin: "UAE-S-00007" })).toBe("/inventory/stock?open=item-1&bin=UAE-S-00007");
    expect(legacyStockTarget({ action: "dispatch", request: "r1", project: "p1" })).toBe("/inventory/stock?action=dispatch&request=r1&project=p1");
    expect(legacyStockTarget({ q: "laptop", location: "dxb" })).toBe("/inventory/stock?q=laptop&location=dxb");
  });
  it("leave Today alone (its own parameters are not the stock list's)", () => {
    expect(legacyStockTarget({})).toBeNull();
    expect(legacyStockTarget({ location: "dxb", show: "send" })).toBeNull();
    expect(legacyStockTarget({ action: "" })).toBeNull();
  });
  it("keep repeated parameters", () => {
    expect(legacyStockTarget({ category: ["a", "b"] })).toBe("/inventory/stock?category=a&category=b");
  });
  it("carry the parameters of the old movements and employees addresses", () => {
    expect(carryParams("/inventory/history", { open: "m1" })).toBe("/inventory/history?open=m1");
    expect(carryParams("/inventory/stock", { employee: "e1" }, { view: "people" })).toBe("/inventory/stock?view=people&employee=e1");
    expect(carryParams("/inventory/history", {})).toBe("/inventory/history");
  });
});
