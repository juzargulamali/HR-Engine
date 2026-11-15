import { describe, expect, it } from "vitest";
import { companyDisplayNames, companyGroup, sortCompaniesForDisplay } from "./company-display";

const co = (id: string, legalName: string, countryCode: string | null) => ({ id, legalName, countryCode });

describe("company display names", () => {
  it("names the three companies by their country, whatever the legal name says", () => {
    const names = companyDisplayNames([co("a", "Fictional Enginious LLC", "AE"), co("b", "Fictional Enginious Dubai-Europe sp. z o.o.", "PL"), co("c", "Fictional Enginious Arabia", "sa")]);
    expect([names.get("a"), names.get("b"), names.get("c")]).toEqual(["Enginious UAE", "Enginious Europe", "Enginious Saudi Arabia"]);
  });
  it("never gives two companies the same short name: both keep their legal names", () => {
    const names = companyDisplayNames([co("a", "Fictional Enginious LLC", "AE"), co("b", "Fictional Enginious FZ", "AE"), co("c", "Fictional Enginious Arabia", "SA")]);
    expect([names.get("a"), names.get("b"), names.get("c")]).toEqual(["Fictional Enginious LLC", "Fictional Enginious FZ", "Enginious Saudi Arabia"]);
  });
  it("keeps the legal name of a company in a country outside the list, and of one without a country", () => {
    const names = companyDisplayNames([co("a", "Fictional Enginious Inc", "US"), co("b", "Fictional Enginious Ltd", null)]);
    expect([names.get("a"), names.get("b")]).toEqual(["Fictional Enginious Inc", "Fictional Enginious Ltd"]);
    expect(companyGroup("us")).toBeNull();
    expect(companyGroup(" de ")).toBe("europe");
  });
  it("lists UAE, Saudi Arabia, Europe, then the others by name", () => {
    const sorted = sortCompaniesForDisplay([co("z", "Zeta", "US"), co("e", "Europe one", "PL"), co("k", "Arabia", "SA"), co("u", "LLC", "AE"), co("y", "Alpha", "US")]);
    expect(sorted.map((c) => c.id)).toEqual(["u", "k", "e", "y", "z"]);
  });
});
