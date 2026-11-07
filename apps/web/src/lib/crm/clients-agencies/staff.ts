import { normaliseEmail } from "./normalise";

/** A person who holds CRM access, as crm_people() returns them. `email` is null unless the caller is a Sales founder (the database decides). */
export interface StaffPerson {
  userId: string;
  name: string;
  email: string | null;
  companyIds: readonly string[];
}

export type OwnerResolution =
  | { status: "eligible"; person: StaffPerson }
  | { status: "not_in_company"; person: StaffPerson }
  | { status: "unknown" }
  | { status: "emails_hidden" };

/** People who may own accounts or follow-ups for a company: an active CRM grant for it (the database re-checks on every assignment). */
export const eligibleStaff = (people: readonly StaffPerson[], companyId: string): StaffPerson[] =>
  people.filter((p) => p.companyIds.includes(companyId));

/**
 * Owner e-mail to an eligible person of the selected company. E-mail addresses reach the caller only when the database shows them
 * (crm_people hides them from everyone but a Sales founder), so for anyone else this says "emails_hidden" instead of guessing.
 */
export function resolveOwnerByEmail(email: string | null | undefined, companyId: string, people: readonly StaffPerson[]): OwnerResolution {
  const e = normaliseEmail(email);
  if (!e) return { status: "unknown" };
  if (people.length > 0 && people.every((p) => p.email == null)) return { status: "emails_hidden" };
  const person = people.find((p) => normaliseEmail(p.email) === e);
  if (!person) return { status: "unknown" };
  return person.companyIds.includes(companyId) ? { status: "eligible", person } : { status: "not_in_company", person };
}
