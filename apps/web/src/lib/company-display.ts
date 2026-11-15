/**
 * The short name a company is shown by in selectors: "Enginious UAE", "Enginious Saudi Arabia", "Enginious Europe".
 *
 * A company row holds one name, its LEGAL name (`companies.legal_name`, for example "Enginious LLC"), and its country. Documents and company settings keep
 * the legal name. A selector needs something a person recognises at a glance, so the short name is worked out from the company's COUNTRY, the same fact the
 * Sales chat groups and the follow-up time zones already use (AE, SA, and the one European company). Nothing is stored and nothing is renamed.
 *
 * Two companies must never share a short name: when two of the companies in hand fall in the same group (two in the UAE, say), or a company is in a country
 * outside the list, its legal name is shown instead. Pure, shared by the server pages; no permission is decided here.
 */
export type CompanyGroup = "uae" | "ksa" | "europe";

const EUROPE = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "CH", "NO", "IS"]);
export const COMPANY_GROUP_NAME: Record<CompanyGroup, string> = { uae: "Enginious UAE", ksa: "Enginious Saudi Arabia", europe: "Enginious Europe" };
const GROUP_ORDER: readonly CompanyGroup[] = ["uae", "ksa", "europe"];

export function companyGroup(countryCode: string | null | undefined): CompanyGroup | null {
  const c = (countryCode ?? "").trim().toUpperCase();
  if (c === "AE") return "uae";
  if (c === "SA") return "ksa";
  return EUROPE.has(c) ? "europe" : null;
}

export interface CompanyNameInput { id: string; legalName: string; countryCode: string | null | undefined }

/** The short name of each company, by id. A group shared by two of these companies, or an unknown country, keeps the legal name. */
export function companyDisplayNames(companies: readonly CompanyNameInput[]): Map<string, string> {
  const perGroup = new Map<CompanyGroup, number>();
  for (const c of companies) { const g = companyGroup(c.countryCode); if (g) perGroup.set(g, (perGroup.get(g) ?? 0) + 1); }
  return new Map(companies.map((c) => {
    const g = companyGroup(c.countryCode);
    return [c.id, g && perGroup.get(g) === 1 ? COMPANY_GROUP_NAME[g] : c.legalName] as const;
  }));
}

/** UAE, Saudi Arabia, Europe, then any other company by its legal name: the order the selector lists them in. */
export function sortCompaniesForDisplay<T extends CompanyNameInput>(companies: readonly T[]): T[] {
  const rank = (c: T) => { const g = companyGroup(c.countryCode); return g ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length; };
  return [...companies].sort((a, b) => rank(a) - rank(b) || a.legalName.localeCompare(b.legalName));
}
