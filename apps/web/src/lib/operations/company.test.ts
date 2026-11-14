import { describe, expect, it } from "vitest";
import { choosePermittedCompany } from "./company";

const A = "00000000-0000-4000-8000-00000000a001";
const B = "00000000-0000-4000-8000-00000000a002";
const C = "00000000-0000-4000-8000-00000000a003";
const companies = [{ id: A, name: "Alpha" }, { id: B, name: "Beta" }];

describe("Operations company choice", () => {
  it("the address wins when it is a company the person manages", () => {
    expect(choosePermittedCompany(companies, B, A)).toMatchObject({ company: { id: B }, from: "address" });
  });
  it("the remembered company is restored only while it is still permitted", () => {
    expect(choosePermittedCompany(companies, undefined, B)).toMatchObject({ company: { id: B }, from: "remembered" });
    expect(choosePermittedCompany(companies, undefined, C)).toMatchObject({ company: { id: A }, from: "default" });
  });
  it("a company that is not theirs, or not an id at all, is ignored and the default is used", () => {
    expect(choosePermittedCompany(companies, C, "nonsense")).toMatchObject({ company: { id: A }, from: "default" });
    expect(choosePermittedCompany(companies, "'; drop table x; --", null)).toMatchObject({ company: { id: A }, from: "default" });
  });
  it("nobody to show when the person manages no company", () => {
    expect(choosePermittedCompany([], A, B)).toEqual({ company: null, from: "none" });
  });
});
