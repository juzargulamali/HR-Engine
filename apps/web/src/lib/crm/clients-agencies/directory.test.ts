import { describe, expect, it } from "vitest";
import type { CrmAccountProfileRow, CrmContactRow, CrmOrganisationRow } from "@/types/crm";
import { buildDirectoryRows, EMPTY_FILTERS, filterDirectory, filtersFromParams, matchesPriority, priorityLabel, sortDirectory, sortFromParams, UNASSIGNED } from "./directory";
import { normaliseCountry, normaliseRoles } from "./normalise";

const CO_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CO_B = "bbbbbbbb-0000-4000-8000-000000000002";
const SARA = "11111111-0000-4000-8000-000000000001";
const OMAR = "11111111-0000-4000-8000-000000000002";

const org = (id: string, name: string, extra: Partial<CrmOrganisationRow> = {}): CrmOrganisationRow => ({
  id, name, name_key: name.toLowerCase(), kind: "client", roles: [], country_code: null, website: null, website_domain: null, vat_trn: null, trade_licence_no: null, place: null, note: null, outreach_priority: null, outreach_priority_by: null, outreach_priority_at: null,
  created_by: null, created_at: "", updated_at: "", archived_at: null, ...extra,
});
const profile = (organisation_id: string, company_id: string, extra: Partial<CrmAccountProfileRow> = {}): CrmAccountProfileRow => ({
  id: `p-${organisation_id}-${company_id}`, organisation_id, company_id, owner_id: null, owner_assigned_by: null, owner_assigned_at: null, lead_source: null, exhibition: null, created_at: "", updated_at: "", ...extra,
});
const contact = (id: string, organisation_id: string, name: string, extra: Partial<CrmContactRow> = {}): CrmContactRow => ({
  id, organisation_id, name, role_title: null, email: null, email_key: null, phone: null, created_by: null, created_at: "", updated_at: "", archived_at: null, ...extra,
});

const orgs = [
  org("o1", "Fictional Aurora Events", { roles: ["agency", "technology"], country_code: "AE", website: "https://www.aurora.example", website_domain: "aurora.example" }),
  org("o2", "Fictional Orbit Motors", { roles: ["client"], country_code: "SA" }),
  org("o3", "Fictional Imported Co", { roles: [] }),
  org("o4", "Fictional Both Ways", { roles: ["agency", "direct"], country_code: "AE" }),
];
const rows = buildDirectoryRows({
  organisations: orgs,
  contacts: [contact("c1", "o1", "Noor Fictional", { email: "noor@aurora.example" }), contact("c2", "o1", "Ravi Fictional", { phone: "+971 50 000 0000" })],
  profiles: [
    profile("o1", CO_A, { owner_id: SARA, lead_source: "exhibition", exhibition: "Gulf Expo 2026 (fictional)" }),
    profile("o1", CO_B, { owner_id: OMAR }),           // another company's owner must never show in company A
    profile("o2", CO_A, { lead_source: "referral" }),  // profile with no owner = Unassigned
  ],
  opportunities: [
    { id: "e1", created_at: "2026-10-01T08:00:00Z", company_id: CO_A, agency_org_id: "o1", client_org_id: "o2", stage: "new" },
    { id: "e2", created_at: "2026-10-01T08:00:00Z", company_id: CO_A, agency_org_id: "o4", client_org_id: "o4", stage: "won" },   // both fields the same organisation: counted once
    { id: "e3", created_at: "2026-10-01T08:00:00Z", company_id: CO_B, agency_org_id: "o1", client_org_id: null, stage: "new" },    // another company's inquiry: ignored
  ],
  companyId: CO_A,
  now: new Date("2026-11-08T08:00:00Z"),
});
const names = (f: Partial<typeof EMPTY_FILTERS>) => filterDirectory(rows, { ...EMPTY_FILTERS, ...f }).map((r) => r.org.name);

describe("directory rows", () => {
  it("shows only the selected company's profile, owner and inquiry counts", () => {
    const a = rows.find((r) => r.org.id === "o1")!;
    expect(a.profile?.owner_id).toBe(SARA);
    expect(a.stats?.total).toBe(1);
    expect(a.contacts).toHaveLength(2);
    expect(rows.find((r) => r.org.id === "o4")).toMatchObject({ stats: { total: 1, open: 0, won: 1 } });
  });
});

describe("directory filters", () => {
  it("filters by role, and one company with two roles appears under both", () => {
    expect(names({ role: "agency" })).toEqual(["Fictional Aurora Events", "Fictional Both Ways"]);
    expect(names({ role: "technology" })).toEqual(["Fictional Aurora Events"]);
    expect(names({ role: "direct" })).toEqual(["Fictional Both Ways"]);
    expect(names({ role: "none" })).toEqual(["Fictional Imported Co"]);
  });
  it("filters by country, owner (including Unassigned), lead source and exhibition", () => {
    expect(names({ country: "AE" })).toEqual(["Fictional Aurora Events", "Fictional Both Ways"]);
    expect(names({ owner: SARA })).toEqual(["Fictional Aurora Events"]);
    expect(names({ owner: OMAR })).toEqual([]); // Omar owns it only in the OTHER company
    expect(names({ owner: UNASSIGNED })).toEqual(["Fictional Both Ways", "Fictional Imported Co", "Fictional Orbit Motors"]);
    expect(names({ source: "referral" })).toEqual(["Fictional Orbit Motors"]);
    expect(names({ source: "none" })).toEqual(["Fictional Both Ways", "Fictional Imported Co"]);
    expect(names({ exhibition: "gulf expo" })).toEqual(["Fictional Aurora Events"]);
  });
  it("searches names, website, contacts and emails, and combines filters", () => {
    expect(names({ q: "aurora.example" })).toEqual(["Fictional Aurora Events"]);
    expect(names({ q: "ravi" })).toEqual(["Fictional Aurora Events"]);
    expect(names({ q: "noor@", role: "agency", country: "AE", owner: SARA })).toEqual(["Fictional Aurora Events"]);
    expect(names({ q: "noor@", country: "SA" })).toEqual([]);
  });
  it("reads filters from the address and ignores anything not recognised", () => {
    expect(filtersFromParams({ role: "agency", country: "ae", source: "exhibition", owner: UNASSIGNED, q: " x " })).toMatchObject({ role: "agency", country: "AE", source: "exhibition", owner: UNASSIGNED, q: "x" });
    expect(filtersFromParams({ role: "<script>", country: "UAE", source: "bogus" })).toMatchObject({ role: "", country: "", source: "" });
  });
});

describe("roles and countries", () => {
  it("accepts several roles in words and keeps unknown words visible", () => {
    expect(normaliseRoles("Agency, End client; Tech company")).toEqual({ roles: ["agency", "client", "technology"], unknown: [] });
    expect(normaliseRoles(["Direct client", "Sponsor"])).toEqual({ roles: ["direct"], unknown: ["sponsor"] });
  });
  it("turns country names and codes into the stored two-letter code, and never guesses", () => {
    expect(normaliseCountry("United Arab Emirates")).toBe("AE");
    expect(normaliseCountry("uae")).toBe("AE");
    expect(normaliseCountry("ae")).toBe("AE");
    expect(normaliseCountry("UK")).toBe("GB");
    expect(normaliseCountry("Atlantis")).toBeNull();
    expect(normaliseCountry("")).toBeNull();
  });
});

describe("shared outreach priority", () => {
  const rated = [
    org("p1", "Fictional Five", { outreach_priority: 5 }), org("p2", "Fictional Four", { outreach_priority: 4 }), org("p3", "Fictional Two", { outreach_priority: 2 }),
    org("p4", "Fictional Unrated A"), org("p5", "Fictional Unrated B"),
  ];
  const table = buildDirectoryRows({ organisations: rated, contacts: [], profiles: [], opportunities: [], companyId: CO_A });
  const ids = (rs: readonly { org: { id: string } }[]) => rs.map((r) => r.org.id);

  it("reads and writes ONE value per account in words: 1 to 5 or Unrated", () => {
    expect(priorityLabel(5)).toBe("5 of 5"); expect(priorityLabel(null)).toBe("Unrated"); expect(priorityLabel(undefined)).toBe("Unrated");
  });
  it("filters: exactly 5, at least 4, at least 3, any rating, unrated; an unknown value in the address is ignored", () => {
    const by = (priority: string) => ids(filterDirectory(table, filtersFromParams({ priority }))).sort();
    expect(by("5")).toEqual(["p1"]);
    expect(by("4+")).toEqual(["p1", "p2"]);
    expect(by("3+")).toEqual(["p1", "p2"]);
    expect(by("rated")).toEqual(["p1", "p2", "p3"]);
    expect(by("unrated")).toEqual(["p4", "p5"]);
    expect(by("9")).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(matchesPriority(null, "3+")).toBe(false);
    expect(filtersFromParams({ priority: "4+" }).priority).toBe("4+");
    expect(EMPTY_FILTERS.priority).toBe("");
  });
  it("sorts highest first by default for the column, lowest first when flipped, and Unrated is ALWAYS last in both directions", () => {
    const sp = (dir: string) => sortFromParams({ sort: "priority", dir });
    expect(sortFromParams({ sort: "priority" })).toEqual({ key: "priority", dir: "desc" });
    expect(ids(sortDirectory(table, sp("desc"), () => null))).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(ids(sortDirectory(table, sp("asc"), () => null))).toEqual(["p3", "p2", "p1", "p4", "p5"]);
  });
  it("is the same for every company: the account carries it, not a company profile", () => {
    const a = buildDirectoryRows({ organisations: rated, contacts: [], profiles: [], opportunities: [], companyId: CO_A });
    const b = buildDirectoryRows({ organisations: rated, contacts: [], profiles: [], opportunities: [], companyId: CO_B });
    expect(a.map((r) => r.org.outreach_priority)).toEqual(b.map((r) => r.org.outreach_priority));
  });
});
