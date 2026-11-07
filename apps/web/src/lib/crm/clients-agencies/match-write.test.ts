import { describe, expect, it, vi } from "vitest";
import { findOrganisationMatches, planEmptyFieldUpdate, type OrganisationLike } from "./match";
import { resolveOwnerByEmail, type StaffPerson } from "./staff";
import { createOrganisationWithContacts, prepareNewOrganisation, updateOrganisationEmptyFields } from "./write";
import { websiteDomain } from "./normalise";

const existing: OrganisationLike[] = [
  { id: "o1", name: "Fictional Aurora Events LLC", roles: ["agency"], country_code: "AE", website: "https://www.aurora.example/about", place: null, note: null },
  { id: "o2", name: "Totally Different Name", roles: [], country_code: null, website: "aurora.example", place: null, note: null },
  { id: "o3", name: "Fictional Orbit Motors", roles: ["client"], country_code: null, website: null, place: null, note: null },
  { id: "o4", name: "Fictional Archived Co", roles: [], country_code: null, website: null, place: null, note: null, archived_at: "2026-01-01" },
];

describe("finding existing organisations", () => {
  it("matches the same normalised name, ignoring case, spaces and punctuation", () => {
    expect(findOrganisationMatches({ name: "FICTIONAL aurora-events, L.L.C" }, existing).map((m) => m.organisation.id)).toEqual(["o1"]);
  });
  it("matches an exact normalised name", () => {
    expect(findOrganisationMatches({ name: "fictional  AURORA events llc" }, existing).map((m) => [m.organisation.id, m.reasons])).toEqual([["o1", ["name"]]]);
  });
  it("matches the same website domain whatever the scheme, www or path, and ranks name+website first", () => {
    const m = findOrganisationMatches({ name: "Fictional Aurora Events LLC", website: "HTTP://aurora.example/contact?x=1" }, existing);
    expect(m.map((x) => [x.organisation.id, x.reasons])).toEqual([["o1", ["name", "website"]], ["o2", ["website"]]]);
  });
  it("never matches on nothing, and skips archived organisations", () => {
    expect(findOrganisationMatches({ name: "", website: "" }, existing)).toEqual([]);
    expect(findOrganisationMatches({ name: "Fictional Archived Co" }, existing)).toEqual([]);
    expect(websiteDomain("not a site")).toBeNull();
  });
});

describe("update only empty fields", () => {
  it("fills what is empty and leaves what is recorded, saying what it skipped", () => {
    const { patch, skipped } = planEmptyFieldUpdate(existing[0]!, { country_code: "SA", website: "https://other.example", place: "Dubai", note: "Met at Gulf Expo (fictional)", roles: ["technology"] });
    expect(patch).toEqual({ place: "Dubai", note: "Met at Gulf Expo (fictional)" });
    expect(skipped.sort()).toEqual(["country_code", "roles", "website"]);
  });
  it("fills roles only when none are recorded, and sends nothing when there is nothing to fill", () => {
    expect(planEmptyFieldUpdate(existing[1]!, { roles: ["client", "technology"], website: "aurora.example" }).patch).toEqual({ roles: ["client", "technology"] });
    expect(planEmptyFieldUpdate(existing[0]!, { country_code: "AE", website: "https://www.aurora.example/about" })).toEqual({ patch: {}, skipped: [] });
  });
});

describe("filling in an incomplete imported-style profile later", () => {
  it("creates a profile from the name alone, then fills only the empty fields through the database function", async () => {
    const rpc = vi.fn(async (fn: string) => ({ data: fn === "crm_create_organisation_profile" ? "new-org" : null, error: null }));
    const created = await createOrganisationWithContacts({ rpc } as never, { name: "  Fictional Imported Co  " });
    expect(created).toEqual({ ok: true, id: "new-org" });
    expect(rpc).toHaveBeenCalledWith("crm_create_organisation_profile", expect.objectContaining({ p_name: "Fictional Imported Co", p_roles: [], p_country_code: null, p_website: null, p_contacts: [], p_company_id: null, p_owner_id: null }));

    const incomplete: OrganisationLike = { id: "new-org", name: "Fictional Imported Co", roles: [], country_code: null, website: null, place: null, note: null };
    const filled = await updateOrganisationEmptyFields({ rpc } as never, incomplete, { country_code: "United Arab Emirates", website: "imported.example", roles: ["direct", "technology"], note: "Introduced at Gulf Expo (fictional)" });
    expect(filled).toEqual({ ok: true, changed: ["country_code", "website", "note", "roles"], skipped: [] });
    expect(rpc).toHaveBeenLastCalledWith("crm_update_organisation", { p_org: "new-org", p_patch: { country_code: "AE", website: "imported.example", note: "Introduced at Gulf Expo (fictional)", roles: ["direct", "technology"] } });
    // a second pass changes nothing and sends nothing
    rpc.mockClear();
    const again = await updateOrganisationEmptyFields({ rpc } as never, { ...incomplete, roles: ["direct", "technology"], country_code: "AE", website: "imported.example", note: "x" }, { country_code: "SA", note: "y" });
    expect(again).toEqual({ ok: true, changed: [], skipped: ["country_code", "note"] });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses an unrecognised country instead of guessing", async () => {
    const rpc = vi.fn();
    const r = await updateOrganisationEmptyFields({ rpc } as never, existing[2]!, { country_code: "Atlantis" });
    expect(r).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes the database refusal on in plain words", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "Only the person who added this organisation, a founder, or the owner of an opportunity it is on can change it" } }));
    const r = await updateOrganisationEmptyFields({ rpc } as never, existing[2]!, { place: "Riyadh" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Only the person who added/) });
  });
});

describe("one organisation with several contacts", () => {
  it("sends every contact in one call, drops a repeated e-mail, and refuses a bad one before calling the database", async () => {
    const p = prepareNewOrganisation({
      name: "Fictional Multi", roles: ["agency", "technology"], country_code: "uae", website: "https://multi.example",
      contacts: [
        { name: "Noor A", role_title: "Producer", email: "Noor@Multi.example", phone: "+971 50 000 0001" },
        { name: "Noor A (again)", email: "noor@multi.example" },
        { name: "Ravi B", phone: "+971 50 000 0002" },
      ],
    });
    expect(p).toMatchObject({ ok: true });
    if (p.ok) {
      expect(p.args).toMatchObject({ p_roles: ["agency", "technology"], p_country_code: "AE" });
      expect(p.args.p_contacts).toEqual([
        { name: "Noor A", role_title: "Producer", email: "noor@multi.example", phone: "+971 50 000 0001" },
        { name: "Ravi B", role_title: null, email: null, phone: "+971 50 000 0002" },
      ]);
    }
    expect(prepareNewOrganisation({ name: "X", contacts: [{ name: "Bad", email: "nope" }] })).toMatchObject({ ok: false });
    expect(prepareNewOrganisation({ name: "X", contacts: [{ name: " " }] })).toMatchObject({ ok: false });
    expect(prepareNewOrganisation({ name: " " })).toMatchObject({ ok: false });
    expect(prepareNewOrganisation({ name: "X", lead_source: "exhibition" })).toMatchObject({ ok: false, error: expect.stringMatching(/company/) });
  });
});

describe("owner e-mail to an eligible person of the selected company", () => {
  const A = "company-a", B = "company-b";
  const staff: StaffPerson[] = [
    { userId: "sara", name: "Sara", email: "Sara@Fictional.example", companyIds: [A] },
    { userId: "omar", name: "Omar", email: "omar@fictional.example", companyIds: [B] },
  ];
  it("resolves only people with access in that company", () => {
    expect(resolveOwnerByEmail("sara@fictional.example", A, staff)).toMatchObject({ status: "eligible", person: { userId: "sara" } });
    expect(resolveOwnerByEmail("omar@fictional.example", A, staff)).toMatchObject({ status: "not_in_company" });
    expect(resolveOwnerByEmail("nobody@fictional.example", A, staff)).toEqual({ status: "unknown" });
    expect(resolveOwnerByEmail("", A, staff)).toEqual({ status: "unknown" });
  });
  it("says addresses are hidden (rather than 'unknown') when the database does not show them to this caller", () => {
    expect(resolveOwnerByEmail("sara@fictional.example", A, staff.map((p) => ({ ...p, email: null })))).toEqual({ status: "emails_hidden" });
  });
});
