import { createHash } from "node:crypto";
import type { createClient } from "@/lib/supabase/server";
import { friendlyCrmError } from "../../errors";
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

/** One organisation as the database function receives it. The database decides what is safe: it never trusts a plan's action. */
interface ImportItem {
  key: string; name: string; website: string | null; roles: string[]; country_code: string | null; note: string | null;
  lead_source: string | null; exhibition: string | null; owner_id: string | null; contacts: object[]; fingerprint?: string;
}

export type Fingerprints = Record<string, string>;
export type ConfirmOutcome =
  | { status: "applied"; result: ApplyResult; repeated: boolean }
  | { status: "preview_stale"; staleCount: number }
  | { status: "error"; error: string };

const toItem = (o: OrgPlan): ImportItem => ({
  key: o.key, name: o.name, website: o.incoming.website, roles: o.roles, country_code: o.incoming.country_code, note: o.incoming.note,
  lead_source: o.incoming.lead_source, exhibition: o.incoming.exhibition, owner_id: o.incomingOwnerId, contacts: o.fileContacts,
});

/** What each row was planned against, as the database reads it right now. Recorded by the preview and compared by the confirm. */
export async function fingerprintPlan(db: Db, plan: ImportPlan, companyId: string): Promise<Fingerprints> {
  const items = plan.orgs.map((o) => ({ key: o.key, name: o.name, website: o.incoming.website }));
  const { data, error } = await db.rpc("crm_import_fingerprints", { p_company: companyId, p_items: items as never });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error(error?.message ?? "No fingerprints returned");
  return data as Fingerprints;
}

/** The same preview of the same file always has the same key, so a repeated confirm is recognised by the database and does nothing. */
export function batchKeyFor(companyId: string, fileHash: string, fingerprints: Fingerprints): string {
  const body = Object.keys(fingerprints).sort().map((k) => `${k}=${fingerprints[k]}`).join("\n");
  return createHash("sha256").update(`${companyId}\n${fileHash}\n${body}`).digest("hex");
}

/**
 * Hands the whole plan to the database in ONE call. The database function takes the locks, re-checks every match, applies only fill-only
 * writes, and refuses the whole batch ('preview_stale') if anything a row was planned against has changed since the preview. Nothing here
 * decides what is safe; a forged request gets the same answers.
 */
export async function applyPlan(db: Db, plan: ImportPlan, companyId: string, fingerprints: Fingerprints, batchKey: string): Promise<ConfirmOutcome> {
  const items = plan.orgs.map((o) => { const i = toItem(o); const f = fingerprints[o.key]; return f ? { ...i, fingerprint: f } : i; });
  const { data, error } = await db.rpc("crm_import_apply", { p_company: companyId, p_batch_key: batchKey, p_items: items as never });
  if (error) return { status: "error", error: friendlyCrmError(error.message) };
  const r = data as { status?: string; stale_count?: number; created?: number; updated?: number; contacts_added?: number; owners_assigned?: number; untouched?: number; failed?: { key: string; message: string }[]; repeated?: boolean } | null;
  if (r?.status === "preview_stale") return { status: "preview_stale", staleCount: r.stale_count ?? 0 };
  if (r?.status !== "applied") return { status: "error", error: "The import did not return a result. Check the accounts list, then run the preview again." };
  const byKey = new Map(plan.orgs.map((o) => [o.key, o]));
  return {
    status: "applied", repeated: r.repeated === true,
    result: {
      created: r.created ?? 0, updated: r.updated ?? 0, contactsAdded: r.contacts_added ?? 0, ownersAssigned: r.owners_assigned ?? 0, untouched: r.untouched ?? 0,
      failed: (r.failed ?? []).map((f) => ({ name: byKey.get(f.key)?.name ?? f.key, rows: byKey.get(f.key)?.rows ?? [], message: friendlyCrmError(f.message) })),
    },
  };
}
