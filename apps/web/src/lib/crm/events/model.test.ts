import { describe, expect, it } from "vitest";
import {
  addEditionLabel, buildExhibitorGrid, calendarRange, calendarWeeks, countEnquiries, editionsForMonth, eventNameKey, eventWithName, isMonth, monthLabel, shiftMonth, dateRangeText, editionLabel, editionPhase, enquiriesByEdition, EMPTY_EVENT_FILTERS, eventFiltersFromParams, filterEditions, observationLine, outreachLeads, sortLeads,
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

describe("adding an event or an edition", () => {
  it("compares event names the way the database does (letters and digits only, any case)", () => {
    expect(eventNameKey("  Fictional EXPO-Global! ")).toBe("fictionalexpoglobal");
    const events = [{ id: "a", name: "Fictional Expo Global", editions: 2 }];
    expect(eventWithName(events, "fictional expo  global")?.id).toBe("a");
    expect(eventWithName(events, "Fictional Expo")).toBeNull();
    expect(eventWithName(events, " -- ")).toBeNull();
  });
  it("says first edition only for an event that has none", () => {
    expect(addEditionLabel(0)).toBe("Add first edition");
    expect(addEditionLabel(1)).toBe("Add next edition");
  });
});

describe("the calendar", () => {
  const CROSS = { event: { ...EV, id: "ev2", name: "Fictional Cross Show" }, edition: ed("x1", "2027-03-30", "2027-04-02", { event_id: "ev2" }) };
  const OCT = { event: EV, edition: E27 };
  const namesOn = (month: string, date: string, rows = [CROSS, OCT]) => calendarWeeks(month, rows).flat().find((d) => d.date === date)!.shows.map((s) => s.name);
  it("validates and steps months, across a year end", () => {
    expect(isMonth("2027-03")).toBe(true); expect(isMonth("2027-13")).toBe(false); expect(isMonth("2027-3")).toBe(false);
    expect(shiftMonth("2027-01", -1)).toBe("2026-12"); expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthLabel("2027-03")).toBe("March 2027");
  });
  it("shows whole weeks, Monday to Sunday", () => {
    expect(calendarRange("2027-03")).toEqual({ from: "2027-03-01", to: "2027-04-04" });   // 1 March 2027 is a Monday
    expect(calendarRange("2027-04")).toEqual({ from: "2027-03-29", to: "2027-05-02" });
    const weeks = calendarWeeks("2027-04", []);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]![0]).toMatchObject({ date: "2027-03-29", inMonth: false });
  });
  it("puts a show on every day from its start to its end, and on no other day, across the month boundary", () => {
    for (const day of ["2027-03-30", "2027-03-31"]) expect(namesOn("2027-03", day)).toEqual(["Fictional Cross Show"]);
    expect(namesOn("2027-03", "2027-03-29")).toEqual([]);
    for (const day of ["2027-04-01", "2027-04-02"]) expect(namesOn("2027-04", day)).toEqual(["Fictional Cross Show"]);
    expect(namesOn("2027-04", "2027-04-03")).toEqual([]);
    // In April the March days of the same show are still on the page (previous month's last week), marked as outside the month.
    const march30 = calendarWeeks("2027-04", [CROSS]).flat().find((d) => d.date === "2027-03-30")!;
    expect(march30.inMonth).toBe(false);
    expect(march30.shows[0]).toEqual({ eventId: "ev2", editionId: "x1", name: "Fictional Cross Show" });
  });
  it("each name carries its OWN edition, so two editions of one event open different editions", () => {
    const again = { event: EV, edition: ed("e27b", "2027-10-20", "2027-10-21") };
    const days = calendarWeeks("2027-10", [OCT, again]).flat();
    expect(days.find((d) => d.date === "2027-10-11")!.shows.map((s) => s.editionId)).toEqual(["e27"]);
    expect(days.find((d) => d.date === "2027-10-20")!.shows.map((s) => s.editionId)).toEqual(["e27b"]);
  });
  it("uses the list's archive, name and country rules, and the visible weeks as the dates", () => {
    const archived = { event: EV, edition: ed("gone", "2027-04-10", "2027-04-11", { archived_at: "2026-01-01T00:00:00Z" }) };
    const rows = [CROSS, OCT, archived];
    const ids = (f = EMPTY_EVENT_FILTERS, month = "2027-04") => editionsForMonth(rows, f, month, "2026-11-11").map((r) => r.edition.id);
    expect(ids()).toEqual(["x1"]);                                  // October is outside April; the archived one is hidden; past / upcoming does not matter
    expect(ids({ ...EMPTY_EVENT_FILTERS, archived: true })).toEqual(["gone", "x1"]);
    expect(ids({ ...EMPTY_EVENT_FILTERS, q: "nothing" })).toEqual([]);
    expect(ids(EMPTY_EVENT_FILTERS, "2027-05")).toEqual([]);
  });
});
