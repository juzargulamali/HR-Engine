import type { CrmOrganisationRole } from "@/types/crm";
import { cleanIdentifier, cleanText, normaliseName, normaliseWebsite, websiteDomain } from "./normalise";

/** The fields of an organisation the matcher and the empty-field updater read. */
export interface OrganisationLike {
  id: string;
  name: string;
  roles: readonly CrmOrganisationRole[];
  country_code: string | null;
  website: string | null;
  place: string | null;
  note: string | null;
  vat_trn?: string | null;
  trade_licence_no?: string | null;
  archived_at?: string | null;
}

export interface OrganisationMatch<T extends OrganisationLike = OrganisationLike> {
  organisation: T;
  /** Why it is a candidate. Both reasons is the strongest match. */
  reasons: ("name" | "website")[];
}

/**
 * Candidate existing organisations for an incoming name/website: the SAME normalised name (case, spaces and punctuation ignored,
 * as the database's name_key) or the SAME website domain. Strongest first. It never decides: the caller (the form, or the import
 * preview) shows the candidates and a person chooses; an incoming row with no name and no domain matches nothing.
 */
export function findOrganisationMatches<T extends OrganisationLike>(
  candidate: { name?: string | null; website?: string | null },
  existing: readonly T[],
): OrganisationMatch<T>[] {
  const key = normaliseName(candidate.name);
  const domain = websiteDomain(candidate.website);
  if (!key && !domain) return [];
  const out: OrganisationMatch<T>[] = [];
  for (const o of existing) {
    if (o.archived_at) continue;
    const reasons: OrganisationMatch["reasons"] = [];
    if (key && normaliseName(o.name) === key) reasons.push("name");
    if (domain && websiteDomain(o.website) === domain) reasons.push("website");
    if (reasons.length) out.push({ organisation: o, reasons });
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || a.organisation.name.localeCompare(b.organisation.name));
}

export interface IncomingOrganisationFields {
  roles?: readonly CrmOrganisationRole[] | null;
  country_code?: string | null;
  website?: string | null;
  place?: string | null;
  note?: string | null;
  vat_trn?: string | null;
  trade_licence_no?: string | null;
}

/**
 * "Update only empty fields": the patch that fills what the existing record has not recorded and leaves everything already recorded
 * untouched (the name is never changed here). `skipped` lists the fields where the incoming value was ignored because a value exists,
 * so an import preview can say so. Pass the patch to crm_update_organisation (the database still decides who may edit).
 */
export function planEmptyFieldUpdate(
  existing: OrganisationLike,
  incoming: IncomingOrganisationFields,
): { patch: Record<string, unknown>; skipped: string[] } {
  const patch: Record<string, unknown> = {};
  const skipped: string[] = [];
  const take = (field: "country_code" | "website" | "place" | "note", value: string | null | undefined) => {
    const v = field === "website" ? normaliseWebsite(value).website : cleanText(value);
    if (v == null) return;
    if (cleanText(existing[field]) == null) patch[field] = v;
    else if (existing[field] !== v) skipped.push(field);
  };
  take("country_code", incoming.country_code);
  take("website", incoming.website);
  take("place", incoming.place);
  take("note", incoming.note);
  // Identifiers: fill-only, compared exactly (leading zeros matter); an existing different value is never replaced.
  for (const field of ["vat_trn", "trade_licence_no"] as const) {
    const v = cleanIdentifier(incoming[field]);
    if (v == null) continue;
    const have = cleanIdentifier(existing[field]);
    if (have == null) patch[field] = v;
    else if (have !== v) skipped.push(field);
  }
  if (incoming.roles && incoming.roles.length > 0) {
    if (existing.roles.length === 0) patch.roles = [...incoming.roles];
    else if (incoming.roles.some((r) => !existing.roles.includes(r))) skipped.push("roles");
  }
  return { patch, skipped };
}
