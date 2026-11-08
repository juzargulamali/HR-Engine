import { describe, expect, it } from "vitest";
import type { CrmOrganisationRow } from "@/types/crm";
import { enquiryStats, linkedInquiries } from "./account";
import { buildDirectoryRows, filterDirectory, EMPTY_FILTERS, filtersFromParams, nextSort, relationshipAvailable, relationshipCounts, sortDirectory, sortFromParams, type DirectoryRow } from "./directory";
import { daysBetween, relationshipOf, type Relationship } from "./relationship";

const CO = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-08T08:00:00Z"); // 12:00 in Dubai; today there = 2026-11-08
const TODAY = "2026-11-08";

const stats = (o: Partial<{ total: number; open: number; won: number; lastEnquiryOn: string | null }>) => ({ total: 1, open: 0, won: 0, lastEnquiryOn: "2026-11-01", ...o });

describe("relationship badge: the four outcomes and their precedence", () => {
  it("No enquiries recorded beats everything", () => {
    expect(relationshipOf({ total: 0, open: 0, won: 0, lastEnquiryOn: null }, TODAY)).toBe("none");
    // even inconsistent figures: no enquiry means none
    expect(relationshipOf({ total: 0, open: 0, won: 3, lastEnquiryOn: "2020-01-01" }, TODAY)).toBe("none");
  });
  it("Dormant: last enquiry 90+ days ago and nothing open (beats Won work)", () => {
    expect(relationshipOf(stats({ lastEnquiryOn: "2026-01-01", won: 2 }), TODAY)).toBe("dormant");
    expect(relationshipOf(stats({ lastEnquiryOn: "2026-01-01", won: 0 }), TODAY)).toBe("dormant");
  });
  it("an open enquiry older than 90 days prevents Dormant", () => {
    expect(relationshipOf(stats({ lastEnquiryOn: "2026-01-01", open: 1, won: 0 }), TODAY)).toBe("no_wins");
    expect(relationshipOf(stats({ lastEnquiryOn: "2026-01-01", open: 1, won: 1, total: 2 }), TODAY)).toBe("won");
  });
  it("Won work needs a recorded win; No wins yet otherwise", () => {
    expect(relationshipOf(stats({ won: 1 }), TODAY)).toBe("won");
    expect(relationshipOf(stats({ won: 0, open: 1 }), TODAY)).toBe("no_wins");
    expect(relationshipOf(stats({ won: 0, open: 0 }), TODAY)).toBe("no_wins"); // lost only, recent
  });
  it("a project in progress is not a win: only the Won stage counts", () => {
    const e = enquiryStats([{ id: "1", company_id: CO, agency_org_id: null, client_org_id: "x", stage: "negotiation", created_at: "2026-11-01T08:00:00Z" }], "x", CO);
    expect(e.won).toBe(0);
    expect(relationshipOf(e, TODAY)).toBe("no_wins");
  });
  it("the 90-day boundary: 89 no, 90 yes, 91 yes", () => {
    const at = (days: number) => { const d = new Date(Date.parse(`${TODAY}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10); return relationshipOf(stats({ won: 1, lastEnquiryOn: d }), TODAY); };
    expect(at(89)).toBe("won");
    expect(at(90)).toBe("dormant");
    expect(at(91)).toBe("dormant");
    expect(daysBetween("2026-08-10", "2026-11-08")).toBe(90);
  });
  it("days are Dubai days: an enquiry recorded at 21:00 UTC is the NEXT Dubai day", () => {
    // 2026-08-10 21:00 UTC = 2026-08-11 01:00 in Dubai: 89 Dubai days before 2026-11-08 (it would be 90 by the UTC date).
    const e = enquiryStats([{ id: "1", company_id: CO, agency_org_id: null, client_org_id: "x", stage: "won", created_at: "2026-08-10T21:00:00Z" }], "x", CO);
    expect(e.lastEnquiryOn).toBe("2026-08-11");
    expect(relationshipOf(e, TODAY)).toBe("won");
    // and "today" is the Dubai day too: 2026-11-08 21:00 UTC is already 2026-11-09 in Dubai, which makes the same enquiry 90 days old
    const o = { id: "o", name: "Fixture", roles: [], archived_at: null } as unknown as CrmOrganisationRow;
    const rows = buildDirectoryRows({ organisations: [o], contacts: [], profiles: [], companyId: CO, now: new Date("2026-11-08T21:00:00Z"), opportunities: [{ id: "1", company_id: CO, agency_org_id: null, client_org_id: "o", stage: "won", created_at: "2026-08-10T21:00:00Z" }] });
    expect(rows[0]!.relationship).toBe("dormant");
  });
});

describe("counts: this company only, once per enquiry", () => {
  const opps: Parameters<typeof enquiryStats>[0] = [
    { id: "1", company_id: CO, agency_org_id: "a", client_org_id: "a", stage: "won", created_at: "2026-10-01T08:00:00Z" },   // same account in two roles: ONE enquiry
    { id: "2", company_id: CO, agency_org_id: "a", client_org_id: "c", stage: "new", created_at: "2026-10-05T08:00:00Z" },
    { id: "3", company_id: OTHER, agency_org_id: "a", client_org_id: null, stage: "won", created_at: "2026-10-09T08:00:00Z" }, // another company's: never counted
    { id: "1", company_id: CO, agency_org_id: "a", client_org_id: "a", stage: "won", created_at: "2026-10-01T08:00:00Z" },   // the same row twice: still one
  ];
  it("no double counting across two roles, and other companies' enquiries are ignored", () => {
    expect(enquiryStats(opps, "a", CO)).toEqual({ total: 2, open: 1, won: 1, lastEnquiryOn: "2026-10-05" });
    expect(enquiryStats(opps, "a", OTHER)).toEqual({ total: 1, open: 0, won: 1, lastEnquiryOn: "2026-10-09" });
    expect(enquiryStats(opps, "c", CO).total).toBe(1);
  });
  it("is the same definition the account page uses", () => {
    expect(linkedInquiries(opps, "a", CO).map((i) => i.opp.id)).toEqual(["1", "2"]);
  });
});

const org = (id: string, name: string, extra: Partial<CrmOrganisationRow> = {}) => ({ id, name, roles: ["client"], country_code: null, archived_at: null, ...extra }) as unknown as CrmOrganisationRow;
const orgs = [org("n", "Fictional None"), org("w", "Fictional Won", { country_code: "AE", roles: ["agency"] }), org("p", "Fictional Pending", { country_code: "SA" }), org("d", "Fictional Dormant", { country_code: "AE" }), org("w2", "Fictional Won Two", { country_code: "QA" })];
const opp = (id: string, o: string, stage: string, created_at: string) => ({ id, company_id: CO, agency_org_id: null, client_org_id: o, stage, created_at }) as never;
const rows = buildDirectoryRows({
  organisations: orgs, contacts: [], companyId: CO, now: NOW,
  profiles: [{ organisation_id: "w", company_id: CO, owner_id: "u2", lead_source: null, exhibition: null }, { organisation_id: "p", company_id: CO, owner_id: "u1", lead_source: null, exhibition: null }] as never,
  opportunities: [opp("1", "w", "won", "2026-10-20T08:00:00Z"), opp("2", "w", "won", "2026-09-01T08:00:00Z"), opp("3", "p", "new", "2026-11-01T08:00:00Z"), opp("4", "d", "won", "2026-02-01T08:00:00Z"), opp("5", "w2", "won", "2026-11-05T08:00:00Z")],
});
const byName = (rs: readonly DirectoryRow[]) => rs.map((r) => r.org.name);
const ownerName = (id: string | null) => ({ u1: "Amal Fixture", u2: "Zed Fixture" } as Record<string, string>)[id ?? ""] ?? null;

describe("directory rows carry the badge", () => {
  it("one badge per account in the precedence order", () => {
    const badge = Object.fromEntries(rows.map((r) => [r.org.id, r.relationship]));
    expect(badge).toEqual({ n: "none", w: "won", p: "no_wins", d: "dormant", w2: "won" });
  });
  it("a failed enquiries read gives no figures and no badge (never zero)", () => {
    const failed = buildDirectoryRows({ organisations: orgs, contacts: [], profiles: [], opportunities: null, companyId: CO, now: NOW });
    expect(failed.every((r) => r.stats === null && r.relationship === null)).toBe(true);
    expect(relationshipAvailable(failed)).toBe(false);
    expect(relationshipAvailable(rows)).toBe(true);
    expect(relationshipCounts(failed)).toEqual({ won: 0, no_wins: 0, none: 0, dormant: 0 }); // the page shows "Could not load" instead of these
  });
});

describe("relationship filter and counts", () => {
  it("filters to one badge, combined with search and role", () => {
    expect(byName(filterDirectory(rows, { ...EMPTY_FILTERS, rel: "won" }))).toEqual(["Fictional Won", "Fictional Won Two"]);
    expect(byName(filterDirectory(rows, { ...EMPTY_FILTERS, rel: "won", role: "agency" }))).toEqual(["Fictional Won"]);
    expect(byName(filterDirectory(rows, { ...EMPTY_FILTERS, rel: "won", q: "two" }))).toEqual(["Fictional Won Two"]);
    expect(byName(filterDirectory(rows, { ...EMPTY_FILTERS, rel: "dormant" }))).toEqual(["Fictional Dormant"]);
    expect(byName(filterDirectory(rows, { ...EMPTY_FILTERS, rel: "none" }))).toEqual(["Fictional None"]);
  });
  it("counts per badge follow the other filters", () => {
    expect(relationshipCounts(rows)).toEqual({ won: 2, no_wins: 1, none: 1, dormant: 1 });
    expect(relationshipCounts(filterDirectory(rows, { ...EMPTY_FILTERS, country: "AE" }))).toEqual({ won: 1, no_wins: 0, none: 0, dormant: 1 });
  });
  it("reads rel from the address and ignores anything else", () => {
    expect(filtersFromParams({ rel: "dormant" }).rel).toBe("dormant");
    expect(filtersFromParams({ rel: "bogus" }).rel).toBe("");
  });
});

describe("sorting", () => {
  const sorted = (key: Parameters<typeof nextSort>[1], dir: "asc" | "desc") => byName(sortDirectory(rows, { key, dir }, ownerName));
  it("name A to Z and Z to A", () => {
    expect(sorted("name", "asc")).toEqual(["Fictional Dormant", "Fictional None", "Fictional Pending", "Fictional Won", "Fictional Won Two"]);
    expect(sorted("name", "desc")[0]).toBe("Fictional Won Two");
  });
  it("country, with accounts without a country last in both directions", () => {
    expect(sorted("country", "asc")).toEqual(["Fictional Won Two", "Fictional Pending", "Fictional Dormant", "Fictional Won", "Fictional None"]);
    expect(sorted("country", "desc").at(-1)).toBe("Fictional None");
  });
  it("enquiries and won, numerically, ties by name", () => {
    expect(sorted("enquiries", "desc")).toEqual(["Fictional Won", "Fictional Dormant", "Fictional Pending", "Fictional Won Two", "Fictional None"]);
    expect(sorted("enquiries", "asc")).toEqual(["Fictional None", "Fictional Dormant", "Fictional Pending", "Fictional Won Two", "Fictional Won"]);
    expect(sorted("won", "desc")).toEqual(["Fictional Won", "Fictional Dormant", "Fictional Won Two", "Fictional None", "Fictional Pending"]);
  });
  it("last enquiry date: newest first, none last in both directions", () => {
    const dates = (dir: "asc" | "desc") => sortDirectory(rows, { key: "last", dir }, ownerName).map((r) => r.stats?.lastEnquiryOn ?? null);
    expect(dates("desc")).toEqual(["2026-11-05", "2026-11-01", "2026-10-20", "2026-02-01", null]);
    expect(dates("asc")).toEqual(["2026-02-01", "2026-10-20", "2026-11-01", "2026-11-05", null]);
  });
  it("owner by name, Unassigned last in both directions", () => {
    expect(sorted("owner", "asc").slice(0, 2)).toEqual(["Fictional Pending", "Fictional Won"]);
    expect(sorted("owner", "desc").slice(0, 2)).toEqual(["Fictional Won", "Fictional Pending"]);
    expect(sorted("owner", "desc").slice(2)).toEqual(["Fictional Dormant", "Fictional None", "Fictional Won Two"]);
  });
  it("badge: Won work, No wins yet, Dormant, No enquiries recorded", () => {
    expect(sorted("badge", "asc")).toEqual(["Fictional Won", "Fictional Won Two", "Fictional Pending", "Fictional Dormant", "Fictional None"]);
    expect(sorted("badge", "desc")).toEqual(["Fictional None", "Fictional Dormant", "Fictional Pending", "Fictional Won", "Fictional Won Two"]);
  });
  it("unknown figures (failed read) sort last and never as zero", () => {
    const failed = buildDirectoryRows({ organisations: orgs, contacts: [], profiles: [], opportunities: null, companyId: CO, now: NOW });
    expect(byName(sortDirectory(failed, { key: "enquiries", dir: "desc" }, ownerName))).toEqual(byName(sortDirectory(failed, { key: "name", dir: "asc" }, ownerName)));
  });
  it("is stable: the input is not changed and the same input gives the same order", () => {
    const before = byName(rows);
    expect(sorted("country", "asc")).toEqual(sorted("country", "asc"));
    expect(byName(rows)).toEqual(before);
    const none = rows.find((r) => r.org.id === "n")!;
    const twins = [...rows, { ...none, org: { ...none.org, id: "n2" } }];
    expect(sortDirectory(twins, { key: "enquiries", dir: "asc" }, ownerName).slice(0, 2).map((r) => r.org.id)).toEqual(["n", "n2"]);
  });
  it("the direction toggles on the active column; a new column starts in its first direction", () => {
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "last")).toEqual({ key: "last", dir: "desc" });
    expect(nextSort({ key: "name", dir: "asc" }, "owner")).toEqual({ key: "owner", dir: "asc" });
  });
  it("reads sort and dir from the address; the default is name A to Z", () => {
    expect(sortFromParams({})).toEqual({ key: "name", dir: "asc" });
    expect(sortFromParams({ sort: "bogus", dir: "desc" })).toEqual({ key: "name", dir: "asc" });
    expect(sortFromParams({ sort: "won", dir: "asc" })).toEqual({ key: "won", dir: "asc" });
    expect(sortFromParams({ sort: "last" })).toEqual({ key: "last", dir: "desc" });
  });
});

describe("types stay in step", () => {
  it("every relationship is covered", () => {
    const all: Relationship[] = ["won", "no_wins", "none", "dormant"];
    expect(all.every((r) => relationshipOf(r === "none" ? stats({ total: 0, lastEnquiryOn: null }) : r === "dormant" ? stats({ lastEnquiryOn: "2026-01-01" }) : r === "won" ? stats({ won: 1 }) : stats({ open: 1 }), TODAY) === r)).toBe(true);
  });
});
