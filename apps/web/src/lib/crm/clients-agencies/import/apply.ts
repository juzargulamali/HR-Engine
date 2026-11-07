import type { createClient } from "@/lib/supabase/server";
import { friendlyCrmError } from "../../errors";
import { createOrganisationWithContacts, updateOrganisationEmptyFields } from "../write";
import type { DirectoryRow } from "../directory";
import type { ImportPlan, OrgPlan } from "./plan";

type Db = Pick<Awaited<ReturnType<typeof createClient>>, "rpc">;

export interface ApplyResult {
  created: number;
  updated: number;
  contactsAdded: number;
  ownersAssigned: number;
  /** Organisations that were already complete or were left for a person (conflicts, ambiguous matches). Nothing was changed for them. */
  untouched: number;
  failed: { name: string; rows: number[]; message: string }[];
}

const CONCURRENCY = 4;

/**
 * Applies ONLY the safe actions of a plan: create what is new, fill what is empty, add contacts that do not exist, assign a verified
 * owner to an unassigned account. Conflicts and ambiguous matches are never touched. Every write goes through part 1's functions, so
 * the database decides who may do what; a refusal is reported against that organisation and the rest continue.
 */
export async function applyPlan(db: Db, plan: ImportPlan, companyId: string, directory: readonly DirectoryRow[]): Promise<ApplyResult> {
  const result: ApplyResult = { created: 0, updated: 0, contactsAdded: 0, ownersAssigned: 0, untouched: 0, failed: [] };
  const fail = (o: OrgPlan, message: string) => result.failed.push({ name: o.name, rows: o.rows, message });

  async function one(o: OrgPlan) {
    if (o.kind === "ambiguous" || !o.hasChanges) { result.untouched++; return; }
    try {
      if (o.kind === "new") {
        const r = await createOrganisationWithContacts(db, {
          name: o.name, roles: o.roles, country_code: o.incoming.country_code, website: o.incoming.website, note: o.incoming.note,
          companyId, lead_source: o.incoming.lead_source, exhibition: o.incoming.exhibition, ownerId: o.assignOwnerId, contacts: o.contactsToAdd,
        });
        if (!r.ok) return fail(o, r.error);
        result.created++;
        result.contactsAdded += o.contactsToAdd.length;
        if (o.assignOwnerId) result.ownersAssigned++;
        return;
      }
      const existing = directory.find((d) => d.org.id === o.match!.id)?.org;
      if (!existing) return fail(o, "The organisation is no longer available.");
      if (Object.keys(o.orgPatch).length > 0) {
        const u = await updateOrganisationEmptyFields(db, existing, o.orgPatch);
        if (!u.ok) return fail(o, u.error);
      }
      if (Object.keys(o.profilePatch).length > 0) {
        const { error } = await db.rpc("crm_save_account_profile", { p_org: existing.id, p_company: companyId, p_patch: o.profilePatch });
        if (error) return fail(o, friendlyCrmError(error.message));
      }
      if (o.assignOwnerId) {
        const { error } = await db.rpc("crm_assign_account_owner", { p_org: existing.id, p_company: companyId, p_new_owner: o.assignOwnerId });
        if (error) return fail(o, friendlyCrmError(error.message));
        result.ownersAssigned++;
      }
      for (const c of o.contactsToAdd) {
        const { error } = await db.rpc("crm_create_contact", { p_organisation_id: existing.id, p_name: c.name, p_role_title: c.role_title ?? null, p_email: c.email ?? null, p_phone: c.phone ?? null });
        if (error) return fail(o, `${friendlyCrmError(error.message)} (contact ${c.name})`);
        result.contactsAdded++;
      }
      result.updated++;
    } catch (e) {
      fail(o, friendlyCrmError(e instanceof Error ? e.message : "Could not save."));
    }
  }

  const queue = [...plan.orgs];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => { for (let o = queue.shift(); o; o = queue.shift()) await one(o); }));
  return result;
}
