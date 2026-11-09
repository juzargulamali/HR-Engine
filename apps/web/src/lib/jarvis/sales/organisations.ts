import type { SupabaseClient } from "@supabase/supabase-js";
import { organisationNameKey } from "@enginious-hr/domain";
import { hasRoleFor, type InquiryField } from "@/lib/crm/organisation-roles";
import type { OrgChoice, OrgField, OrgOption } from "../protocol";

/**
 * Organisation look-ups for the brief. They run through the signed-in person's OWN session (RLS: crm_organisations_select needs a Sales grant), return only id, name
 * and place, and never create anything: an organisation that is not found is reported with "register it first" guidance (creating organisations is a separate, later,
 * disabled action). What the brief says is only ever a search text: an id is accepted only when it is re-read here as a visible organisation with the right role.
 */
type Row = { id: string; name: string; kind: string; roles: string[] | null; place: string | null; name_key: string };

const FIELD_LABEL: Record<OrgField, string> = { agency: "agency", client: "end client" };
const ROLE_LABEL: Record<OrgField, string> = { agency: "Agency", client: "End client or Direct client" };
const toOption = (o: Row): OrgOption => ({ id: o.id, name: o.name, place: o.place });
const field = (f: OrgField): InquiryField => f;

export class OrgLookupError extends Error {}

const empty = (f: OrgField, typedName: string | null): OrgChoice => ({ field: f, typedName, status: "none", selectedId: null, selectedName: null, options: [], guidance: null });

async function candidates(supabase: SupabaseClient, name: string): Promise<Row[]> {
  const key = organisationNameKey(name);
  const word = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).sort((a, b) => b.length - a.length)[0];
  if (key.length < 3 || !word) return [];
  const r = await supabase.from("crm_organisations").select("id, name, kind, roles, place, name_key").is("archived_at", null).ilike("name_key", `%${word.replace(/[%_\\]/g, "")}%`).limit(25);
  if (r.error) throw new OrgLookupError("organisations could not be read");
  return (r.data ?? []) as Row[];
}

/** Search the visible organisations for what the brief (or the person) typed, for one field. A single exact match with the right role is selected; everything else is a question. */
export async function lookupOrganisation(supabase: SupabaseClient, f: OrgField, typed: string | null | undefined): Promise<OrgChoice> {
  const name = (typed ?? "").trim().slice(0, 200);
  if (!name) return empty(f, null);
  const key = organisationNameKey(name);
  const rows = await candidates(supabase, name);
  const matches = rows.filter((o) => o.name_key === key || (key.length >= 4 && o.name_key.includes(key)) || (o.name_key.length >= 5 && key.includes(o.name_key)));
  const roleOk = matches.filter((o) => hasRoleFor(o, field(f)));
  const exact = roleOk.filter((o) => o.name_key === key);
  const base = empty(f, name);
  if (exact.length === 1) return { ...base, status: "matched", selectedId: exact[0]!.id, selectedName: exact[0]!.name, options: [toOption(exact[0]!)] };
  const pool = exact.length > 1 ? exact : roleOk;
  if (pool.length === 1) return { ...base, status: "suggested", options: [toOption(pool[0]!)], guidance: `Is "${pool[0]!.name}" the ${FIELD_LABEL[f]}? Choose it to confirm.` };
  if (pool.length > 1) return { ...base, status: "ambiguous", options: pool.slice(0, 8).map(toOption), guidance: `More than one organisation could be the ${FIELD_LABEL[f]} "${name}". Choose the right one.` };
  if (matches.length > 0) return { ...base, status: "wrong_role", options: [], guidance: `"${matches[0]!.name}" exists but is not recorded as ${f === "agency" ? "an agency" : "an end client or direct client"}. Add the ${ROLE_LABEL[f]} role to it in Clients & Agencies first, or choose another organisation.` };
  return { ...base, status: "not_found", guidance: `No organisation called "${name}" is recorded. Register it in Clients & Agencies first; JARVIS never creates an organisation by itself.` };
}

/** Re-read one organisation id as the person sees it: visible, not archived, and carrying the role the field needs. Never trusts an id that came from the model or the browser. */
export async function verifyOrganisation(supabase: SupabaseClient, f: OrgField, id: string | null): Promise<{ ok: true; name: string | null } | { ok: false; reason: "not_found" | "wrong_role" }> {
  if (!id) return { ok: true, name: null };
  const r = await supabase.from("crm_organisations").select("id, name, kind, roles, place, name_key").eq("id", id).is("archived_at", null).maybeSingle();
  if (r.error) throw new OrgLookupError("organisation could not be read");
  const o = r.data as Row | null;
  if (!o) return { ok: false, reason: "not_found" };
  if (!hasRoleFor(o, field(f))) return { ok: false, reason: "wrong_role" };
  return { ok: true, name: o.name };
}

export const selectedChoice = (f: OrgField, typed: string | null, id: string, name: string | null): OrgChoice => ({ ...empty(f, typed), status: "matched", selectedId: id, selectedName: name, options: name ? [{ id, name, place: null }] : [] });
export { empty as emptyChoice };
