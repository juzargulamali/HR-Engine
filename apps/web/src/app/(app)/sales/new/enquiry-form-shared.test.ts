import { describe, expect, it } from "vitest";
import { chooseSalesCompany } from "@/lib/crm/active-company";
import {
  ADDRESS_TEXT_MAX, currencyNote, enquiryBlockedReason, fullFormHandOff, hasPrefill, panelReturnHref, parseEnquiryPrefill, readCarried, resolveCurrency, safeSalesPath, savingTo, startingCompanyId,
  type PrefillKnown,
} from "./enquiry-form-shared";

const UAE = "11111111-1111-4111-8111-111111111111";
const EUROPE = "22222222-2222-4222-8222-222222222222";
const OTHER = "99999999-9999-4999-8999-999999999999";
const ME = "33333333-3333-4333-8333-333333333333";
const COLLEAGUE = "33333333-3333-4333-8333-444444444444";
const AGENCY = "44444444-4444-4444-8444-444444444441";
const CLIENT = "44444444-4444-4444-8444-444444444442";
const TECH = "44444444-4444-4444-8444-444444444443";
const EDITION = "55555555-5555-4555-8555-555555555555";
const CONTACT = "66666666-6666-4666-8666-666666666661";
const STRANGER = "66666666-6666-4666-8666-666666666662";
const OUTREACH = "77777777-7777-4777-8777-777777777777";

// Europe sorts before UAE by name: the old forms started on it.
const companies = [{ id: EUROPE, name: "Fictional Europe" }, { id: UAE, name: "Fictional UAE" }];
const start = (o: Parameters<typeof chooseSalesCompany>[1]) => { const a = chooseSalesCompany(companies, o); return startingCompanyId(companies, { id: a.company?.id ?? null, from: a.from }); };

describe("the company a form starts in", () => {
  it("the company in the address or of the record on screen wins", () => expect(start({ asked: UAE, remembered: EUROPE, home: EUROPE })).toBe(UAE));
  it("then the company used last in Sales", () => expect(start({ remembered: UAE, home: EUROPE })).toBe(UAE));
  it("then the person's own employing company", () => expect(start({ home: UAE })).toBe(UAE));
  it("with several companies and none of those, NOTHING is preselected (never the first by name)", () => {
    expect(chooseSalesCompany(companies, {}).from).toBe("choose");
    expect(start({})).toBe("");
    expect(start({ asked: OTHER, remembered: "not-an-id" })).toBe("");
  });
  it("a single company is simply that company", () => expect(startingCompanyId([companies[1]!], { id: UAE, from: "only" })).toBe(UAE));
  it("an active company that is not among the companies offered is not used", () => expect(startingCompanyId(companies, { id: OTHER, from: "context" })).toBe(""));
});

describe("the currency of a new enquiry", () => {
  it("an untouched currency follows the company's default", () => {
    expect(resolveCurrency(null, "AED")).toEqual({ value: "AED", source: "default" });
    expect(resolveCurrency(null, "EUR")).toEqual({ value: "EUR", source: "default" });           // the company changed
    expect(resolveCurrency("", "AED")).toEqual({ value: "AED", source: "default" });              // emptied again: back to the default
  });
  it("the person's own choice is kept when the company changes", () => {
    expect(resolveCurrency("usd", "AED")).toEqual({ value: "USD", source: "chosen" });
    expect(resolveCurrency("usd", "EUR")).toEqual({ value: "USD", source: "chosen" });
    expect(resolveCurrency("USD", null)).toEqual({ value: "USD", source: "chosen" });
  });
  it("says which of the two it is, and company and currency together before saving", () => {
    expect(currencyNote(resolveCurrency(null, "AED"), "Fictional UAE")).toBe("AED is Fictional UAE's default currency. It follows the company until you choose another.");
    expect(currencyNote(resolveCurrency("USD", "AED"), "Fictional UAE")).toBe("You chose USD. It stays USD if you change the company.");
    expect(savingTo({ name: "Fictional UAE" }, resolveCurrency(null, "AED"))).toBe("Saving to Fictional UAE in AED");
    expect(savingTo({ name: "Fictional Europe" }, resolveCurrency("USD", "EUR"))).toBe("Saving to Fictional Europe in USD");
    expect(savingTo(null, resolveCurrency(null, null))).toBeNull();
  });
});

describe("the checks both forms make before sending", () => {
  const ok = { name: "Fictional UAE", hasSettings: true };
  it("no company, a company without Sales settings, no party, a technology error; otherwise nothing", () => {
    expect(enquiryBlockedReason({ company: null, agencyId: AGENCY, clientId: "" })).toMatch(/Choose the company/);
    expect(enquiryBlockedReason({ company: { name: "Fictional Unset Co", hasSettings: false }, agencyId: AGENCY, clientId: "" })).toMatch(/Fictional Unset Co has no Sales settings yet/);
    expect(enquiryBlockedReason({ company: ok, agencyId: "", clientId: "" })).toMatch(/agency, an end client, or both/);
    expect(enquiryBlockedReason({ company: ok, agencyId: "", clientId: CLIENT, techError: "Give each technology a name, or clear its quantity." })).toMatch(/technology/);
    expect(enquiryBlockedReason({ company: ok, agencyId: "", clientId: CLIENT })).toBeNull();
  });
});

const known: PrefillKnown = {
  companies: [{ id: UAE, canAssignOwner: true, people: [{ id: ME }, { id: COLLEAGUE }] }, { id: EUROPE, canAssignOwner: false, people: [{ id: ME }, { id: COLLEAGUE }] }],
  organisations: [{ id: AGENCY, kind: "agency", roles: ["agency"] }, { id: CLIENT, kind: "client", roles: ["client"] }, { id: TECH, kind: "client", roles: ["technology"] }],
  editions: [{ id: EDITION }],
  contacts: [{ id: CONTACT, organisationId: CLIENT }, { id: STRANGER, organisationId: TECH }],
  currentUserId: ME,
  today: "2026-11-14",
};
const parse = (sp: Record<string, string | string[]>) => parseEnquiryPrefill(sp, known);

describe("full form prefill from the address", () => {
  it("reads every documented parameter", () => {
    const { values: v, ignored } = parse({
      company: UAE, title: "Fictional LED tunnel", agency: AGENCY, client: CLIENT, edition: EDITION, source: "website", next: "Call the fictional client", due: "2026-11-20", dueTime: "14:30",
      nextKind: "meeting", brief: "A fictional brief", value: "150000", currency: "usd", owner: COLLEAGUE, location: "Fictional Hall 2", contact: CONTACT, es: "2027-01-10", ee: "2027-01-12",
      install: "2027-01-08", note: "about 150k", returnTo: "/sales/follow-ups?view=week",
    });
    expect(ignored).toEqual([]);
    expect(v).toMatchObject({
      companyId: UAE, title: "Fictional LED tunnel", agencyId: AGENCY, clientId: CLIENT, editionId: EDITION, source: "website", nextTitle: "Call the fictional client", nextDate: "2026-11-20",
      nextTime: "14:30", nextKind: "meeting", brief: "A fictional brief", value: "150000", currency: "USD", ownerId: COLLEAGUE, location: "Fictional Hall 2", contactIds: [CONTACT],
      eventStart: "2027-01-10", eventEnd: "2027-01-12", installStart: "2027-01-08", budgetNote: "about 150k", returnTo: "/sales/follow-ups?view=week",
    });
    expect(hasPrefill(v)).toBe(true);
  });
  it("the Outreach link (company, org, outreach, contact, source, title, brief) fills the account in the picker its role fits and carries the outreach", () => {
    const { values: v, ignored } = parse({ company: UAE, org: CLIENT, outreach: OUTREACH, contact: CONTACT, source: "agency_call", title: "Fictional stand", brief: "From the outreach notes" });
    expect(ignored).toEqual([]);
    expect(v).toMatchObject({ companyId: UAE, clientId: CLIENT, agencyId: "", outreachId: OUTREACH, contactIds: [CONTACT], source: "agency_call", title: "Fictional stand", brief: "From the outreach notes" });
    expect(parse({ company: UAE, org: AGENCY, outreach: OUTREACH }).values).toMatchObject({ agencyId: AGENCY, clientId: "", outreachId: OUTREACH });
  });
  it("ids the person may not use are dropped and named, never trusted", () => {
    const { values: v, ignored } = parse({ company: OTHER, agency: CLIENT, client: TECH, edition: OTHER, owner: OTHER, contact: [STRANGER, "not-an-id"], org: OTHER, outreach: OUTREACH });
    expect(v).toMatchObject({ companyId: "", agencyId: "", clientId: "", editionId: "", ownerId: "", contactIds: [], outreachId: "" });
    expect(ignored.sort()).toEqual(["agency", "client", "company", "contact", "edition", "org", "outreach", "owner"]);
    expect(hasPrefill(v)).toBe(false);
  });
  it("an owner is carried only where the person may assign owners in the chosen company; themselves always", () => {
    expect(parse({ company: EUROPE, owner: COLLEAGUE })).toMatchObject({ values: { ownerId: "" }, ignored: ["owner"] });
    expect(parse({ owner: COLLEAGUE })).toMatchObject({ values: { ownerId: "" }, ignored: ["owner"] });      // no company: nothing to check against
    expect(parse({ company: EUROPE, owner: ME }).values.ownerId).toBe(ME);
  });
  it("malformed values are dropped: unknown source and type, a past or invalid date, a bad time, a negative value, a currency that is not three letters", () => {
    const { values: v, ignored } = parse({ source: "carrier-pigeon", nextKind: "fax", due: "2026-11-01", dueTime: "25:00", value: "-5", currency: "DIRHAM", es: "soon" });
    expect(v).toMatchObject({ source: "", nextKind: "", nextDate: "", nextTime: "", value: "", currency: "", eventStart: "" });
    expect(ignored.sort()).toEqual(["currency", "due", "dueTime", "es", "nextKind", "source", "value"]);
  });
  it("free text is cut to a sane length and unknown parameters are ignored", () => {
    const { values: v, ignored } = parse({ title: "x".repeat(500), brief: "y".repeat(9000), anything: "else", returnTo: "https://elsewhere.example/sales" });
    expect(v.title).toHaveLength(200);
    expect(v.brief).toHaveLength(4000);
    expect(v.returnTo).toBe("");
    expect(ignored).toEqual([]);
  });
});

describe("Quick Add: Open the full form carries what was typed", () => {
  const draft = {
    companyId: UAE, title: "Fictional LED tunnel", agencyOrgId: AGENCY, clientOrgId: "", eventEditionId: EDITION, source: "website", nextTitle: "Call the fictional client", nextDate: "2026-11-20",
    nextTime: "10:00", nextKind: "call", brief: "Short brief", value: "150000", currency: "", ownerId: ME, location: "Fictional Hall 2", eventStart: "2027-01-10", eventEnd: "", installStart: "",
    budgetNote: "about 150k", technologies: "[]",
  };
  it("short values travel in the address and round-trip through the parser; defaults and an untouched currency are left out", () => {
    const { href, carried } = fullFormHandOff(draft, { returnTo: "/sales/follow-ups?view=week", currentUserId: ME, token: "abc123" });
    expect(carried).toBeNull();
    const sp = new URL(href, "https://app.example").searchParams;
    expect([...sp.keys()].sort()).toEqual(["agency", "brief", "company", "due", "edition", "es", "location", "next", "note", "returnTo", "source", "title", "value"]);
    const { values: v, ignored } = parseEnquiryPrefill(sp, known);
    expect(ignored).toEqual([]);
    expect(v).toMatchObject({ companyId: UAE, title: "Fictional LED tunnel", agencyId: AGENCY, editionId: EDITION, source: "website", nextTitle: "Call the fictional client", nextDate: "2026-11-20", brief: "Short brief",
      value: "150000", currency: "", location: "Fictional Hall 2", eventStart: "2027-01-10", budgetNote: "about 150k", returnTo: "/sales/follow-ups?view=week" });
  });
  it("a currency the person chose, another owner and a changed time are carried", () => {
    const sp = new URL(fullFormHandOff({ ...draft, currency: "USD", ownerId: COLLEAGUE, nextTime: "15:00", nextKind: "email" }, { currentUserId: ME, token: "abc123" }).href, "https://app.example").searchParams;
    expect(sp.get("currency")).toBe("USD");
    expect(sp.get("owner")).toBe(COLLEAGUE);
    expect(sp.get("dueTime")).toBe("15:00");
    expect(sp.get("nextKind")).toBe("email");
  });
  it("a long brief and the technologies never go in the address: they are handed over under a token and read back once", () => {
    const long = "A fictional brief. ".repeat(60);
    const { href, carried } = fullFormHandOff({ ...draft, brief: long, technologies: JSON.stringify([{ name: "LED wall", qty: 2 }, { name: "", qty: 1 }]) }, { currentUserId: ME, token: "abc123" });
    const sp = new URL(href, "https://app.example").searchParams;
    expect(sp.get("brief")).toBeNull();
    expect(sp.get("carry")).toBe("abc123");
    expect(Math.max(...[...sp.values()].map((x) => x.length))).toBeLessThanOrEqual(ADDRESS_TEXT_MAX);
    expect(carried).toEqual({ token: "abc123", brief: long.trim(), technologies: [{ name: "LED wall", qty: 2 }] });
    expect(readCarried(JSON.stringify(carried), "abc123")).toEqual(carried);
    expect(readCarried(JSON.stringify(carried), "zzz999")).toBeNull();        // another form's hand-over is not used
    expect(readCarried("not json", "abc123")).toBeNull();
    expect(parseEnquiryPrefill(sp, known).values.carry).toBe("abc123");
  });
});

describe("where a save or Cancel returns to", () => {
  it("only addresses inside Sales are accepted", () => {
    expect(safeSalesPath("/sales/follow-ups?view=week")).toBe("/sales/follow-ups?view=week");
    expect(safeSalesPath("/sales")).toBe("/sales");
    for (const bad of ["https://elsewhere.example/sales", "//elsewhere.example/sales", "/salesman", "/people", "/sales/\\elsewhere", "/sales//elsewhere.example", "", null]) expect(safeSalesPath(bad), String(bad)).toBeNull();
  });
  it("Quick Add comes back to the list it was opened from with the new enquiry open, keeping the filters", () => {
    expect(panelReturnHref("/sales/follow-ups?view=week&add=1&open=old", "new")).toBe("/sales/follow-ups?view=week&open=new");
    expect(panelReturnHref("/sales/opportunities?company=all&status=all&page=3", "new")).toBe("/sales/opportunities?company=all&status=all&open=new");
    expect(panelReturnHref(null, "new")).toBe("/sales/opportunities?open=new");
    expect(panelReturnHref("/sales/settings?x=1", "new")).toBe("/sales/opportunities?open=new");
    expect(panelReturnHref("https://elsewhere.example/sales/follow-ups", "new")).toBe("/sales/opportunities?open=new");
  });
});
