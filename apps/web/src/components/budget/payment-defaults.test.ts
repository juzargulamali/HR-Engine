import { describe, expect, it } from "vitest";
import { effectivePayment, followsDefault, inheritWhereSame, initialDefault, type PayLine } from "./payment-defaults";

const line = (actual: string, paid_via: PayLine["paid_via"] = "", paid_by = ""): PayLine => ({ actual, paid_via, paid_by });

describe("payment defaults for the actual expenses", () => {
  it("starts from the most common payment of the lines that have an amount, else from the person entering", () => {
    expect(initialDefault([line("10", "personal", "u1"), line("5", "personal", "u1"), line("7", "company_card"), line("0", "advance", "u2")], "pm")).toEqual({ via: "personal", by: "u1" });
    expect(initialDefault([line(""), line("0")], "pm")).toEqual({ via: "", by: "pm" });
  });
  it("lets a line follow the default until it sets its own source", () => {
    const def = { via: "personal" as const, by: "pm" };
    expect(effectivePayment(line("10"), def)).toEqual({ via: "personal", by: "pm" });
    expect(effectivePayment(line("10", "company_card"), def)).toEqual({ via: "company_card", by: "" });
    expect(effectivePayment(line("10", "advance", "u3"), def)).toEqual({ via: "advance", by: "u3" });
    expect(effectivePayment(line("10", "advance"), def)).toEqual({ via: "advance", by: "pm" });
    expect(followsDefault(line("10"), def)).toBe(true);
    expect(followsDefault(line("10", "advance"), def)).toBe(false);
    expect(followsDefault(line("10"), { via: "", by: "pm" })).toBe(false);
  });
  it("makes saved lines that match the default follow it, and leaves the others and the zero lines alone", () => {
    const def = { via: "personal" as const, by: "u1" };
    const out = inheritWhereSame([line("10", "personal", "u1"), line("4", "company_card"), line("0", "personal", "u1")], def);
    expect(out.map((l) => [l.paid_via, l.paid_by])).toEqual([["", ""], ["company_card", ""], ["personal", "u1"]]);
  });
});
