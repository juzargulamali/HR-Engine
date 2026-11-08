import type { CrmLeadSource, CrmOrganisationRole } from "@/types/crm";

/**
 * Shared normalisers for Clients & Agencies. Pure and import-safe: the account directory, the edit forms and the Part 2
 * Excel import all call these, so "the same organisation" means the same thing everywhere.
 */

export const ORGANISATION_ROLES = ["agency", "direct", "client", "technology"] as const satisfies readonly CrmOrganisationRole[];
export const ROLE_LABEL: Record<CrmOrganisationRole, string> = { agency: "Agency", direct: "Direct client", client: "End client", technology: "Technology company" };
export const LEAD_SOURCES = ["agency_call", "linkedin", "direct_client", "whatsapp", "instagram", "website", "referral", "exhibition", "other"] as const satisfies readonly CrmLeadSource[];
export const LEAD_SOURCE_LABEL: Record<CrmLeadSource, string> = {
  agency_call: "Agency call", linkedin: "LinkedIn", direct_client: "Direct client", whatsapp: "WhatsApp", instagram: "Instagram",
  website: "Website", referral: "Referral", exhibition: "Exhibition", other: "Other",
};

/** Mirrors crm_organisations.name_key (lower-case letters and digits only), so "Zeta Media L.L.C." and "ZETA MEDIA LLC" collide. */
export const normaliseName = (name: string | null | undefined): string => (name ?? "").replace(/[^A-Za-z0-9]+/g, "").toLowerCase();

/** Mirrors crm_contacts.email (same pattern) and email_key (lower-case). Null when empty or not an address. */
export function normaliseEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/** Mirrors crm_organisations.website_domain: no scheme, no "www.", no path, port or query; lower-case. */
export function websiteDomain(website: string | null | undefined): string | null {
  const w = (website ?? "").trim();
  if (!w) return null;
  const d = w.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "").replace(/^www\./i, "").replace(/[/?#:].*$/, "").toLowerCase();
  return d === "" || !d.includes(".") ? null : d;
}

/** The website as it should be stored (trimmed; a bare "example.com" is kept as typed) plus its matching domain. */
export function normaliseWebsite(website: string | null | undefined): { website: string | null; domain: string | null } {
  const w = (website ?? "").trim();
  return { website: w === "" ? null : w, domain: websiteDomain(w) };
}

const COUNTRY_ALIASES: Record<string, string> = {
  uae: "AE", "u.a.e.": "AE", emirates: "AE", "united arab emirates": "AE", ksa: "SA", "saudi": "SA", "saudi arabia": "SA",
  uk: "GB", "u.k.": "GB", "united kingdom": "GB", england: "GB", scotland: "GB", britain: "GB", "great britain": "GB",
  usa: "US", "u.s.a.": "US", "u.s.": "US", america: "US", "united states of america": "US", holland: "NL",
  turkey: "TR", turkiye: "TR", russia: "RU", "south korea": "KR", korea: "KR", czechia: "CZ", "czech republic": "CZ",
};

let countryByName: Map<string, string> | null = null;
function countryNames(): Map<string, string> {
  if (countryByName) return countryByName;
  const map = new Map<string, string>();
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const n = names.of(code);
      if (n && n !== code && !/^Unknown/i.test(n)) map.set(n.toLowerCase(), code);
    }
  } catch { /* no ICU names: aliases and two-letter codes still work */ }
  return (countryByName = map);
}

/** A country name, alias or two-letter code to the ISO two-letter code stored on the organisation; null when it is not recognised (never guessed). */
export function normaliseCountry(input: string | null | undefined): string | null {
  const v = (input ?? "").trim();
  if (!v) return null;
  if (/^[A-Za-z]{2}$/.test(v)) {
    const code = v.toUpperCase();
    // "UK" is not an ISO code; "GB" is.
    if (code === "UK") return "GB";
    return countryNames().size === 0 || [...countryNames().values()].includes(code) ? code : null;
  }
  const k = v.toLowerCase();
  return COUNTRY_ALIASES[k] ?? countryNames().get(k) ?? null;
}

export function countryLabel(code: string | null | undefined): string {
  if (!code) return "";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
}

const ROLE_WORDS: Record<string, CrmOrganisationRole> = {
  agency: "agency", agencies: "agency", direct: "direct", "direct client": "direct", "direct clients": "direct",
  client: "client", "end client": "client", "end clients": "client", "end-client": "client",
  technology: "technology", "technology company": "technology", tech: "technology", "tech company": "technology", "technology partner": "technology",
};

/** Roles from a list or a comma/semicolon/slash separated text ("Agency, End client"). Unknown words are returned, never dropped silently. */
export function normaliseRoles(input: readonly string[] | string | null | undefined): { roles: CrmOrganisationRole[]; unknown: string[] } {
  const parts = (Array.isArray(input) ? [...input] : String(input ?? "").split(/[,;/|]+/)).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const roles: CrmOrganisationRole[] = [];
  const unknown: string[] = [];
  for (const p of parts) {
    const r = ROLE_WORDS[p];
    if (!r) unknown.push(p);
    else if (!roles.includes(r)) roles.push(r);
  }
  return { roles: ORGANISATION_ROLES.filter((r) => roles.includes(r)), unknown };
}

/** Trim; empty becomes null. */
export const cleanText = (v: string | null | undefined): string | null => { const t = (v ?? "").trim(); return t === "" ? null : t; };
