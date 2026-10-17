import type { CrmContactRow, CrmOrganisationRow } from "@/types/crm";

/**
 * Pure helpers for the contacts panel (no React, no server-only imports) so they can be unit tested.
 * Contacts are SHARED records: these only decide what to offer in the picker; the database enforces who may change what.
 */

export interface PickerOrganisation {
  id: string;
  name: string;
  kind: CrmOrganisationRow["kind"];
}

export interface PickerContact {
  id: string;
  name: string;
  roleTitle: string | null;
  email: string | null;
  organisationId: string | null;
  organisationName: string | null;
}

export interface ContactPickerData {
  organisations: PickerOrganisation[];
  /** Everyone who could be added: every contact of every organisation except those already on this opportunity. */
  contacts: PickerContact[];
  /** Organisation preselected for a brand-new person (the agency, else the end client, of this opportunity). */
  defaultOrganisationId: string | null;
}

/** Flattens the organisations list into plain, serialisable picker data, leaving out contacts already on the opportunity. */
export function buildContactPicker(
  organisations: readonly (Pick<CrmOrganisationRow, "id" | "name" | "kind"> & { contacts: readonly CrmContactRow[] })[],
  linkedContactIds: Iterable<string>,
  defaultOrganisationId: string | null,
  /** Contacts recorded without any organisation; offered too, shown by name only. */
  unassignedContacts: readonly CrmContactRow[] = [],
): ContactPickerData {
  const linked = new Set(linkedContactIds);
  const contacts: PickerContact[] = [];
  for (const o of organisations) {
    for (const c of o.contacts) {
      if (linked.has(c.id) || c.archived_at) continue;
      contacts.push({ id: c.id, name: c.name, roleTitle: c.role_title, email: c.email, organisationId: o.id, organisationName: o.name });
    }
  }
  for (const c of unassignedContacts) {
    if (linked.has(c.id) || c.archived_at) continue;
    contacts.push({ id: c.id, name: c.name, roleTitle: c.role_title, email: c.email, organisationId: null, organisationName: null });
  }
  contacts.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.organisationName ?? "").localeCompare(b.organisationName ?? "", "en", { sensitivity: "base" }));
  return {
    organisations: organisations.map((o) => ({ id: o.id, name: o.name, kind: o.kind })),
    contacts,
    defaultOrganisationId,
  };
}

/** Case-insensitive match on name, organisation, job title or email; every word typed must match something. */
export function filterPickerContacts(contacts: readonly PickerContact[], query: string): PickerContact[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...contacts];
  return contacts.filter((c) => {
    const haystack = [c.name, c.organisationName, c.roleTitle, c.email].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

/** "Asha Rao — Gulf Events (Event manager)": organisation next to the name so two people with one name can be told apart. */
export function pickerOptionLabel(c: Pick<PickerContact, "name" | "organisationName" | "roleTitle">): string {
  return `${c.name} — ${c.organisationName ?? "No organisation"}${c.roleTitle ? ` (${c.roleTitle})` : ""}`;
}

/** The one-line reason shown when the viewer cannot change who is on the opportunity; null when they can. */
export function contactsAccessNote(input: { isLost: boolean; canChange: boolean }): string | null {
  if (input.canChange) return null;
  return input.isLost ? "Reopen it first: a lost opportunity's contacts cannot be changed." : "Only the owner or a founder can change who is on this opportunity.";
}
