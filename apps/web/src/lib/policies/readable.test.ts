import { describe, expect, it } from "vitest";
import { ownCountryFirst, policyTitle, readablePayload } from "./readable";

describe("policies in plain words for staff", () => {
  it("names the policy types in words", () => {
    expect(policyTitle("leave_rules")).toBe("Leave rules");
    expect(policyTitle("overtime_rules")).toBe("Overtime and Recovery Leave");
    expect(policyTitle("something_new")).toBe("Something new");
  });
  it("turns the stored values into label and value lines with no JSON, and leaves out only bookkeeping", () => {
    const facts = readablePayload({ default_days: 30, note: "A fallback default.", phase2b_seed_marker: "x", tiers: [{ min_service_months: 0, notice: "2 weeks" }, { min_service_months: 6, notice: "1 month" }], paid: true, days: ["Fri", "Sat"] });
    expect(facts).toEqual([
      { label: "Default days", value: "30" },
      { label: "Note", value: "A fallback default." },
      { label: "Tiers", value: "Min service months 0, Notice 2 weeks; Min service months 6, Notice 1 month" },
      { label: "Paid", value: "Yes" },
      { label: "Days", value: "Fri, Sat" },
    ]);
    for (const f of facts) expect(f.value).not.toMatch(/[{}\[\]]/);
  });
  it("says nothing for a payload that is not an object, and hides the machine-readable Recovery Leave rules", () => {
    expect(readablePayload(null)).toEqual([]);
    expect(readablePayload([1, 2])).toEqual([]);
    expect(readablePayload({ model: "recovery_windows", rules: { windowHours: 24 }, wording: "x", statutory_safeguard: "y" })).toEqual([]);
  });
  it("puts the person's own country first and the others after, by name", () => {
    const items = [{ country_code: "SA", countryName: "Saudi Arabia" }, { country_code: "PL", countryName: "Poland" }, { country_code: "AE", countryName: "United Arab Emirates" }];
    const r = ownCountryFirst(items, "AE");
    expect(r.own.map((i) => i.country_code)).toEqual(["AE"]);
    expect(r.others.map((i) => i.country_code)).toEqual(["PL", "SA"]);
    expect(ownCountryFirst(items, null).own).toEqual([]);
  });
});
