import { describe, expect, it } from "vitest";
import { eventsScope } from "./scope";

const UAE = { id: "uae", name: "Enginious UAE" }; const KSA = { id: "ksa", name: "Enginious KSA" };

describe("the scope of the Events figures", () => {
  it("defaults to the viewer's current company", () => {
    expect(eventsScope([UAE, KSA], {})).toEqual({ companyId: "uae", label: "Enginious UAE", canChooseAll: true, all: false });
    expect(eventsScope([UAE, KSA], { company: "ksa" }).companyId).toBe("ksa");
  });
  it("All companies is offered only to a viewer with more than one company, and cannot be forced by the address", () => {
    expect(eventsScope([UAE, KSA], { scope: "all" })).toMatchObject({ companyId: null, all: true });
    expect(eventsScope([UAE], { scope: "all" })).toEqual({ companyId: "uae", label: "Enginious UAE", canChooseAll: false, all: false });
  });
  it("a company in the address that the viewer has no grant for falls back to their own", () => {
    expect(eventsScope([UAE], { company: "someone-elses" }).companyId).toBe("uae");
  });
  it("no company at all means no figures", () => {
    expect(eventsScope([], {}).companyId).toBeNull();
  });
});
