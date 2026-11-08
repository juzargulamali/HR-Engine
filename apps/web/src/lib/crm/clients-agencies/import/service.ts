import { createHash } from "node:crypto";
import { hasCrmCapability, type CrmGrant } from "@enginious-hr/domain";
import type { createClient } from "@/lib/supabase/server";
import type { DirectoryRow } from "../directory";
import type { StaffPerson } from "../staff";
import { applyPlan, batchKeyFor, fingerprintPlan, type ApplyResult, type Fingerprints } from "./apply";
import { parseRows, type ParsedFile } from "./parse";
import { buildPlan, type ImportPlan, type OrgPlan } from "./plan";
import { readImportSheet } from "./xlsx";

type Db = Pick<Awaited<ReturnType<typeof createClient>>, "rpc">;

/** What the import needs from its surroundings, so the whole flow runs the same in the route and in tests. */
export interface ImportDeps {
  db: Db;
  /** null = signed out. */
  ctx: { grants: readonly CrmGrant[]; companies: readonly { id: string }[]; loadFailed?: boolean } | null;
  loadDirectory(companyId: string): Promise<DirectoryRow[]>;
  loadStaff(): Promise<StaffPerson[]>;
}

/** `fingerprints` is what the preview returned; the confirm hands it back so the database can tell whether anything changed since. */
export interface ImportRequest { companyId: string; fileName: string; bytes: Uint8Array; mode: "preview" | "confirm"; fingerprints?: Fingerprints }

export const PREVIEW_STALE_MESSAGE = "This preview is out of date: someone changed these organisations after you ran it. Nothing was imported. Run a fresh preview and check it before confirming.";

const MAX_LISTED = 150;
export interface PreviewGroups {
  new: PlanItem[];
  fill: PlanItem[];
  noChange: PlanItem[];
  conflicts: PlanItem[];
  ambiguous: PlanItem[];
  review: PlanItem[];
}
export interface PlanItem {
  name: string;
  rows: number[];
  types: string[];
  /** What confirm would fill or add, in words. */
  adds: string[];
  conflicts: OrgPlan["conflicts"];
  flags: string[];
  candidates: string[];
  match: string | null;
}

export type ImportResponse =
  | { ok: false; status: 400 | 401 | 403 | 409 | 503; error: string; code?: "preview_stale" }
  | { ok: true; mode: "preview"; fileHash: string; fingerprints: Fingerprints; summary: ImportPlan["summary"]; groups: PreviewGroups; totals: Record<keyof PreviewGroups, number>;
      duplicates: { row: number; name: string }[]; unnamedRows: number[]; rowErrors: ParsedFile["rowErrors"]; ignoredColumns: string[]; truncated: boolean }
  | { ok: true; mode: "confirm"; fileHash: string; repeated: boolean; result: ApplyResult; summary: ImportPlan["summary"]; review: PreviewGroups; totals: Record<keyof PreviewGroups, number>; truncated: boolean };

const ROLE_WORDS = { agency: "Agency", direct: "Direct client", client: "End client", technology: "Technology company" } as const;

function describe(o: OrgPlan): PlanItem {
  const adds: string[] = [];
  if (o.kind === "new") {
    adds.push("New organisation");
    if (o.incoming.country_code) adds.push("country");
    if (o.incoming.website) adds.push("website");
    if (o.incoming.vat_trn) adds.push("VAT / TRN");
    if (o.incoming.trade_licence_no) adds.push("trade licence");
    if (o.incoming.lead_source) adds.push("lead source");
    if (o.assignOwnerName) adds.push(`owner ${o.assignOwnerName}`);
  } else {
    const filled = [...Object.keys(o.orgPatch).map((k) => ({ country_code: "country", roles: "type", website: "website", note: "notes", vat_trn: "VAT / TRN", trade_licence_no: "trade licence" })[k as "note"] ?? k), ...Object.keys(o.profilePatch).map((k) => (k === "lead_source" ? "lead source" : "exhibition"))];
    if (filled.length) adds.push(`fill empty: ${filled.join(", ")}`);
    if (o.assignOwnerName) adds.push(`assign owner ${o.assignOwnerName}`);
  }
  if (o.contactsToAdd.length) adds.push(`${o.contactsToAdd.length} new contact${o.contactsToAdd.length === 1 ? "" : "s"}`);
  return {
    name: o.name, rows: o.rows.slice(0, 20), types: o.roles.map((r) => ROLE_WORDS[r]), adds, conflicts: o.conflicts, flags: o.flags.map((f) => `Row ${f.row}: ${f.message}`),
    candidates: o.candidates.map((c) => c.name), match: o.match?.name ?? null,
  };
}

function group(plan: ImportPlan): { groups: PreviewGroups; totals: Record<keyof PreviewGroups, number>; truncated: boolean } {
  const all: Record<keyof PreviewGroups, OrgPlan[]> = {
    new: plan.orgs.filter((o) => o.kind === "new"),
    fill: plan.orgs.filter((o) => o.kind === "existing" && o.hasChanges),
    noChange: plan.orgs.filter((o) => o.kind === "existing" && !o.hasChanges),
    conflicts: plan.orgs.filter((o) => o.conflicts.length > 0),
    ambiguous: plan.orgs.filter((o) => o.kind === "ambiguous"),
    review: plan.orgs.filter((o) => o.flags.length > 0 && o.kind !== "ambiguous"),
  };
  const keys = Object.keys(all) as (keyof PreviewGroups)[];
  const totals = Object.fromEntries(keys.map((k) => [k, all[k].length])) as Record<keyof PreviewGroups, number>;
  const groups = Object.fromEntries(keys.map((k) => [k, all[k].slice(0, MAX_LISTED).map(describe)])) as unknown as PreviewGroups;
  return { groups, totals, truncated: keys.some((k) => all[k].length > MAX_LISTED) };
}

/**
 * Preview never writes: it classifies the file against what is recorded and notes, per organisation, the state it planned against.
 * Confirm re-reads the file and the records, plans again for the result screen and hands the batch to the database function, which
 * does the locking, the fill-only writes and the "is it still what you previewed" check (see crm_import_apply).
 */
export async function runImport(deps: ImportDeps, req: ImportRequest): Promise<ImportResponse> {
  const { ctx } = deps;
  if (!ctx) return { ok: false, status: 401, error: "Sign in to import." };
  if (ctx.loadFailed) return { ok: false, status: 503, error: "Could not load your Sales access. Nothing was imported." };
  // The company boundary: rows only ever land in a company the signed-in person holds a Sales grant for. The database re-checks every write.
  if (!ctx.companies.some((c) => c.id === req.companyId) || !ctx.grants.some((g) => g.companyId === req.companyId)) {
    return { ok: false, status: 403, error: "You do not have Sales access for that company." };
  }
  const read = await readImportSheet(req.bytes, req.fileName);
  if (!read.ok) return { ok: false, status: 400, error: read.error };
  const parsed = parseRows(read.rows);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const fileHash = createHash("sha256").update(req.bytes).digest("hex");
  const canAssign = hasCrmCapability([...ctx.grants], req.companyId, "assign_owner");
  if (req.mode === "confirm" && (!req.fingerprints || Object.keys(req.fingerprints).length === 0)) {
    return { ok: false, status: 400, error: "Run the preview first, then confirm what it shows." };
  }

  const plan = async () => {
    const [directory, staff] = await Promise.all([deps.loadDirectory(req.companyId), deps.loadStaff()]);
    return { plan: buildPlan(parsed.file, { directory, staff, companyId: req.companyId, canAssign }) };
  };

  try {
    const { plan: p } = await plan();
    const g = group(p);
    if (req.mode === "preview") {
      const fingerprints = await fingerprintPlan(deps.db, p, req.companyId);
      return {
        ok: true, mode: "preview", fileHash, fingerprints, summary: p.summary, groups: g.groups, totals: g.totals, truncated: g.truncated,
        duplicates: parsed.file.duplicateRows.slice(0, 200), unnamedRows: parsed.file.unnamedRows.slice(0, 200), rowErrors: parsed.file.rowErrors.slice(0, 200), ignoredColumns: parsed.file.ignoredColumns,
      };
    }
    const out = await applyPlan(deps.db, p, req.companyId, req.fingerprints!, batchKeyFor(req.companyId, fileHash, req.fingerprints!));
    if (out.status === "preview_stale") return { ok: false, status: 409, code: "preview_stale", error: PREVIEW_STALE_MESSAGE };
    if (out.status === "error") return { ok: false, status: 503, error: out.error };
    return { ok: true, mode: "confirm", fileHash, repeated: out.repeated, result: out.result, summary: p.summary, review: g.groups, totals: g.totals, truncated: g.truncated };
  } catch (e) {
    console.error("[clients-agencies] import failed", e);
    return { ok: false, status: 503, error: req.mode === "preview" ? "Could not load the existing accounts to compare with. Nothing was changed; try again." : "Could not complete the import. Check the accounts list, then run the preview again." };
  }
}
