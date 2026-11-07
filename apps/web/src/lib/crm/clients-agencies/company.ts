/** The Enginious company a Clients & Agencies page is scoped to: the requested one if the person holds a CRM grant for it, otherwise their first. Null with no grant. */
export function selectCompany<T extends { id: string }>(companies: readonly T[], requested: string | null | undefined): T | null {
  return companies.find((c) => c.id === requested) ?? companies[0] ?? null;
}
