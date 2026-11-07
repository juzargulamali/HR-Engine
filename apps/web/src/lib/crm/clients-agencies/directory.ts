import type { CrmAccountProfileRow, CrmContactRow, CrmLeadSource, CrmOrganisationRole, CrmOrganisationRow } from "@/types/crm";
import { LEAD_SOURCES, ORGANISATION_ROLES } from "./normalise";

export const UNASSIGNED = "unassigned";
export const NOT_RECORDED = "none";

/** One organisation as the selected company sees it: shared record + this company's profile + this company's inquiry counts. */
export interface DirectoryRow {
  org: CrmOrganisationRow;
  contacts: CrmContactRow[];
  /** The selected company's profile of this organisation; null = nothing recorded yet, which reads as "Unassigned". */
  profile: CrmAccountProfileRow | null;
  inquiryCount: number;
  openCount: number;
}

export interface DirectoryFilters {
  q: string;
  /** "" = any; "none" = no role recorded yet. */
  role: "" | CrmOrganisationRole | typeof NOT_RECORDED;
  country: string;
  /** "" = anyone; "unassigned"; or a person's user id. */
  owner: string;
  /** "" = any; "none" = not recorded; or a lead source. */
  source: "" | CrmLeadSource | typeof NOT_RECORDED;
  exhibition: string;
}

export const EMPTY_FILTERS: DirectoryFilters = { q: "", role: "", country: "", owner: "", source: "", exhibition: "" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Reads the filters from the page address. Anything not recognised is ignored (never trusted). */
export function filtersFromParams(sp: Record<string, string | string[] | undefined>): DirectoryFilters {
  const role = one(sp.role);
  const source = one(sp.source);
  const country = one(sp.country).trim().toUpperCase();
  return {
    q: one(sp.q).trim(),
    role: (ORGANISATION_ROLES as readonly string[]).includes(role) || role === NOT_RECORDED ? (role as DirectoryFilters["role"]) : "",
    country: /^[A-Z]{2}$/.test(country) ? country : "",
    owner: one(sp.owner).trim(),
    source: (LEAD_SOURCES as readonly string[]).includes(source) || source === NOT_RECORDED ? (source as DirectoryFilters["source"]) : "",
    exhibition: one(sp.exhibition).trim(),
  };
}

export const hasFilters = (f: DirectoryFilters) => Object.values(f).some((v) => v !== "");

const contactText = (c: CrmContactRow) => `${c.name} ${c.role_title ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`;

export function filterDirectory(rows: readonly DirectoryRow[], f: DirectoryFilters): DirectoryRow[] {
  const needle = f.q.toLowerCase();
  const ex = f.exhibition.toLowerCase();
  return rows.filter((r) => {
    if (f.role === NOT_RECORDED ? r.org.roles.length > 0 : f.role !== "" && !r.org.roles.includes(f.role)) return false;
    if (f.country && r.org.country_code !== f.country) return false;
    const owner = r.profile?.owner_id ?? null;
    if (f.owner === UNASSIGNED ? owner !== null : f.owner !== "" && owner !== f.owner) return false;
    const source = r.profile?.lead_source ?? null;
    if (f.source === NOT_RECORDED ? source !== null : f.source !== "" && source !== f.source) return false;
    if (ex && !(r.profile?.exhibition ?? "").toLowerCase().includes(ex)) return false;
    if (!needle) return true;
    const hay = `${r.org.name} ${r.org.place ?? ""} ${r.org.website ?? ""} ${r.org.note ?? ""} ${r.profile?.exhibition ?? ""} ${r.contacts.map(contactText).join(" ")}`.toLowerCase();
    return hay.includes(needle);
  });
}

/** Joins the shared organisations with the selected company's profiles and inquiry counts (an inquiry that names the organisation twice counts once). */
export function buildDirectoryRows(input: {
  organisations: readonly CrmOrganisationRow[];
  contacts: readonly CrmContactRow[];
  profiles: readonly CrmAccountProfileRow[];
  opportunities: readonly { company_id: string; agency_org_id: string | null; client_org_id: string | null; stage: string }[];
  companyId: string;
}): DirectoryRow[] {
  const contactsBy = new Map<string, CrmContactRow[]>();
  for (const c of input.contacts) if (c.organisation_id && !c.archived_at) contactsBy.set(c.organisation_id, [...(contactsBy.get(c.organisation_id) ?? []), c]);
  const profileBy = new Map(input.profiles.filter((p) => p.company_id === input.companyId).map((p) => [p.organisation_id, p]));
  const total = new Map<string, number>();
  const open = new Map<string, number>();
  for (const o of input.opportunities) {
    if (o.company_id !== input.companyId) continue;
    for (const orgId of new Set([o.agency_org_id, o.client_org_id])) {
      if (!orgId) continue;
      total.set(orgId, (total.get(orgId) ?? 0) + 1);
      if (o.stage !== "won" && o.stage !== "lost") open.set(orgId, (open.get(orgId) ?? 0) + 1);
    }
  }
  return input.organisations
    .filter((o) => !o.archived_at)
    .map((org) => ({ org, contacts: contactsBy.get(org.id) ?? [], profile: profileBy.get(org.id) ?? null, inquiryCount: total.get(org.id) ?? 0, openCount: open.get(org.id) ?? 0 }))
    .sort((a, b) => a.org.name.localeCompare(b.org.name));
}
