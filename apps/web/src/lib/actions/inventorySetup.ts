"use server";

import { z } from "zod";
import { INV_CAPABILITIES } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type { InvJson } from "@/types/inventory";
import {
  fail, firstIssue, movementKey, ok, optionalText, optionalUuid, refreshInventory, uuid, type InvActionState,
} from "@/lib/inventory/action-utils";
import { resolveScan, type ScanResolution } from "@/lib/inventory/scan-lookup";
import { CUSTODY_WORDS, LIFECYCLE_WORDS } from "@/lib/inventory/words";
import { COMPANY_CODE_RE, LOCATION_CODE_RE, isValidTimezone } from "@/lib/inventory/setup";

/**
 * Inventory setup server actions: company settings, locations, bins, categories, counts, opening custody, technology templates, the
 * earlier HR asset register import, access, cross-company sharing and label-print records. Each is a thin wrapper over an inv_*
 * database function. The function (not this file) decides who may do what, so a forged request is refused the same way a normal one is;
 * this layer parses the form and turns database errors into plain sentences. Nothing here writes a table directly.
 */
type S = InvActionState;

const STALE = "This was changed by someone else. Reload the page and try again.";

// ---------------------------------------------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------------------------------------------
export async function setInventoryCompanyCode(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ companyId: uuid, code: z.string().trim().toUpperCase().regex(COMPANY_CODE_RE, "The reference code is 2 to 5 capital letters.") }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("inv_set_company_code", { p_company_id: p.data.companyId, p_reference_code: p.data.code });
  if (error) return fail(error.message);
  refreshInventory();
  return ok();
}

export async function setInventoryEnabled(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ companyId: uuid, enabled: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("inv_set_enabled", { p_company_id: p.data.companyId, p_enabled: p.data.enabled === "true" });
  if (error) return fail(error.message);
  refreshInventory();
  return ok();
}

// ---------------------------------------------------------------------------------------------------------------
// Locations, bins, categories
// ---------------------------------------------------------------------------------------------------------------
export async function saveInventoryLocation(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    companyId: uuid, locationId: optionalUuid,
    code: z.string().trim().toUpperCase().regex(LOCATION_CODE_RE, "The short code is 2 to 8 capital letters or digits."),
    name: z.string().trim().min(1, "Give the location a name.").max(80, "The name can be up to 80 characters."),
    timezone: z.string().trim().refine(isValidTimezone, "Choose a time zone from the list, or type a valid name such as Asia/Dubai."),
    kind: z.enum(["warehouse", "office", "other"]),
    address: optionalText, isActive: z.enum(["true", "false"]).default("true"),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_save_location", {
    p_company_id: d.companyId, p_location_id: d.locationId ?? null, p_code: d.code, p_name: d.name, p_timezone: d.timezone, p_kind: d.kind,
    p_address: d.address ?? null, p_is_active: d.isActive === "true",
  });
  if (error) return fail(error.message);
  refreshInventory();
  return ok({ id: data ?? undefined });
}

export async function saveInventoryBin(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    locationId: uuid, binId: optionalUuid, code: z.string().trim().min(1, "Give the bin a code.").max(30, "The bin code can be up to 30 characters."),
    label: optionalText, isActive: z.enum(["true", "false"]).default("true"),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_save_bin", {
    p_location_id: p.data.locationId, p_bin_id: p.data.binId ?? null, p_code: p.data.code, p_label: p.data.label ?? null, p_is_active: p.data.isActive === "true",
  });
  if (error) return fail(error.message);
  refreshInventory();
  return ok({ id: data ?? undefined });
}

export async function saveInventoryCategory(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    companyId: uuid, categoryId: optionalUuid, parentId: optionalUuid,
    name: z.string().trim().min(1, "Give the category a name.").max(80, "The name can be up to 80 characters."),
    sortOrder: z.preprocess((v) => (v === "" || v == null ? 0 : v), z.coerce.number().int("Use a whole number for the order.").min(-100000).max(100000)),
    isActive: z.enum(["true", "false"]).default("true"),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_save_category", {
    p_company_id: d.companyId, p_category_id: d.categoryId ?? null, p_name: d.name, p_parent_id: d.parentId ?? null, p_sort_order: d.sortOrder, p_is_active: d.isActive === "true",
  });
  if (error) return fail(error.message);
  refreshInventory();
  return ok({ id: data ?? undefined });
}

// ---------------------------------------------------------------------------------------------------------------
// Counts (opening stock and cycle counts)
// ---------------------------------------------------------------------------------------------------------------
export async function startInventoryCount(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ companyId: uuid, locationId: uuid, kind: z.enum(["opening", "cycle"]), note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_start_count", { p_company_id: p.data.companyId, p_location_id: p.data.locationId, p_kind: p.data.kind, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  const r = (data ?? {}) as { count_id?: string; code?: string };
  refreshInventory();
  return ok({ id: r.count_id, code: r.code });
}

const qtyText = z.string().trim().min(1, "Type the quantity you counted.").refine((v) => Number.isFinite(Number(v.replace(",", "."))) && Number(v.replace(",", ".")) >= 0, "The quantity must be a number, zero or more.");

export async function saveInventoryCountLine(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    countId: uuid, unitId: optionalUuid, itemId: optionalUuid, binId: optionalUuid, balanceId: optionalUuid,
    condition: optionalText, qty: qtyText, reason: optionalText, note: optionalText,
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  if (!d.unitId && !d.itemId) return { error: "Choose what was counted: a unit or an item." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_save_count_line", {
    p_count_id: d.countId, p_counted_qty: Number(d.qty.replace(",", ".")), p_unit_id: d.unitId ?? null, p_item_id: d.itemId ?? null, p_bin_id: d.binId ?? null,
    p_condition: d.condition ?? null, p_reason: d.reason ?? null, p_note: d.note ?? null, p_balance_id: d.balanceId ?? null,
  });
  if (error) return fail(error.message);
  refreshInventory();
  return ok({ id: data ?? undefined });
}

export async function confirmInventoryCount(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ companyId: uuid, countId: uuid, key: movementKey, note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_confirm_count", { p_company_id: p.data.companyId, p_count_id: p.data.countId, p_key: p.data.key, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshInventory();
  const detail = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  return ok({ replayed: detail.replayed === true, detail });
}

export async function cancelInventoryCount(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ companyId: uuid, countId: uuid, reason: z.string().trim().min(1, "Say why the count is cancelled.") }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("inv_cancel_count", { p_company_id: p.data.companyId, p_count_id: p.data.countId, p_reason: p.data.reason });
  if (error) return fail(error.message);
  refreshInventory();
  return ok();
}

export interface CountUnitInfo {
  id: string; code: string; itemId: string; itemName: string; lifecycle: string; lifecycleWords: string; custodyWords: string; condition: string;
  binId: string | null; locationId: string | null;
  /** What the system expects on the shelf for this unit: 1 when it is active and on a shelf, otherwise 0. */
  expected: 0 | 1;
}

/** Finds a unit by its code for a count sheet (reads only; the row-level policy decides what the person may see). */
export async function lookupCountUnit(countId: string, rawCode: string): Promise<{ unit: CountUnitInfo | null; error: string | null }> {
  if (!uuid.safeParse(countId).success) return { unit: null, error: "Reload the page and try again." };
  const resolved = await resolveScan(await createClient(), rawCode);
  if (resolved.status === "not_inventory") return { unit: null, error: "That is not an equipment code. Codes look like UAE-E-00042." };
  if (resolved.status === "error") return { unit: null, error: "The code could not be looked up. Try again." };
  if (resolved.status === "unavailable" || resolved.kind !== "unit") return { unit: null, error: "No unit with that code is available to you." };
  const supabase = await createClient();
  const { data } = await supabase.from("inv_units").select("id, code, item_id, lifecycle, condition, custody_kind, bin_id, location_id").eq("id", resolved.id).maybeSingle();
  if (!data) return { unit: null, error: "No unit with that code is available to you." };
  return {
    error: null,
    unit: {
      id: data.id, code: data.code, itemId: data.item_id, itemName: resolved.itemName, lifecycle: data.lifecycle, lifecycleWords: LIFECYCLE_WORDS[data.lifecycle] ?? data.lifecycle,
      custodyWords: CUSTODY_WORDS[data.custody_kind] ?? data.custody_kind, condition: data.condition, binId: data.bin_id, locationId: data.location_id,
      expected: data.lifecycle === "active" && data.custody_kind === "warehouse" ? 1 : 0,
    },
  };
}

/** "Check whether it went through": the answer for an idempotency key after an uncertain failure. */
export async function checkInventoryTransaction(companyId: string, key: string): Promise<{ status: "recorded" | "in_progress" | "not_recorded" | "unknown"; code?: string; error?: string }> {
  if (!uuid.safeParse(companyId).success || !movementKey.safeParse(key).success) return { status: "unknown", error: "Reload the page and try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_transaction_status", { p_company_id: companyId, p_key: key });
  if (error) return { status: "unknown", error: fail(error.message).error ?? undefined };
  const r = (data ?? {}) as { status?: string; movement_code?: string };
  const status = r.status === "recorded" || r.status === "in_progress" || r.status === "not_recorded" ? r.status : "unknown";
  return { status, code: r.movement_code };
}

// ---------------------------------------------------------------------------------------------------------------
// Opening custody: equipment and quantities already with employees or on projects
// ---------------------------------------------------------------------------------------------------------------
const custodyLines = z.array(z.object({
  unit_id: uuid.optional(),
  item_id: uuid.optional(),
  qty: z.number().positive().optional(),
  employee_id: uuid.optional(),
  project_id: uuid.optional(),
  condition: z.enum(["good", "needs_inspection", "damaged"]).optional(),
}).strict()).min(1, "Choose at least one unit or quantity to confirm.").max(200, "Confirm at most 200 lines at a time.");

export async function confirmInventoryOpeningCustody(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ companyId: uuid, key: movementKey, note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  let raw: unknown;
  try { raw = JSON.parse(String(fd.get("lines") ?? "[]")); } catch { return { error: "The list could not be read. Reload the page and try again." }; }
  const lines = custodyLines.safeParse(raw);
  if (!lines.success) return { error: firstIssue(lines.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_confirm_opening_custody", { p_company_id: p.data.companyId, p_key: p.data.key, p_lines: lines.data as unknown as InvJson, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshInventory();
  const detail = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  return ok({ replayed: detail.replayed === true, detail });
}

export async function lookupInventoryEmployees(companyId: string, query: string): Promise<{ people: { id: string; name: string; number: string; department: string | null }[]; error: string | null }> {
  if (!uuid.safeParse(companyId).success) return { people: [], error: "Reload the page and try again." };
  if (query.trim().length < 2) return { people: [], error: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_employee_lookup", { p_company_id: companyId, p_query: query.trim().slice(0, 60) });
  if (error) return { people: [], error: fail(error.message).error };
  return { people: (data ?? []).map((e) => ({ id: e.employee_id, name: e.display_name, number: e.employee_number, department: e.department_name })), error: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Technology templates
// ---------------------------------------------------------------------------------------------------------------
const componentsSchema = z.array(z.object({
  item_id: uuid,
  qty: z.number({ message: "Every component needs a quantity." }).positive("Every component needs a quantity above zero."),
  alt_group: z.string().trim().max(60, "An alternative group name is at most 60 characters.").optional(),
  is_optional: z.boolean().optional(),
  note: z.string().trim().max(300, "A note is at most 300 characters.").optional(),
}).strict()).max(200, "A template can have at most 200 components.");

const expectedVersion = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional());

export async function saveInventoryTechnology(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    companyId: uuid, technologyId: optionalUuid, name: z.string().trim().min(1, "Give the technology a name.").max(160, "The name can be up to 160 characters."),
    description: optionalText, expectedVersion,
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  let raw: unknown;
  try { raw = JSON.parse(String(fd.get("components") ?? "[]")); } catch { return { error: "The components could not be read. Reload the page and try again." }; }
  const comps = componentsSchema.safeParse(raw);
  if (!comps.success) return { error: firstIssue(comps.error) };
  // The same item twice is refused by the database; say it before sending.
  const ids = comps.data.map((c) => c.item_id);
  if (new Set(ids).size !== ids.length) return { error: "An item appears twice. List an item once, and use an alternative group for look-alikes." };
  const supabase = await createClient();
  const d = p.data;

  // The database refuses an out-of-date save with SQLSTATE 40001, which PostgREST can retry for a long time. Check the version first so a
  // stale save is answered at once; the version is still sent, so the database stays the last word if two saves really race.
  if (d.technologyId && d.expectedVersion !== undefined) {
    const { data: current } = await supabase.from("inv_technologies").select("version").eq("id", d.technologyId).maybeSingle();
    if (current && current.version !== d.expectedVersion) return { error: STALE };
  }
  const { data: id, error } = await supabase.rpc("inv_save_technology", {
    p_company_id: d.companyId, p_technology_id: d.technologyId ?? null, p_name: d.name, p_description: d.description ?? null, p_expected_version: d.expectedVersion ?? null,
  });
  if (error) return fail(error.message);
  const { error: compError } = await supabase.rpc("inv_save_technology_components", {
    p_technology_id: id,
    p_components: comps.data.map((c, i) => ({ ...c, sort_order: (i + 1) * 10 })) as unknown as InvJson,
  });
  refreshInventory();
  if (compError) return { error: `The name and description were saved, but the components were not: ${fail(compError.message).error}`, id };
  return ok({ id });
}

export async function setInventoryTechnologyStatus(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ technologyId: uuid, status: z.enum(["draft", "complete", "retired"]), expectedVersion }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  if (p.data.expectedVersion !== undefined) {
    const { data: current } = await supabase.from("inv_technologies").select("version").eq("id", p.data.technologyId).maybeSingle();
    if (current && current.version !== p.data.expectedVersion) return { error: STALE };
  }
  const { error } = await supabase.rpc("inv_set_technology_status", { p_technology_id: p.data.technologyId, p_status: p.data.status, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refreshInventory();
  return ok();
}

// ---------------------------------------------------------------------------------------------------------------
// The earlier HR asset register (founders only)
// ---------------------------------------------------------------------------------------------------------------
const legacyRows = z.array(z.object({ asset_id: uuid, item_id: uuid, location_id: uuid }).strict()).min(1, "Tick at least one asset and choose its item and location.").max(500, "Import at most 500 assets at a time.");

export async function importInventoryLegacyAssets(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ companyId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  let raw: unknown;
  try { raw = JSON.parse(String(fd.get("rows") ?? "[]")); } catch { return { error: "The list could not be read. Reload the page and try again." }; }
  const rows = legacyRows.safeParse(raw);
  if (!rows.success) return { error: firstIssue(rows.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inv_import_legacy_assets", { p_company_id: p.data.companyId, p_rows: rows.data as unknown as InvJson });
  if (error) return fail(error.message);
  refreshInventory(["/assets"]);
  const detail = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  return ok({ detail });
}

// ---------------------------------------------------------------------------------------------------------------
// Sharing between companies
// ---------------------------------------------------------------------------------------------------------------
export async function setInventoryCompanySharing(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ ownerCompanyId: uuid, useCompanyId: uuid, enabled: z.enum(["true", "false"]), note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("inv_set_company_sharing", { p_owner_company_id: p.data.ownerCompanyId, p_use_company_id: p.data.useCompanyId, p_enabled: p.data.enabled === "true", p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshInventory();
  return ok();
}

// ---------------------------------------------------------------------------------------------------------------
// Scanning and labels
// ---------------------------------------------------------------------------------------------------------------
/** Resolves one code for the scan page. Reads only: it calls no stock function, and an unknown code and a forbidden one read the same. */
export async function resolveInventoryCode(raw: string): Promise<ScanResolution> {
  if (typeof raw !== "string") return { status: "not_inventory", problem: "empty" };
  return resolveScan(await createClient(), raw);
}

const printTargets = z.array(z.object({ companyId: uuid, unitId: uuid.optional(), balanceId: uuid.optional() }).refine((t) => (t.unitId === undefined) !== (t.balanceId === undefined))).min(1).max(300);

/** Writes the print history for a sheet of labels. A reprint is the same code again; it never creates equipment. */
export async function recordInventoryLabelPrints(targets: { companyId: string; unitId?: string; balanceId?: string }[]): Promise<{ recorded: number; failed: number; error: string | null }> {
  const parsed = printTargets.safeParse(targets);
  if (!parsed.success) return { recorded: 0, failed: targets.length, error: "The print could not be recorded. Reload the page and try again." };
  const supabase = await createClient();
  let recorded = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const t of parsed.data) {
    const { error } = await supabase.rpc("inv_record_label_print", { p_company_id: t.companyId, p_unit_id: t.unitId ?? null, p_balance_id: t.balanceId ?? null });
    if (error) { failed += 1; firstError ??= fail(error.message).error; } else recorded += 1;
  }
  return { recorded, failed, error: firstError };
}
