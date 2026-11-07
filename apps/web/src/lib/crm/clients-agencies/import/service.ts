import { createHash } from "node:crypto";
import { hasCrmCapability, type CrmGrant } from "@enginious-hr/domain";
import type { createClient } from "@/lib/supabase/server";
import type { DirectoryRow } from "../directory";
import type { StaffPerson } from "../staff";
import { applyPlan, type ApplyResult } from "./apply";
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

export interface ImportRequest { companyId: string; fileName: string; bytes: Uint8Array; mode: "preview" | "confirm" }

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
  | { ok: false; status: 400 | 401 | 403 | 503; error: string }
  | { ok: true; mode: "preview"; fileHash: string; summary: ImportPlan["summary"]; groups: PreviewGroups; totals: Record<keyof PreviewGroups, number>;
      duplicates: { row: number; name: string }[]; unnamedRows: number[]; rowErrors: ParsedFile["rowErrors"]; ignoredColumns: string[]; truncated: boolean }
  | { ok: true; mode: "confirm"; fileHash: string; result: ApplyResult; summary: ImportPlan["summary"]; review: PreviewGroups; totals: Record<keyof PreviewGroups, number>; truncated: boolean };

const ROLE_WORDS = { agency: "Agency", direct: "Direct client", client: "End client", technology: "Technology company" } as const;

function describe(o: OrgPlan): PlanItem {
  const adds: string[] = [];
  if (o.kind === "new") {
    adds.push("New organisation");
    if (o.incoming.country_code) adds.push("country");
    if (o.incoming.website) adds.push("website");
    if (o.incoming.lead_source) adds.push("lead source");
    if (o.assignOwnerName) adds.push(`owner ${o.assignOwnerName}`);
  } else {
    const filled = [...Object.keys(o.orgPatch).map((k) => ({ country_code: "country", roles: "type", website: "website", note: "notes" })[k as "note"] ?? k), ...Object.keys(o.profilePatch).map((k) => (k === "lead_source" ? "lead source" : "exhibition"))];
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

// One import at a time per person, company and file: a double-click (or a second tab) waits, then re-reads the database and finds nothing left to do.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks.set(key, run);
  try { return await run; } finally { if (locks.get(key) === run) locks.delete(key); }
}

/** Preview never writes. Confirm re-reads the file and the database at that moment, plans again and applies only the safe actions. */
export async function runImport(deps: ImportDeps, req: ImportRequest, userKey = "anonymous"): Promise<ImportResponse> {
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

  const plan = async () => {
    const [directory, staff] = await Promise.all([deps.loadDirectory(req.companyId), deps.loadStaff()]);
    return { directory, plan: buildPlan(parsed.file, { directory, staff, companyId: req.companyId, canAssign }) };
  };

  try {
    if (req.mode === "preview") {
      const { plan: p } = await plan();
      const g = group(p);
      return {
        ok: true, mode: "preview", fileHash, summary: p.summary, groups: g.groups, totals: g.totals, truncated: g.truncated,
        duplicates: parsed.file.duplicateRows.slice(0, 200), unnamedRows: parsed.file.unnamedRows.slice(0, 200), rowErrors: parsed.file.rowErrors.slice(0, 200), ignoredColumns: parsed.file.ignoredColumns,
      };
    }
    return await withLock(`${userKey}:${req.companyId}:${fileHash}`, async () => {
      const { directory, plan: p } = await plan();
      const result = await applyPlan(deps.db, p, req.companyId, directory);
      const g = group(p);
      return { ok: true as const, mode: "confirm" as const, fileHash, result, summary: p.summary, review: g.groups, totals: g.totals, truncated: g.truncated };
    });
  } catch (e) {
    console.error("[clients-agencies] import failed", e);
    return { ok: false, status: 503, error: req.mode === "preview" ? "Could not load the existing accounts to compare with. Nothing was changed; try again." : "Could not complete the import. Check the accounts list, then run the preview again." };
  }
}
