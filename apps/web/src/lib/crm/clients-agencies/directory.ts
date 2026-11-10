import type { CrmAccountProfileRow, CrmContactRow, CrmLeadSource, CrmOrganisationRole, CrmOrganisationRow } from "@/types/crm";
import { LEAD_SOURCES, ORGANISATION_ROLES, countryLabel } from "./normalise";
import { dubaiDate, enquiryStats, type EnquiryStats, type OppLite } from "./account";
import { RELATIONSHIPS, RELATIONSHIP_RANK, relationshipOf, type Relationship } from "./relationship";

export const UNASSIGNED = "unassigned";
export const NOT_RECORDED = "none";

/** One organisation as the selected company sees it: shared record + this company's profile + this company's inquiry counts. */
export interface DirectoryRow {
  org: CrmOrganisationRow;
  contacts: CrmContactRow[];
  /** The selected company's profile of this organisation; null = nothing recorded yet, which reads as "Unassigned". */
  profile: CrmAccountProfileRow | null;
  /** This company's enquiries linked to the account (counted once each); null = the enquiries could not be read (never shown as zero). */
  stats: EnquiryStats | null;
  /** The ONE relationship badge; null exactly when `stats` is null. */
  relationship: Relationship | null;
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
  /** "" = all; otherwise the one relationship badge to show. */
  rel: "" | Relationship;
  /** The shared outreach priority: "" = any; "5" exactly 5; "4+" / "3+" = at least; "rated" = any rating; "unrated" = none given yet. */
  priority: "" | PriorityFilter;
}

/** Outreach priority (1 to 5, 5 highest; null = Unrated): ONE shared value per account, the team's own rating of who to approach, not a public review score. */
export const PRIORITIES = [5, 4, 3, 2, 1] as const;
export const PRIORITY_FILTERS = ["5", "4+", "3+", "rated", "unrated"] as const;
export type PriorityFilter = (typeof PRIORITY_FILTERS)[number];
export const PRIORITY_FILTER_LABEL: Record<PriorityFilter, string> = { "5": "5 (highest) only", "4+": "4 and above", "3+": "3 and above", rated: "Any rating", unrated: "Unrated" };
export const priorityLabel = (p: number | null | undefined) => (p ? `${p} of 5` : "Unrated");
export function matchesPriority(p: number | null, f: "" | PriorityFilter): boolean {
  switch (f) {
    case "": return true;
    case "unrated": return p === null;
    case "rated": return p !== null;
    case "5": return p === 5;
    case "4+": return p !== null && p >= 4;
    case "3+": return p !== null && p >= 3;
  }
}

export const EMPTY_FILTERS: DirectoryFilters = { q: "", role: "", country: "", owner: "", source: "", exhibition: "", rel: "", priority: "" };
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
    rel: (RELATIONSHIPS as readonly string[]).includes(one(sp.rel)) ? (one(sp.rel) as Relationship) : "",
    priority: (PRIORITY_FILTERS as readonly string[]).includes(one(sp.priority)) ? (one(sp.priority) as PriorityFilter) : "",
  };
}

export const hasFilters = (f: DirectoryFilters) => Object.values(f).some((v) => v !== "");

const contactText = (c: CrmContactRow) => `${c.name} ${c.role_title ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`;

export function filterDirectory(rows: readonly DirectoryRow[], f: DirectoryFilters): DirectoryRow[] {
  const needle = f.q.toLowerCase();
  const ex = f.exhibition.toLowerCase();
  return rows.filter((r) => {
    if (f.rel && r.relationship !== f.rel) return false;
    if (f.role === NOT_RECORDED ? r.org.roles.length > 0 : f.role !== "" && !r.org.roles.includes(f.role)) return false;
    if (f.country && r.org.country_code !== f.country) return false;
    if (!matchesPriority(r.org.outreach_priority ?? null, f.priority)) return false;
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

/** Joins the shared organisations with the selected company's profiles and enquiry figures (`enquiryStats`: an inquiry naming the organisation in two roles counts once). `opportunities` null = they could not be read. */
export function buildDirectoryRows(input: {
  organisations: readonly CrmOrganisationRow[];
  contacts: readonly CrmContactRow[];
  profiles: readonly CrmAccountProfileRow[];
  opportunities: readonly Pick<OppLite, "id" | "company_id" | "agency_org_id" | "client_org_id" | "stage" | "created_at">[] | null;
  companyId: string;
  now?: Date;
}): DirectoryRow[] {
  const contactsBy = new Map<string, CrmContactRow[]>();
  for (const c of input.contacts) if (c.organisation_id && !c.archived_at) contactsBy.set(c.organisation_id, [...(contactsBy.get(c.organisation_id) ?? []), c]);
  const profileBy = new Map(input.profiles.filter((p) => p.company_id === input.companyId).map((p) => [p.organisation_id, p]));
  const byOrg = new Map<string, NonNullable<typeof input.opportunities>[number][]>();
  for (const o of input.opportunities ?? []) {
    if (o.company_id !== input.companyId) continue;
    for (const orgId of new Set([o.agency_org_id, o.client_org_id])) if (orgId) byOrg.set(orgId, [...(byOrg.get(orgId) ?? []), o]);
  }
  const today = dubaiDate((input.now ?? new Date()).toISOString());
  return input.organisations
    .filter((o) => !o.archived_at)
    .map((org) => {
      const stats = input.opportunities === null ? null : enquiryStats(byOrg.get(org.id) ?? [], org.id, input.companyId);
      return { org, contacts: contactsBy.get(org.id) ?? [], profile: profileBy.get(org.id) ?? null, stats, relationship: stats ? relationshipOf(stats, today) : null };
    })
    .sort((a, b) => a.org.name.localeCompare(b.org.name));
}

/** Relationship filtering and counts need the enquiries: with any row's figures missing they are unavailable (and are not applied). */
export const relationshipAvailable = (rows: readonly DirectoryRow[]) => rows.every((r) => r.stats !== null);

/** How many accounts carry each badge, among the rows given (the caller passes the rows after search and the other filters, before the badge filter). */
export function relationshipCounts(rows: readonly DirectoryRow[]): Record<Relationship, number> {
  const out: Record<Relationship, number> = { won: 0, no_wins: 0, none: 0, dormant: 0 };
  for (const r of rows) if (r.relationship) out[r.relationship]++;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- sorting
export const SORT_KEYS = ["name", "country", "priority", "enquiries", "won", "last", "owner", "badge"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export interface DirectorySort { key: SortKey; dir: SortDir }
export const DEFAULT_SORT: DirectorySort = { key: "name", dir: "asc" };
/** The direction a column starts in when first clicked: counts and dates show the biggest / newest first. */
export const firstDir = (key: SortKey): SortDir => (key === "enquiries" || key === "won" || key === "last" || key === "priority" ? "desc" : "asc");

export function sortFromParams(sp: Record<string, string | string[] | undefined>): DirectorySort {
  const key = one(sp.sort);
  if (!(SORT_KEYS as readonly string[]).includes(key)) return DEFAULT_SORT;
  const dir = one(sp.dir);
  return { key: key as SortKey, dir: dir === "asc" || dir === "desc" ? dir : firstDir(key as SortKey) };
}

/** What a click on a column heading does: the active column flips direction, another column starts in its first direction. */
export const nextSort = (current: DirectorySort, key: SortKey): DirectorySort =>
  current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(key) };

/**
 * Sorts a copy. A missing value (no date, unknown figures, no country, Unassigned) is ALWAYS last, in both directions. Ties fall back to name A to Z
 * then id, so the order is stable and the same on every load.
 */
export function sortDirectory(rows: readonly DirectoryRow[], sort: DirectorySort, ownerName: (id: string | null) => string | null): DirectoryRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const value = (r: DirectoryRow): string | number | null => {
    switch (sort.key) {
      case "name": return r.org.name.toLowerCase();
      case "country": return r.org.country_code ? countryLabel(r.org.country_code).toLowerCase() : null;
      case "priority": return r.org.outreach_priority ?? null;
      case "enquiries": return r.stats?.total ?? null;
      case "won": return r.stats?.won ?? null;
      case "last": return r.stats ? r.stats.lastEnquiryOn : null;
      case "owner": return ownerName(r.profile?.owner_id ?? null)?.toLowerCase() ?? null;
      case "badge": return r.relationship ? RELATIONSHIP_RANK[r.relationship] : null;
    }
  };
  return [...rows].sort((a, b) => {
    const x = value(a); const y = value(b);
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    if (x !== null && y !== null && x !== y) return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sign;
    return a.org.name.localeCompare(b.org.name) || a.org.id.localeCompare(b.org.id);
  });
}
