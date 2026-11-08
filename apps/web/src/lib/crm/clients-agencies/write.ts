import type { CrmOrganisationRole } from "@/types/crm";
import type { createClient } from "@/lib/supabase/server";
import { friendlyCrmError } from "../errors";
import { planEmptyFieldUpdate, type IncomingOrganisationFields, type OrganisationLike } from "./match";
import { cleanIdentifier, cleanText, IDENTIFIER_MAX, IDENTIFIER_TOO_LONG, normaliseCountry, normaliseEmail, normaliseName, normaliseWebsite, ORGANISATION_ROLES } from "./normalise";

type Db = Pick<Awaited<ReturnType<typeof createClient>>, "rpc">;

export type WriteResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ContactInput { name: string; role_title?: string | null; email?: string | null; phone?: string | null }

export interface NewOrganisationInput {
  /** The only required field. */
  name: string;
  roles?: readonly CrmOrganisationRole[];
  country_code?: string | null;
  website?: string | null;
  place?: string | null;
  note?: string | null;
  /** VAT registration number / TRN and trade licence number (optional text; leading zeros kept). */
  vat_trn?: string | null;
  trade_licence_no?: string | null;
  /** The Enginious company the profile fields below are for. Required when any of them is given. */
  companyId?: string | null;
  lead_source?: string | null;
  exhibition?: string | null;
  /** Needs the assign_owner capability in `companyId`; the person must hold CRM access there. The database decides. */
  ownerId?: string | null;
  contacts?: readonly ContactInput[];
}

/** Validates and normalises an organisation (and its contacts) and returns the exact RPC arguments, or why it cannot be saved. */
export function prepareNewOrganisation(input: NewOrganisationInput): WriteResult<{ args: Record<string, unknown> }> {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Enter the name." };
  if (name.length > 200) return { ok: false, error: "The name is too long (200 characters at most)." };
  const roles = [...new Set(input.roles ?? [])];
  const bad = roles.find((r) => !(ORGANISATION_ROLES as readonly string[]).includes(r));
  if (bad) return { ok: false, error: `Unknown role "${bad}".` };
  let country: string | null = null;
  if (cleanText(input.country_code)) {
    country = normaliseCountry(input.country_code);
    if (!country) return { ok: false, error: "That country is not recognised. Use its name or two-letter code." };
  }
  const vat = cleanIdentifier(input.vat_trn);
  const licence = cleanIdentifier(input.trade_licence_no);
  if ((vat?.length ?? 0) > IDENTIFIER_MAX || (licence?.length ?? 0) > IDENTIFIER_MAX) return { ok: false, error: IDENTIFIER_TOO_LONG };
  const contacts: Record<string, string | null>[] = [];
  const seenEmails = new Set<string>();
  for (const c of input.contacts ?? []) {
    const cn = (c.name ?? "").trim();
    if (!cn) return { ok: false, error: "Every contact needs a name." };
    const rawEmail = cleanText(c.email);
    const email = normaliseEmail(rawEmail);
    if (rawEmail && !email) return { ok: false, error: `The email address for ${cn} does not look right.` };
    if (email) { if (seenEmails.has(email)) continue; seenEmails.add(email); }
    contacts.push({ name: cn, role_title: cleanText(c.role_title), email: rawEmail ? email : null, phone: cleanText(c.phone) });
  }
  const profileGiven = !!(cleanText(input.lead_source) || cleanText(input.exhibition) || input.ownerId);
  if (profileGiven && !input.companyId) return { ok: false, error: "Choose the company these details are for." };
  return {
    ok: true,
    args: {
      p_name: name, p_roles: roles, p_country_code: country, p_website: normaliseWebsite(input.website).website, p_place: cleanText(input.place), p_note: cleanText(input.note),
      p_company_id: input.companyId ?? null, p_lead_source: cleanText(input.lead_source), p_exhibition: cleanText(input.exhibition), p_owner_id: input.ownerId ?? null, p_contacts: contacts, p_vat_trn: vat, p_trade_licence_no: licence,
    },
  };
}

/** Creates an organisation with its contacts in one database call (all or nothing). Only the name is required. */
export async function createOrganisationWithContacts(db: Db, input: NewOrganisationInput): Promise<WriteResult<{ id: string }>> {
  const prepared = prepareNewOrganisation(input);
  if (!prepared.ok) return prepared;
  const { data, error } = await db.rpc("crm_create_organisation_profile", prepared.args as never);
  if (error || !data) return { ok: false, error: friendlyCrmError(error?.message ?? "Could not save.") };
  return { ok: true, id: data as string };
}

/** Fills only what the existing record has not recorded (see planEmptyFieldUpdate). Nothing already recorded is overwritten. */
export async function updateOrganisationEmptyFields(
  db: Db,
  existing: OrganisationLike,
  incoming: IncomingOrganisationFields,
): Promise<WriteResult<{ changed: string[]; skipped: string[] }>> {
  const country = incoming.country_code == null ? incoming.country_code : normaliseCountry(incoming.country_code);
  if (cleanText(incoming.country_code) && !country) return { ok: false, error: "That country is not recognised. Use its name or two-letter code." };
  const { patch, skipped } = planEmptyFieldUpdate(existing, { ...incoming, country_code: country });
  if (Object.keys(patch).length === 0) return { ok: true, changed: [], skipped };
  const { error } = await db.rpc("crm_update_organisation", { p_org: existing.id, p_patch: patch });
  if (error) return { ok: false, error: friendlyCrmError(error.message) };
  return { ok: true, changed: Object.keys(patch), skipped };
}

export { normaliseName };
