"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getInventoryContext } from "@/lib/inventory/context";
import {
  checkbox, fail, firstIssue, friendlyInventoryError, movementKey, ok, optionalText, optionalUuid, refreshInventory, uuid, type InvActionState,
} from "@/lib/inventory/action-utils";
import { loadHeld, resolveCode, searchCandidates } from "@/lib/inventory/stock";
import type { Candidate, ScanResolution } from "@/lib/inventory/stock-candidates";
import {
  KIND_CONFIG, sanitizeLines, statusMessage, successMessage, toRpcCall, validateInput, type MovementInput, type MovementKind,
} from "@/lib/inventory/stock-movements";

/**
 * Inventory stock server actions. Every one is a thin wrapper over an inv_* database function: the function decides who may do what,
 * whether the stock is there, and whether the key was used before. This layer parses what the form sent, keeps only the fields the
 * functions read, bounds the call in time, and turns failures into plain sentences. It never claims success the database did not give.
 */

const RPC_BUDGET_MS = 25_000;

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => { abortSignal: (s: AbortSignal) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> } };

/** True when the failure leaves us not knowing whether the movement was recorded (a timeout or a lost connection). */
function uncertainText(message: string): boolean {
  return /TimeoutError|AbortError|aborted due to timeout|signal timed out|fetch failed|network|ECONNRESET|ETIMEDOUT|socket hang up|Failed to fetch/i.test(message);
}

export interface MovementOutcome {
  error: string | null;
  /** True when it is not known whether the movement was recorded: the form then offers "Check whether it went through". */
  uncertain?: boolean;
  /** One plain sentence about what was recorded. */
  message?: string;
  result?: unknown;
}

const kinds = Object.keys(KIND_CONFIG) as [MovementKind, ...MovementKind[]];
const movementSchema = z.object({
  kind: z.enum(kinds),
  companyId: uuid,
  locationId: z.string().uuid().nullable(),
  key: movementKey,
  lines: z.unknown(),
  note: z.string().max(2000).optional(),
  employeeId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  toProjectId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
  expectedReturnAt: z.string().datetime({ offset: true }).optional(),
  toLocationId: z.string().uuid().optional(),
  transferId: z.string().uuid().optional(),
  carrier: z.string().max(200).optional(),
  reference: z.string().max(200).optional(),
  expectedAt: z.string().datetime({ offset: true }).optional(),
  repairReference: z.string().max(200).optional(),
  reason: z.string().max(2000).optional(),
  adjustAction: z.enum(["missing", "found", "retire"]).optional(),
  kitUnitId: z.string().uuid().optional(),
  rentalId: z.string().uuid().optional(),
  returnFrom: z.enum(["employee", "project"]).optional(),
  rental: z.object({
    supplierName: z.string().max(200), externalReference: z.string().max(200), returnDeadline: z.string().datetime({ offset: true }),
    projectId: z.string().uuid().optional(), note: z.string().max(1000).optional(),
  }).optional(),
});

/**
 * Records ONE movement. The key made when the form opened is sent as p_key: the same key by the same person with the same content
 * returns the first result and changes nothing, so a double click, a retry or a repeat after a lost connection can never record twice.
 */
export async function recordMovement(raw: MovementInput): Promise<MovementOutcome> {
  const parsed = movementSchema.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const input = { ...parsed.data, lines: sanitizeLines(raw.lines) } as MovementInput;
  const problem = validateInput(input);
  if (problem) return { error: problem };
  const { fn, args } = toRpcCall(input);
  const db = (await createClient()) as unknown as Rpc;
  try {
    const { data, error } = await db.rpc(fn, args).abortSignal(AbortSignal.timeout(RPC_BUDGET_MS));
    if (error) {
      if (uncertainText(error.message)) return { error: friendlyInventoryError("TimeoutError"), uncertain: true };
      return { error: friendlyInventoryError(error.message) };
    }
    refreshInventory(["/projects", "/hr/assets"]);
    return { error: null, result: data, message: successMessage(input.kind, data) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return uncertainText(message) ? { error: friendlyInventoryError("TimeoutError"), uncertain: true } : { error: friendlyInventoryError(message) };
  }
}

export interface StatusOutcome {
  error: string | null;
  state?: "recorded" | "not_recorded" | "in_progress" | "unknown";
  text?: string;
  movementId?: string | null;
}

/** "Check whether it went through": asks the database what became of a key. Changes nothing. */
export async function checkTransaction(companyId: string, key: string): Promise<StatusOutcome> {
  if (!uuid.safeParse(companyId).success) return { error: "Choose the company" };
  if (!movementKey.safeParse(key).success) return { error: "That is not a valid transaction key. Keys are 8 to 120 letters, numbers and - _ . :" };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_transaction_status", { p_company_id: companyId, p_key: key });
  if (error) return { error: friendlyInventoryError(error.message) };
  const s = statusMessage(data);
  const id = data && typeof data === "object" && !Array.isArray(data) && typeof (data as Record<string, unknown>).movement_id === "string" ? ((data as Record<string, unknown>).movement_id as string) : null;
  return { error: null, state: s.state, text: s.text, movementId: id };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading for the forms (no changes)
// ---------------------------------------------------------------------------------------------------------------

export async function searchStock(p: { companyId: string; locationId: string | null; kind: MovementKind; q: string; rentalId?: string | null; adjustAction?: "missing" | "found" | "retire" }): Promise<{ error: string | null; candidates: Candidate[] }> {
  if (!uuid.safeParse(p.companyId).success || !(kinds as string[]).includes(p.kind)) return { error: "Choose where this happens first", candidates: [] };
  if (p.locationId && !uuid.safeParse(p.locationId).success) return { error: "Choose the location", candidates: [] };
  try {
    return { error: null, candidates: await searchCandidates({ ...p, q: p.q.slice(0, 80) }) };
  } catch (e) {
    console.error("[inventory] search failed", e);
    return { error: "The search could not be done. Try again.", candidates: [] };
  }
}

export async function loadHeldItems(p: { companyId: string; employeeId?: string | null; projectId?: string | null }): Promise<{ error: string | null; candidates: Candidate[] }> {
  const ctx = await getInventoryContext();
  if (!ctx) return { error: "Sign in again", candidates: [] };
  if (!uuid.safeParse(p.companyId).success || (p.employeeId && !uuid.safeParse(p.employeeId).success) || (p.projectId && !uuid.safeParse(p.projectId).success)) return { error: "Choose who is returning it", candidates: [] };
  try {
    return { error: null, candidates: await loadHeld(ctx, p) };
  } catch (e) {
    console.error("[inventory] held items failed", e);
    return { error: "What they hold could not be loaded. Try again.", candidates: [] };
  }
}

/** Reads a scanned or typed code. It only says what the code is; it never changes stock. */
export async function readCode(raw: string): Promise<ScanResolution> {
  const ctx = await getInventoryContext();
  if (!ctx) return { ok: false, message: "Sign in again." };
  try {
    return await resolveCode(ctx, String(raw ?? "").slice(0, 500));
  } catch (e) {
    console.error("[inventory] scan lookup failed", e);
    return { ok: false, message: "The code could not be looked up right now. Try again." };
  }
}

export interface EmployeeHit { employeeId: string; name: string; number: string; department: string | null }

export async function lookupEmployees(companyId: string, query: string): Promise<{ error: string | null; people: EmployeeHit[] }> {
  if (!uuid.safeParse(companyId).success) return { error: "Choose the location first", people: [] };
  if (query.trim().length < 2) return { error: null, people: [] };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_employee_lookup", { p_company_id: companyId, p_query: query.trim().slice(0, 80) });
  if (error) return { error: friendlyInventoryError(error.message), people: [] };
  return { error: null, people: (data ?? []).map((e) => ({ employeeId: e.employee_id, name: e.display_name, number: e.employee_number, department: e.department_name })) };
}

// ---------------------------------------------------------------------------------------------------------------
// Catalogue and units (forms that use the page's own save button)
// ---------------------------------------------------------------------------------------------------------------

const TRACKING = z.enum(["individual", "quantity", "kit", "consumable"]);
const scale = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(0).max(3).optional());

const itemSchema = z.object({
  companyId: uuid,
  itemId: optionalUuid,
  name: z.string().trim().min(1, "Give the item a name").max(160, "The name is too long (160 characters at most)"),
  categoryId: optionalUuid,
  tracking: TRACKING.optional(),
  unitOfMeasure: optionalText,
  quantityScale: scale,
  manufacturer: optionalText,
  model: optionalText,
  specification: optionalText,
  notes: optionalText,
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["draft", "active", "retired"]).optional()),
  expectedVersion: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().positive().optional()),
  after: optionalText,
});

/** Adds a catalogue item (Quick Add) or saves changes to one (the edit form, with its version so a stale edit is refused). */
export async function saveItem(_prev: InvActionState, formData: FormData): Promise<InvActionState> {
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  if (!d.itemId && !d.tracking) return { error: "Choose how this item is tracked" };
  const counted = d.tracking === "quantity" || d.tracking === "consumable";
  const fields: Record<string, unknown> = d.itemId
    ? {
        name: d.name, category_id: d.categoryId ?? "", manufacturer: d.manufacturer ?? "", model: d.model ?? "", specification: d.specification ?? "", notes: d.notes ?? "",
        ...(d.status ? { status: d.status } : {}), ...(d.expectedVersion ? { expected_version: d.expectedVersion } : {}),
      }
    : {
        name: d.name, tracking: d.tracking, status: d.status ?? "active",
        ...(d.categoryId ? { category_id: d.categoryId } : {}),
        ...(counted ? { unit_of_measure: d.unitOfMeasure ?? "each", quantity_scale: d.quantityScale ?? 0 } : {}),
        ...(d.manufacturer ? { manufacturer: d.manufacturer } : {}), ...(d.model ? { model: d.model } : {}), ...(d.specification ? { specification: d.specification } : {}),
        ...(d.notes ? { notes: d.notes } : {}),
      };
  if (d.itemId && counted && d.unitOfMeasure) fields.unit_of_measure = d.unitOfMeasure;
  if (d.itemId && counted && d.quantityScale !== undefined) fields.quantity_scale = d.quantityScale;
  const db = await createClient();
  const { data, error } = await db.rpc("inv_save_item", { p_company_id: d.companyId, p_item_id: d.itemId ?? null, p_fields: fields as never });
  if (error) return fail(error.message);
  refreshInventory();
  if (!d.itemId && d.after === "panel") redirect(`/inventory?open=${data}`);
  return ok({ id: data ?? d.itemId });
}

const unitSchema = z.object({
  companyId: uuid,
  itemId: uuid,
  serial: optionalText,
  locationId: uuid,
  binId: optionalUuid,
  condition: z.enum(["good", "fair", "needs_inspection", "damaged", "unserviceable"]),
  notes: optionalText,
  cost: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().nonnegative("The cost must be zero or more").optional()),
  currency: z.preprocess((v) => (v === "" || v == null ? undefined : String(v).toUpperCase()), z.string().regex(/^[A-Z]{3}$/, "Currency is a 3-letter code, for example AED").optional()),
  purchaseDate: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid purchase date").optional()),
  key: movementKey,
});

/** Registers one more individual unit of an item. It starts as "Not counted yet" until opening stock is confirmed. */
export async function registerUnit(_prev: InvActionState, formData: FormData): Promise<InvActionState> {
  const parsed = unitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  // The currency box is pre-filled (AED), so a currency on its own, with no amount, is just the default left alone and is ignored.
  if (d.cost !== undefined && d.currency === undefined) return { error: "A cost needs both an amount and a currency" };
  const cost = d.cost !== undefined ? { unit_cost: d.cost, currency: d.currency, ...(d.purchaseDate ? { purchase_date: d.purchaseDate } : {}) } : d.purchaseDate ? { purchase_date: d.purchaseDate } : null;
  const db = await createClient();
  const { data, error } = await db.rpc("inv_register_unit", {
    p_company_id: d.companyId, p_item_id: d.itemId, p_serial_number: d.serial ?? null, p_location_id: d.locationId, p_bin_id: d.binId ?? null, p_condition: d.condition,
    p_holder: null, p_cost: cost as never, p_notes: d.notes ?? null, p_key: d.key,
  });
  if (error) return fail(error.message);
  refreshInventory();
  const r = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const code = typeof r.code === "string" ? r.code : undefined;
  return ok({ id: typeof r.unit_id === "string" ? r.unit_id : undefined, code, replayed: r.replayed === true, warning: `${code ? `Registered as ${code}.` : "Registered."} It shows as "Not counted yet" until the opening stock is confirmed.` });
}

const reassignSchema = z.object({
  unitId: uuid,
  to: z.enum(["pool", "employee"], { message: "Choose where the equipment goes" }),
  employeeId: optionalUuid,
  reason: z.string().trim().min(1, "Give a reason for the change").max(2000, "The reason is too long"),
  key: movementKey,
});

/**
 * Changes who holds a unit that is with an employee: back to the project pool (the warehouse stock it was issued from) or to another
 * employee, with a reason. The history keeps who held it before. The same key twice records nothing twice.
 */
export async function reassignUnit(_prev: InvActionState, formData: FormData): Promise<InvActionState> {
  const parsed = reassignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  if (d.to === "employee" && !d.employeeId) return { error: "Choose the employee" };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_reassign_unit", { p_unit_id: d.unitId, p_to: d.to, p_employee_id: d.to === "employee" ? (d.employeeId ?? null) : null, p_reason: d.reason, p_key: d.key });
  if (error) return fail(error.message);
  refreshInventory(["/hr/assets"]);
  const r = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const code = typeof r.movement_code === "string" ? r.movement_code : undefined;
  return ok({ code, replayed: r.replayed === true, warning: `${code ? `Recorded as ${code}.` : "Recorded."} ${d.to === "pool" ? "The unit is back in the project pool and no longer assigned to anyone." : "The unit is now assigned to the other employee."}${r.replayed === true ? " This had already been recorded; nothing was recorded twice." : ""}` });
}

const replaceSchema = z.object({
  itemId: uuid,
  reason: z.string().trim().min(1, "Say why the item is being replaced"),
  name: optionalText,
  categoryId: optionalUuid,
  manufacturer: optionalText,
  model: optionalText,
  specification: optionalText,
  unitOfMeasure: optionalText,
});

/** Retires an item and creates its replacement (the controlled way to change what an item is once it has history). */
export async function replaceItem(_prev: InvActionState, formData: FormData): Promise<InvActionState> {
  const parsed = replaceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const fields = {
    ...(d.name ? { name: d.name } : {}), ...(d.categoryId ? { category_id: d.categoryId } : {}), manufacturer: d.manufacturer ?? "", model: d.model ?? "", specification: d.specification ?? "",
    ...(d.unitOfMeasure ? { unit_of_measure: d.unitOfMeasure } : {}), status: "active",
  };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_replace_item", { p_item_id: d.itemId, p_fields: fields as never, p_reason: d.reason });
  if (error) return fail(error.message);
  refreshInventory();
  redirect(`/inventory?open=${data}`);
}

const correctSchema = z.object({
  companyId: uuid,
  movementId: uuid,
  reason: z.string().trim().min(1, "Say why this entry is being corrected").max(2000),
  key: movementKey,
});

/** A correction is a NEW entry that names the original and says why; the original is never touched. */
export async function correctMovement(_prev: InvActionState, formData: FormData): Promise<InvActionState> {
  const parsed = correctSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const lines: { line_id: string; qty: number }[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("qty_") || typeof v !== "string" || v.trim() === "") continue;
    const id = uuid.safeParse(k.slice(4));
    if (!id.success) continue;
    const q = z.coerce.number().min(0, "The right quantity is zero or more").max(1_000_000_000).safeParse(v.replace(",", "."));
    if (!q.success) return { error: firstIssue(q.error) };
    lines.push({ line_id: id.data, qty: q.data });
  }
  if (lines.length === 0) return { error: "Type the right quantity for at least one line" };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_correct_movement", { p_company_id: d.companyId, p_movement_id: d.movementId, p_key: d.key, p_reason: d.reason, p_lines: lines as never });
  if (error) return fail(error.message);
  refreshInventory();
  const r = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return ok({ code: typeof r.code === "string" ? r.code : undefined, replayed: r.replayed === true, warning: `Correction recorded${typeof r.code === "string" ? ` as ${r.code}` : ""}. The original entry is unchanged.` });
}

const kitLineSchema = z.object({
  companyId: uuid,
  kitUnitId: uuid,
  itemId: uuid,
  expectedQty: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().positive("The expected quantity must be more than zero").optional()),
  isRequired: checkbox,
  note: optionalText,
  remove: checkbox,
});

/** Edits one line of a kit's checklist without moving stock. */
export async function setKitLine(_prev: InvActionState, formData: FormData): Promise<InvActionState> {
  const parsed = kitLineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const db = await createClient();
  const { error } = await db.rpc("inv_set_kit_line", {
    p_company_id: d.companyId, p_kit_unit_id: d.kitUnitId, p_item_id: d.itemId, p_expected_qty: d.expectedQty ?? null, p_is_required: d.isRequired, p_note: d.note ?? null, p_remove: d.remove,
  });
  if (error) return fail(error.message);
  refreshInventory();
  return ok({ warning: d.remove ? "Removed from the checklist." : "Checklist saved." });
}

const binLabelSchema = z.object({ companyId: uuid, itemId: uuid, locationId: uuid, binId: optionalUuid });

/** Gives "this item in this bin" its permanent label code (asking again returns the same code). */
export async function ensureBinLabel(_prev: InvActionState, formData: FormData): Promise<InvActionState> {
  const parsed = binLabelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const db = await createClient();
  const { data, error } = await db.rpc("inv_ensure_bin_label", { p_company_id: d.companyId, p_item_id: d.itemId, p_location_id: d.locationId, p_bin_id: d.binId ?? null });
  if (error) return fail(error.message);
  refreshInventory();
  const r = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const code = typeof r.label_code === "string" ? r.label_code : null;
  return ok({ code: code ?? undefined, warning: code ? `The label for this bin is ${code}. Print it from the stock list below.` : "Done." });
}

