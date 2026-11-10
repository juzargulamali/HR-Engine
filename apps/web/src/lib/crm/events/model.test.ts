import { describe, expect, it } from "vitest";
import {
  buildExhibitorGrid, countEnquiries, dateRangeText, editionLabel, editionPhase, enquiriesByEdition, eventFiltersFromParams, filterEditions, observationLine, outreachLeads, sortLeads,
  type EditionLite, type EventLite, type LinkedEnquiry, type ObservationLite,
} from "./model";

const EV: EventLite = { id: "ev1", name: "Fictional Expo Global", kind: "exhibition", website: null, archived_at: null };
const ed = (id: string, start: string, end: string, extra: Partial<EditionLite> = {}): EditionLite => ({ id, event_id: "ev1", start_date: start, end_date: end, city: "Dubai", country_code: "AE", venue: null, archived_at: null, ...extra });
const E25 = ed("e25", "2025-10-13", "2025-10-17"); const E26 = ed("e26", "2026-10-12", "2026-10-16"); const E27 = ed("e27", "2027-10-11", "2027-10-15");
const obs = (id: string, edition: string, exhibitor: string, extra: Partial<ObservationLite> = {}): ObservationLite => ({
  id, edition_id: edition, exhibitor_org_id: exhibitor, kind: "exhibited", agency_org_id: null, agency_unknown: false, stand_no: null, agency_role: null, note: null, verification: "unverified",
  created_by: null, created_at: `2026-01-01T00:00:0${id.length}Z`, ...extra,
});
const NAMES: Record<string, string> = { c1: "Fictional Harbour Client", c2: "Fictional Orbit Client", a1: "Fictional Agency A", a2: "Fictional Agency B" };
const name = (id: string) => NAMES[id] ?? id;

describe("labels and phases", () => {
  it("labels an edition 'Event · year · city' and drops an unrecorded city", () => {
    expect(editionLabel(EV, E27)).toBe("Fictional Expo Global · 2027 · Dubai");
    expect(editionLabel(EV, ed("x", "2027-01-01", "2027-01-02", { city: null }))).toBe("Fictional Expo Global · 2027");
  });
  it("an edition ending today is still on; one starting tomorrow is upcoming; one that ended yesterday is past", () => {
    expect(editionPhase(E26, "2026-10-16")).toBe("ongoing");
    expect(editionPhase(E26, "2026-10-11")).toBe("upcoming");
    expect(editionPhase(E26, "2026-10-17")).toBe("past");
  });
  it("writes date ranges compactly", () => {
    expect(dateRangeText("2025-10-13", "2025-10-17")).toBe("13 to 17 Oct 2025");
    expect(dateRangeText("2025-10-30", "2025-11-02")).toBe("30 Oct to 2 Nov 2025");
    expect(dateRangeText("2025-12-30", "2026-01-02")).toBe("30 Dec 2025 to 2 Jan 2026");
    expect(dateRangeText("2025-10-13", "2025-10-13")).toBe("13 Oct 2025");
  });
});

describe("edition counts use the existing CRM status rules and one permission scope", () => {
  const o = (id: string, company: string, stage: string, edition: string | null): LinkedEnquiry => ({ id, company_id: company, reference: id, title: id, stage, event_edition_id: edition, agency_org_id: null, client_org_id: null });
  const all = [o("1", "UAE", "new", "e26"), o("2", "UAE", "on_hold", "e26"), o("3", "UAE", "won", "e26"), o("4", "KSA", "lost", "e26"), o("5", "KSA", "negotiation", "e26"), o("6", "UAE", "won", null), o("7", "UAE", "new", "e25")];
  it("total = open + closed; closed = won + lost; On hold is open", () => {
    expect(countEnquiries(enquiriesByEdition(all, null).get("e26")!)).toEqual({ total: 5, open: 3, closed: 2, won: 1, lost: 1 });
    expect(countEnquiries([])).toEqual({ total: 0, open: 0, closed: 0, won: 0, lost: 0 });
  });
  it("one company's figures and its drill-down list are the same rows; an enquiry with no edition counts nowhere", () => {
    const uae = enquiriesByEdition(all, "UAE");
    expect(uae.get("e26")!.map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(countEnquiries(uae.get("e26")!)).toEqual({ total: 3, open: 2, closed: 1, won: 1, lost: 0 });
    expect([...uae.values()].flat().some((x) => x.id === "6")).toBe(false);
  });
  it("only sees what it is given: rows of a company the viewer cannot read are simply not in the input", () => {
    const visible = all.filter((x) => x.company_id === "UAE");
    expect(countEnquiries(enquiriesByEdition(visible, null).get("e26")!).total).toBe(3);
  });
});

describe("exhibitor comparison", () => {
  const list = [
    obs("1", "e25", "c1", { agency_org_id: "a1", stand_no: "B12", agency_role: "stand_builder", verification: "confirmed" }),
    obs("22", "e26", "c1", { agency_org_id: "a2", stand_no: "C3" }),
    obs("333", "e26", "c1", { agency_unknown: true, stand_no: "C4" }),
    obs("4444", "e25", "c2", { kind: "did_not_exhibit" }),
  ];
  const grid = buildExhibitorGrid([E27, E26, E25], list, name);
  it("one row per exhibitor, A to Z, one cell per edition", () => {
    expect(grid.map((r) => r.name)).toEqual(["Fictional Harbour Client", "Fictional Orbit Client"]);
    expect([...grid[0]!.cells.keys()]).toEqual(["e27", "e26", "e25"]);
  });
  it("keeps No observation, Did not exhibit and an exhibition with an unknown agency DISTINCT", () => {
    const c1 = grid[0]!.cells; const c2 = grid[1]!.cells;
    expect(c1.get("e27")!.state).toBe("no_observation");
    expect(c2.get("e26")!.state).toBe("no_observation");
    expect(c2.get("e25")!.state).toBe("did_not_exhibit");
    expect(c1.get("e26")!.state).toBe("exhibited");
  });
  it("the same exhibitor shows a different agency in two years, and several observations in one edition stay several lines", () => {
    const c1 = grid[0]!.cells;
    expect(c1.get("e25")!.observations.map((o) => observationLine(o, name))).toEqual(["Fictional Agency A · stand B12 · Stand builder"]);
    expect(c1.get("e26")!.observations.map((o) => observationLine(o, name))).toEqual(["Fictional Agency B · stand C3 (unverified)", "Agency unknown · stand C4 (unverified)"]);
  });
  it("only editions asked for are compared", () => {
    expect(buildExhibitorGrid([E26], list, name).map((r) => r.name)).toEqual(["Fictional Harbour Client"]);
  });
});

describe("outreach leads for an edition", () => {
  const list = [
    obs("1", "e25", "c1", { agency_org_id: "a1", verification: "confirmed" }),
    obs("22", "e26", "c1", { agency_org_id: "a2" }),
    obs("333", "e26", "c2", { agency_unknown: true }),
    obs("4444", "e27", "c1", { agency_org_id: "a1" }),
    obs("55555", "e26", "c2", { kind: "did_not_exhibit" }),
  ];
  it("Agency A in 2025 and Agency B in 2026 are BOTH leads for 2027; unknown agencies and later editions are not", () => {
    const leads = outreachLeads([E25, E26, E27], list, "e27");
    expect(leads.map((l) => l.agencyId).sort()).toEqual(["a1", "a2"]);
    expect(leads.find((l) => l.agencyId === "a1")!.sightings.map((s) => s.year)).toEqual(["2025"]);
    expect(outreachLeads([E25, E26, E27], list, "e26").map((l) => l.agencyId)).toEqual(["a1"]);
    expect(outreachLeads([E25, E26, E27], list, "e25")).toEqual([]);
    expect(outreachLeads([E25], list, "missing")).toEqual([]);
  });
  it("says whether a sighting was confirmed, never that the agency is booked", () => {
    const leads = outreachLeads([E25, E26, E27], list, "e27");
    expect(leads.find((l) => l.agencyId === "a1")!.confirmed).toBe(true);
    expect(leads.find((l) => l.agencyId === "a2")!.confirmed).toBe(false);
  });
  it("orders by outreach priority (Unrated last), then the latest sighting, then name", () => {
    const leads = outreachLeads([E25, E26, E27], list, "e27");
    const prio: Record<string, number | null> = { a1: null, a2: 3 };
    expect(sortLeads(leads, (id) => prio[id] ?? null, name).map((l) => l.agencyId)).toEqual(["a2", "a1"]);
  });
});

describe("the events list filters", () => {
  const rows = [
    { event: EV, edition: E25 }, { event: EV, edition: E26 }, { event: EV, edition: E27 },
    { event: { ...EV, id: "ev2", name: "Fictional Retail Show" }, edition: ed("r1", "2026-03-02", "2026-03-04", { event_id: "ev2", city: "Riyadh", country_code: "SA" }) },
    { event: { ...EV, id: "ev3", name: "Retired Show", archived_at: "2026-01-01" }, edition: ed("z1", "2027-02-01", "2027-02-02", { event_id: "ev3", archived_at: "2026-01-01" }) },
  ];
  const f = (sp: Record<string, string>) => eventFiltersFromParams(sp);
  const ids = (sp: Record<string, string>, today = "2026-06-01") => filterEditions(rows, f(sp), today).map((r) => r.edition.id);
  it("defaults to upcoming editions worldwide, soonest first, archived hidden", () => {
    expect(ids({})).toEqual(["e26", "e27"]);
  });
  it("past editions are one click away, newest first; All shows everything", () => {
    expect(ids({ when: "past" })).toEqual(["r1", "e25"]);
    expect(ids({ when: "all" })).toEqual(["e27", "e26", "r1", "e25"]);
  });
  it("filters by event name, country and date range (a range overrides upcoming / past)", () => {
    expect(ids({ q: "retail", when: "all" })).toEqual(["r1"]);
    expect(ids({ country: "SA", when: "all" })).toEqual(["r1"]);
    expect(ids({ from: "2025-01-01", to: "2025-12-31" })).toEqual(["e25"]);
    expect(ids({ from: "bad", to: "2026-13-45" })).toEqual(["e26", "e27"]);
  });
  it("archived entries appear only when asked for", () => {
    expect(ids({ when: "all", archived: "1" })).toContain("z1");
    expect(ids({ when: "all" })).not.toContain("z1");
  });
});
