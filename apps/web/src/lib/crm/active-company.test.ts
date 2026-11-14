import { describe, expect, it } from "vitest";
import { chooseSalesCompany } from "./active-company";

const EU = { id: "11111111-1111-4111-8111-111111111111", name: "Enginious Europe" };
const KSA = { id: "22222222-2222-4222-8222-222222222222", name: "Enginious KSA" };
const UAE = { id: "33333333-3333-4333-8333-333333333333", name: "Enginious UAE" };
const ALL = [EU, KSA, UAE]; // ordered by name, as the context returns them: Europe is first

describe("the active Sales company", () => {
  it("never falls back to the first company by name: with several and nothing to go on it asks the person to choose", () => {
    expect(chooseSalesCompany(ALL)).toEqual({ company: null, from: "choose" });
    expect(chooseSalesCompany(ALL, { asked: null, remembered: undefined, home: null })).toEqual({ company: null, from: "choose" });
  });
  it("prefers the current context, then the last company used, then the person's own employing company", () => {
    expect(chooseSalesCompany(ALL, { asked: UAE.id, remembered: KSA.id, home: EU.id })).toEqual({ company: UAE, from: "context" });
    expect(chooseSalesCompany(ALL, { remembered: KSA.id, home: EU.id })).toEqual({ company: KSA, from: "remembered" });
    expect(chooseSalesCompany(ALL, { home: UAE.id })).toEqual({ company: UAE, from: "home" });
  });
  it("uses the only company when there is one, and says so when there is none", () => {
    expect(chooseSalesCompany([UAE])).toEqual({ company: UAE, from: "only" });
    expect(chooseSalesCompany([])).toEqual({ company: null, from: "none" });
  });
  it("ignores a company the person has no Sales access to, wherever it comes from, and anything that is not a company id", () => {
    const other = "44444444-4444-4444-8444-444444444444";
    expect(chooseSalesCompany(ALL, { asked: other, remembered: UAE.id })).toEqual({ company: UAE, from: "remembered" });   // a stale address does not win
    expect(chooseSalesCompany(ALL, { remembered: other, home: other })).toEqual({ company: null, from: "choose" });        // access removed since the cookie was set
    expect(chooseSalesCompany(ALL, { asked: "'; drop table", remembered: "all" })).toEqual({ company: null, from: "choose" });
    expect(chooseSalesCompany([UAE], { asked: other })).toEqual({ company: UAE, from: "only" });
  });
});
