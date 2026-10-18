import { describe, expect, it } from "vitest";
import type { CrmContactRow } from "@/types/crm";
import { buildContactPicker, contactsAccessNote, filterPickerContacts, pickerOptionLabel } from "./contact-helpers";

const contact = (id: string, name: string, extra: Partial<CrmContactRow> = {}): CrmContactRow => ({
  id, organisation_id: "o1", name, role_title: null, email: null, email_key: null, phone: null, created_by: null, created_at: "t", updated_at: "t", archived_at: null, ...extra,
});
const orgs = [
  { id: "o1", name: "Gulf Events", kind: "agency" as const, contacts: [contact("c2", "Zainab Ali", { email: "zainab@gulf.example", role_title: "Producer" }), contact("c1", "asha rao")] },
  { id: "o2", name: "Marina Hotels", kind: "client" as const, contacts: [contact("c3", "Asha Rao", { organisation_id: "o2" }), contact("c4", "Gone", { organisation_id: "o2", archived_at: "t" })] },
];

describe("buildContactPicker", () => {
  it("leaves out contacts already on the opportunity and archived ones", () => {
    const picker = buildContactPicker(orgs, ["c2"], "o1");
    expect(picker.contacts.map((c) => c.id)).toEqual(["c1", "c3"]);
  });
  it("sorts by name ignoring case and keeps the organisation beside each name", () => {
    const picker = buildContactPicker(orgs, [], null);
    expect(picker.contacts.map((c) => `${c.name}|${c.organisationName}`)).toEqual(["asha rao|Gulf Events", "Asha Rao|Marina Hotels", "Zainab Ali|Gulf Events"]);
  });
  it("offers every organisation and the default for a new person", () => {
    const picker = buildContactPicker(orgs, [], "o2");
    expect(picker.organisations.map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(picker.defaultOrganisationId).toBe("o2");
  });
  it("is empty when everyone is already on it", () => expect(buildContactPicker(orgs, ["c1", "c2", "c3"], null).contacts).toEqual([]));
});

describe("filterPickerContacts", () => {
  const all = buildContactPicker(orgs, [], null).contacts;
  it("returns everyone for a blank search", () => expect(filterPickerContacts(all, "  ")).toHaveLength(3));
  it("matches name, organisation, job title and email", () => {
    expect(filterPickerContacts(all, "marina").map((c) => c.id)).toEqual(["c3"]);
    expect(filterPickerContacts(all, "producer").map((c) => c.id)).toEqual(["c2"]);
    expect(filterPickerContacts(all, "ZAINAB@GULF").map((c) => c.id)).toEqual(["c2"]);
  });
  it("needs every word to match, in any order", () => {
    expect(filterPickerContacts(all, "rao gulf").map((c) => c.id)).toEqual(["c1"]);
    expect(filterPickerContacts(all, "gulf marina")).toEqual([]);
  });
});

describe("pickerOptionLabel", () => {
  it("shows organisation next to the name and the job title", () => expect(pickerOptionLabel({ name: "Zainab Ali", organisationName: "Gulf Events", roleTitle: "Producer" })).toBe("Zainab Ali — Gulf Events (Producer)"));
  it("says when there is no organisation", () => expect(pickerOptionLabel({ name: "X", organisationName: null, roleTitle: null })).toBe("X — No organisation"));
});

describe("contactsAccessNote", () => {
  it("is silent for people who can change contacts", () => expect(contactsAccessNote({ isLost: false, canChange: true })).toBeNull());
  it("says who can change contacts", () => expect(contactsAccessNote({ isLost: false, canChange: false })).toBe("Only the owner or a founder can change who is on this opportunity."));
  it("says to reopen a lost one first", () => expect(contactsAccessNote({ isLost: true, canChange: false })).toMatch(/^Reopen it first/));
});

describe("buildContactPicker with people who have no organisation", () => {
  it("offers them too, by name only, unless already linked or archived", () => {
    const loose = [
      { id: "c1", organisation_id: null, name: "Freelance Fay", role_title: null, email: null, archived_at: null },
      { id: "c2", organisation_id: null, name: "Linked Lee", role_title: null, email: null, archived_at: null },
      { id: "c3", organisation_id: null, name: "Archived Al", role_title: null, email: null, archived_at: "2026-01-01" },
    ] as never[];
    const out = buildContactPicker([], ["c2"], null, loose);
    expect(out.contacts.map((c) => c.name)).toEqual(["Freelance Fay"]);
    expect(out.contacts[0]).toMatchObject({ organisationId: null, organisationName: null });
  });
});

