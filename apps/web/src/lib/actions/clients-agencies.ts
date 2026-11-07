"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasCrmCapability } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { getCrmContext } from "@/lib/crm/context";
import { friendlyCrmError } from "@/lib/crm/errors";
import { createOrganisationWithContacts } from "@/lib/crm/clients-agencies/write";
import { cleanText, LEAD_SOURCES, normaliseCountry, normaliseWebsite, ORGANISATION_ROLES } from "@/lib/crm/clients-agencies/normalise";
import type { ActionState } from "./companies";

/**
 * Clients & Agencies server actions. Thin wrappers over the crm_* functions of migration 20261219000100: the database decides who may
 * edit an organisation, assign an account owner or hand a follow-up to someone, so a forged request gets the same refusal. The only
 * check made here first is the assign_owner capability (read from the caller's own grants), so an unauthorised assignment is refused
 * without a database call; the function checks it again.
 */

const uuid = z.string().uuid();
const fail = (message: string): ActionState => ({ error: friendlyCrmError(message) });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input.";
const refresh = () => revalidatePath("/sales", "layout");
const text = (max = 500) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
const optionalUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());
const rolesFrom = (fd: FormData) => fd.getAll("roles").map(String);
const leadSource = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(LEAD_SOURCES).optional());

async function mayAssign(companyId: string): Promise<boolean> {
  const ctx = await getCrmContext();
  return !!ctx && !ctx.loadFailed && hasCrmCapability(ctx.grants, companyId, "assign_owner");
}

const createSchema = z.object({
  companyId: uuid, name: z.string().trim().min(1, "Enter the name").max(200), country: text(80), website: text(300), place: text(200), note: text(2000),
  leadSource, exhibition: text(200), ownerId: optionalUuid,
  contactName: text(200), contactRole: text(200), contactEmail: text(200), contactPhone: text(80),
});

/** Create an account: only the name is required; roles, country, website, notes, lead source, exhibition, owner and a first contact are optional. */
export async function createAccount(_prev: ActionState & { id?: string }, formData: FormData): Promise<ActionState & { id?: string }> {
  const p = createSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  if (d.ownerId && !(await mayAssign(d.companyId))) return { error: "Only a founder, or someone they delegated, can assign an account owner." };
  const supabase = await createClient();
  const r = await createOrganisationWithContacts(supabase, {
    name: d.name, roles: rolesFrom(formData).filter((x): x is (typeof ORGANISATION_ROLES)[number] => (ORGANISATION_ROLES as readonly string[]).includes(x)),
    country_code: d.country, website: d.website, place: d.place, note: d.note, companyId: d.companyId, lead_source: d.leadSource, exhibition: d.exhibition, ownerId: d.ownerId,
    contacts: d.contactName ? [{ name: d.contactName, role_title: d.contactRole, email: d.contactEmail, phone: d.contactPhone }] : [],
  });
  if (!r.ok) return { error: r.error };
  refresh();
  return { error: null, id: r.id };
}

const profileSchema = z.object({
  orgId: uuid, companyId: uuid, name: z.string().trim().min(1, "Enter the name").max(200), country: text(80), website: text(300), place: text(200), note: text(2000),
  leadSource, exhibition: text(200),
});

/** Save the profile: the shared record (name, roles, country, website, place, relationship notes) and this company's lead source and exhibition. Blank clears a field. */
export async function saveAccountProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = profileSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  let country: string | null = null;
  if (cleanText(d.country)) {
    country = normaliseCountry(d.country);
    if (!country) return { error: "That country is not recognised. Use its name or two-letter code." };
  }
  const roles = rolesFrom(formData);
  if (roles.some((r) => !(ORGANISATION_ROLES as readonly string[]).includes(r))) return { error: "One of the roles is not allowed." };
  const supabase = await createClient();
  const org = await supabase.rpc("crm_update_organisation", {
    p_org: d.orgId, p_patch: { name: d.name, roles, country_code: country, website: normaliseWebsite(d.website).website, place: cleanText(d.place), note: cleanText(d.note) },
  });
  if (org.error) return fail(org.error.message);
  const profile = await supabase.rpc("crm_save_account_profile", { p_org: d.orgId, p_company: d.companyId, p_patch: { lead_source: d.leadSource ?? null, exhibition: cleanText(d.exhibition) } });
  if (profile.error) {
    refresh();
    return { error: `The organisation details were saved, but this company's lead source could not be: ${friendlyCrmError(profile.error.message)}` };
  }
  refresh();
  return { error: null };
}

const ownerSchema = z.object({ orgId: uuid, companyId: uuid, ownerId: optionalUuid });

/** Assign, reassign or clear (no person chosen = Unassigned) the ACCOUNT owner for the selected company. Does not touch any follow-up or inquiry owner. */
export async function assignAccountOwner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = ownerSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Choose the account owner, or Unassigned." };
  if (!(await mayAssign(p.data.companyId))) return { error: "Only a founder, or someone they delegated, can assign or reassign owners." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_assign_account_owner", { p_org: p.data.orgId, p_company: p.data.companyId, p_new_owner: p.data.ownerId ?? null });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}

const reassignSchema = z.object({ followUpId: uuid, assigneeId: uuid });

/** Hand an open follow-up to another person. Changes only the follow-up: never the account owner or the inquiry owner. */
export async function reassignFollowUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = reassignSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Choose who the follow-up is for." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_reassign_follow_up", { p_follow_up_id: p.data.followUpId, p_new_assignee: p.data.assigneeId });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}
