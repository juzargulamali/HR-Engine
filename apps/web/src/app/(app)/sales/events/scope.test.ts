import { describe, expect, it } from "vitest";
import { chooseSalesCompany } from "@/lib/crm/active-company";
import { address, eventsScope, scopeParams } from "./scope";

const UAE = { id: "11111111-1111-4111-8111-111111111111", name: "Enginious UAE" };
const EUROPE = { id: "22222222-2222-4222-8222-222222222222", name: "Enginious Europe" };
const both = [EUROPE, UAE]; // A to Z: Europe is "the first by name"
const active = (company: typeof UAE | null, from: "context" | "remembered" | "home" | "only" | "choose" | "none" = "context") => ({ company, from });

describe("the scope of the Events figures", () => {
  it("counts for the resolved active company, not the first company by name", () => {
    expect(eventsScope(both, {}, active(UAE, "home"))).toEqual({ companyId: UAE.id, label: "Enginious UAE", canChooseAll: true, all: false, choose: false });
    expect(eventsScope(both, { company: EUROPE.id }, active(EUROPE)).companyId).toBe(EUROPE.id);
  });
  it("a person employed in the UAE with access to both opens Events in the UAE", () => {
    const resolved = chooseSalesCompany(both, { home: UAE.id });
    expect(eventsScope(both, {}, resolved)).toMatchObject({ companyId: UAE.id, label: "Enginious UAE", choose: false });
  });
  it("several companies and no reliable default: nothing is picked, the person is asked to choose", () => {
    const resolved = chooseSalesCompany(both, {});
    expect(resolved).toEqual({ company: null, from: "choose" });
    expect(eventsScope(both, {}, resolved)).toEqual({ companyId: null, label: "no company chosen", canChooseAll: true, all: false, choose: true });
  });
  it("All my companies is offered only to a viewer with more than one company, and cannot be forced by the address", () => {
    expect(eventsScope(both, { scope: "all" }, active(UAE))).toEqual({ companyId: null, label: "All your companies", canChooseAll: true, all: true, choose: false });
    expect(eventsScope(both, { scope: "all" }, active(null, "choose"))).toMatchObject({ all: true, choose: false });
    expect(eventsScope([UAE], { scope: "all" }, active(UAE, "only"))).toEqual({ companyId: UAE.id, label: "Enginious UAE", canChooseAll: false, all: false, choose: false });
  });
  it("a company the viewer has no grant for is never used", () => {
    expect(eventsScope([UAE], {}, active({ id: "33333333-3333-4333-8333-333333333333", name: "Someone else's" })).companyId).toBeNull();
    expect(eventsScope(both, {}, active({ id: "33333333-3333-4333-8333-333333333333", name: "Someone else's" }))).toMatchObject({ companyId: null, choose: true });
  });
  it("no company at all means no figures", () => {
    expect(eventsScope([], {}, active(null, "none"))).toMatchObject({ companyId: null, choose: false, all: false });
  });
});

describe("links between the Events pages", () => {
  it("carry the company, or All my companies, and nothing when there is neither", () => {
    expect(scopeParams({ companyId: UAE.id, all: false })).toEqual({ company: UAE.id });
    expect(scopeParams({ companyId: null, all: true })).toEqual({ scope: "all" });
    expect(scopeParams({ companyId: null, all: false })).toEqual({});
  });
  it("an address leaves out empty values", () => {
    expect(address("/sales/events", { company: UAE.id, q: "", view: "calendar", month: undefined })).toBe(`/sales/events?company=${UAE.id}&view=calendar`);
    expect(address("/sales/events", {})).toBe("/sales/events");
  });
});
