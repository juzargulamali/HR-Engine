"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, ok, optionalText, optionalUuid, qtyField, refreshInventory, uuid, type InvActionState } from "@/lib/inventory/action-utils";
import {
  asArray, asRecord, cancelMessage, expandMessage, parsePlanInput, reserveMessage, windowChangeMessages, zonedLocalToUtcIso, str, num,
} from "@/lib/inventory/planning";

/**
 * Equipment planning server actions: requests, request lines, substitutions, reservations, availability, Sales checks and the handover
 * import. Each one is a thin wrapper over an inv_* database function. The function decides who may do what (every check is in the
 * database; hidden buttons are cosmetic), so a forged request gets the same refusal a normal one would. This layer parses the form,
 * says at once when a record has moved on since it was loaded, and turns what the function answers into plain sentences.
 *
 * Nothing is reported as saved before the function says so. Informational follow-ups (what was released, what is still outstanding)
 * come back in `warning`, which the form shows after the save; they never mean the save failed.
 */
type S = InvActionState;
type Db = Awaited<ReturnType<typeof createClient>>;

const STALE = "This was changed by someone else. Reload the page to see the latest version, then make your change again.";

/** Says at once when a request or line moved on since it was loaded (the database refuses it too, but an unanswered stale check can hang). */
async function stale(db: Db, table: "inv_requests" | "inv_request_lines", id: string, expected: number | undefined): Promise<string | null> {
  if (expected === undefined) return null;
  const { data } = await db.from(table).select("version").eq("id", id).maybeSingle();
  return data && data.version !== expected ? STALE : null;
}

const version = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional());

function refresh(projectId?: string | null, extra: string[] = []) {
  refreshInventory([...(projectId ? [`/projects/${projectId}/equipment`] : []), ...extra]);
}

const fields = (fd: FormData) => Object.fromEntries(fd) as Record<string, FormDataEntryValue>;

// ---------------------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------------------
const createSchema = z.object({
  kind: z.enum(["project", "employee"], { message: "Choose whether the request is for a project or an employee" }),
  projectId: optionalUuid,
  employeeId: optionalUuid,
  employeeName: optionalText,
  title: optionalText,
  locationId: optionalUuid,
  timezone: optionalText,
  destination: optionalText,
  note: optionalText,
});

export async function createRequest(_prev: S, fd: FormData): Promise<S> {
  const p = createSchema.safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  if (d.kind === "project" && !d.projectId) return { error: "Choose the project" };
  if (d.kind === "employee" && !d.employeeId) return { error: "Choose the employee" };
  if (d.kind === "employee" && !d.locationId && !d.timezone) return { error: "Choose the warehouse the equipment will be collected from" };
  const plan = parsePlanInput(fields(fd));
  if (plan.error) return { error: plan.error };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_create_request", {
    p_kind: d.kind, p_project_id: d.kind === "project" ? d.projectId : null, p_employee_id: d.kind === "employee" ? d.employeeId : null,
    p_title: d.title ?? (d.kind === "employee" && d.employeeName ? `Equipment for ${d.employeeName}` : null), p_plan: plan.plan, p_timezone: d.timezone ?? null, p_destination: d.destination ?? null, p_pickup_location_id: d.locationId ?? null, p_note: d.note ?? null,
  });
  if (error) return fail(error.message);
  refresh(d.projectId);
  return ok({ id: data });
}

const planSchema = z.object({ requestId: uuid, expectedVersion: version, timezone: optionalText, projectId: optionalUuid });

/**
 * The dates of a draft are saved directly. Once a request has been submitted its dates move through inv_change_request_window,
 * which rechecks every reservation, never takes anything away from anybody and reports what could not move.
 */
export async function saveRequestPlan(_prev: S, fd: FormData): Promise<S> {
  const p = planSchema.safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const plan = parsePlanInput(fields(fd));
  if (plan.error) return { error: plan.error };
  const db = await createClient();
  const { data: req } = await db.from("inv_requests").select("status, version, timezone").eq("id", p.data.requestId).maybeSingle();
  if (!req) return { error: "This request does not exist, or you cannot see it." };
  if (p.data.expectedVersion !== undefined && req.version !== p.data.expectedVersion) return { error: STALE };
  const tz = p.data.timezone ?? req.timezone;
  if (req.status === "draft") {
    const { error } = await db.rpc("inv_save_request_plan", { p_request_id: p.data.requestId, p_plan: plan.plan, p_timezone: tz, p_expected_version: p.data.expectedVersion ?? null });
    if (error) return fail(error.message);
    refresh(p.data.projectId);
    return ok({ warning: "The dates are saved." });
  }
  const { data, error } = await db.rpc("inv_change_request_window", { p_request_id: p.data.requestId, p_plan: plan.plan, p_timezone: tz, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  const words = windowChangeMessages(data, tz);
  return ok({ warning: words.summary, detail: { conflicts: words.conflicts } });
}

export async function submitRequest(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ requestId: uuid, expectedVersion: version, projectId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const msg = await stale(db, "inv_requests", p.data.requestId, p.data.expectedVersion);
  if (msg) return { error: msg };
  const { error } = await db.rpc("inv_submit_request", { p_request_id: p.data.requestId, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  return ok({ warning: "The request is with the warehouse. Submitting does not reserve anything: the warehouse reserves from stock." });
}

export async function cancelRequest(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ requestId: uuid, reason: optionalText, projectId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_cancel_request", { p_request_id: p.data.requestId, p_reason: p.data.reason ?? null });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  return ok({ warning: cancelMessage(data, "request") });
}

// ---------------------------------------------------------------------------------------------------------------
// Request lines
// ---------------------------------------------------------------------------------------------------------------
export async function addRequestLine(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ requestId: uuid, itemId: z.string().uuid("Choose an item from the list"), qty: qtyField, note: optionalText, projectId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_add_request_line", { p_request_id: p.data.requestId, p_item_id: p.data.itemId, p_qty: p.data.qty, p_note: p.data.note ?? null, p_expected_version: null });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  return ok({ id: data });
}

export async function expandTechnology(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ requestId: uuid, technologyId: z.string().uuid("Choose a technology template"), multiplier: qtyField, choices: optionalText, technologyName: optionalText, projectId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  let choices: Record<string, string> = {};
  if (p.data.choices) {
    try {
      const parsed = JSON.parse(p.data.choices);
      choices = z.record(z.string(), z.string().uuid()).parse(parsed);
    } catch {
      return { error: "The alternative choices could not be read. Reload the page and try again." };
    }
  }
  const db = await createClient();
  const { data, error } = await db.rpc("inv_expand_technology", { p_request_id: p.data.requestId, p_technology_id: p.data.technologyId, p_multiplier: p.data.multiplier, p_choices: choices });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  return ok({ warning: expandMessage(data, p.data.technologyName ?? "the template", p.data.multiplier), detail: asRecord(data) });
}

export async function updateRequestLine(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ lineId: uuid, qty: qtyField, expectedVersion: version, projectId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const msg = await stale(db, "inv_request_lines", p.data.lineId, p.data.expectedVersion);
  if (msg) return { error: msg };
  const { error } = await db.rpc("inv_update_request_line", { p_line_id: p.data.lineId, p_qty: p.data.qty, p_note: fd.has("note") ? String(fd.get("note") ?? "").trim() : null, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  return ok();
}

export async function cancelRequestLine(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ lineId: uuid, reason: optionalText, projectId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_cancel_request_line", { p_line_id: p.data.lineId, p_reason: p.data.reason ?? null });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  return ok({ warning: cancelMessage(data, "line") });
}

export async function proposeSubstitution(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ lineId: uuid, itemId: z.string().uuid("Choose one of the listed alternatives"), note: optionalText, expectedVersion: version, projectId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const msg = await stale(db, "inv_request_lines", p.data.lineId, p.data.expectedVersion);
  if (msg) return { error: msg };
  const { error } = await db.rpc("inv_propose_substitution", { p_line_id: p.data.lineId, p_item_id: p.data.itemId, p_note: p.data.note ?? null, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  return ok({ warning: "The substitute is proposed and marked as not yet accepted. Until the project manager accepts it, the warehouse keeps preparing the original item." });
}

export async function decideSubstitution(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ lineId: uuid, accept: z.enum(["yes", "no"]), note: optionalText, projectId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_decide_substitution", { p_line_id: p.data.lineId, p_accept: p.data.accept === "yes", p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  const released = num(asRecord(data).released_qty);
  return ok({ warning: p.data.accept === "yes" ? `The substitute is accepted.${released > 0 ? ` ${released} reserved of the original ${released === 1 ? "was" : "were"} released: the warehouse reserves the substitute again.` : ""}` : "The substitute is declined. The original item stays on the line." });
}

export async function setShortageAction(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ lineId: uuid, action: z.enum(["none", "need_to_buy", "need_to_rent"]), note: optionalText, rentalReference: optionalText, projectId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: "Choose what happens to the shortage" };
  if (p.data.action === "need_to_rent" && !p.data.rentalReference) return { error: "Give the external reference of the rental (supplier quote or order number)" };
  const db = await createClient();
  const { error } = await db.rpc("inv_set_shortage_action", { p_line_id: p.data.lineId, p_action: p.data.action, p_note: p.data.note ?? null, p_rental_reference: p.data.rentalReference ?? null });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  return ok();
}

// ---------------------------------------------------------------------------------------------------------------
// Reservations (warehouse people)
// ---------------------------------------------------------------------------------------------------------------
export async function reserveLine(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    lineId: uuid, locationId: z.string().uuid("Choose where to reserve from"), mode: z.enum(["auto", "units"]).default("auto"),
    qty: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().positive("The quantity must be more than zero").optional()),
    shortageAction: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["none", "need_to_buy", "need_to_rent"]).optional()), rentalReference: optionalText, projectId: optionalUuid,
  }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const unitIds = fd.getAll("unitIds").map(String).filter((u) => z.string().uuid().safeParse(u).success);
  if (p.data.mode === "units" && unitIds.length === 0) return { error: "Tick the units to reserve, or choose “Pick free ones for me”" };
  if (p.data.shortageAction === "need_to_rent" && !p.data.rentalReference) return { error: "Give the external reference of the rental" };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_reserve", {
    p_line_id: p.data.lineId, p_location_id: p.data.locationId, p_unit_ids: p.data.mode === "units" ? unitIds : null, p_qty: p.data.mode === "units" ? null : (p.data.qty ?? null),
    p_shortage_action: p.data.shortageAction ?? null, p_rental_reference: p.data.rentalReference ?? null,
  });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  const words = reserveMessage(data);
  return ok({ warning: words.text, detail: asRecord(data) });
}

export async function releaseReservation(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ reservationId: uuid, reason: optionalText, projectId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_release_reservation", { p_reservation_id: p.data.reservationId, p_reason: p.data.reason ?? null });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  const r = asRecord(data);
  const kept = num(r.kept_dispatched_qty);
  return ok({ warning: `${num(r.released_qty)} released.${kept > 0 ? ` ${kept} already dispatched stays reserved and outstanding until it is returned.` : ""}` });
}

// ---------------------------------------------------------------------------------------------------------------
// Projects: the Sales handover import
// ---------------------------------------------------------------------------------------------------------------
export async function importHandover(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_import_handover_requirements", { p_project_id: p.data.projectId });
  if (error) return fail(error.message);
  refresh(p.data.projectId);
  return ok({ id: data ?? undefined, warning: data ? "The equipment of the handover is in its request (see Requests below). Running the import again never adds a second one." : "Nothing could be imported. The reason is in the import log below." });
}

// ---------------------------------------------------------------------------------------------------------------
// Sales: availability checks (a dated record; nothing is reserved)
// ---------------------------------------------------------------------------------------------------------------
export async function requestOpportunityCheck(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ opportunityId: uuid, locationId: optionalUuid }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const { error } = await db.rpc("inv_request_opportunity_check", { p_opportunity_id: p.data.opportunityId, p_location_id: p.data.locationId ?? null });
  if (error) return fail(error.message);
  refreshInventory(["/sales/opportunities"]);
  revalidatePath("/sales", "layout");
  return ok({ warning: "The warehouse has been asked to check. Checking availability does not reserve anything." });
}

export async function recordOpportunityCheck(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ opportunityId: uuid, locationId: z.string().uuid("Choose the location to check against"), note: optionalText }).safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const db = await createClient();
  const { error } = await db.rpc("inv_record_opportunity_check", { p_opportunity_id: p.data.opportunityId, p_location_id: p.data.locationId, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshInventory(["/sales/opportunities"]);
  revalidatePath("/sales", "layout");
  return ok({ warning: "The check is recorded with your name and the time. It does not reserve anything." });
}

// ---------------------------------------------------------------------------------------------------------------
// Reads for the dialogs and pickers (nothing is changed)
// ---------------------------------------------------------------------------------------------------------------
export interface ItemOption { id: string; name: string; model: string | null; tracking: string; unit: string }
export interface ItemSearchResult { error: string | null; items: ItemOption[] }

/** Type-ahead over the catalogue the person may browse. Characters with a meaning in the filter syntax are dropped, never passed on. */
export async function searchItems(companyId: string, query: string): Promise<ItemSearchResult> {
  if (!uuid.safeParse(companyId).success) return { error: "Choose the company first", items: [] };
  const q = query.replace(/[,()%_*\\"']/g, " ").trim().slice(0, 60);
  if (q.length < 2) return { error: null, items: [] };
  const db = await createClient();
  const { data, error } = await db.from("inv_items").select("id, name, model, tracking, unit_of_measure").eq("company_id", companyId).neq("status", "retired")
    .or(`name.ilike.%${q}%,model.ilike.%${q}%,manufacturer.ilike.%${q}%`).order("name").limit(15);
  if (error) return { error: fail(error.message).error, items: [] };
  return { error: null, items: (data ?? []).map((i) => ({ id: i.id, name: i.name, model: i.model, tracking: i.tracking, unit: i.unit_of_measure })) };
}

export interface EmployeeOption { id: string; name: string; number: string; department: string | null }
export async function lookupEmployees(companyId: string, query: string): Promise<{ error: string | null; people: EmployeeOption[] }> {
  if (!uuid.safeParse(companyId).success) return { error: "Choose the company first", people: [] };
  if (query.trim().length < 2) return { error: null, people: [] };
  const db = await createClient();
  const { data, error } = await db.rpc("inv_employee_lookup", { p_company_id: companyId, p_query: query.trim().slice(0, 60) });
  if (error) return { error: fail(error.message).error, people: [] };
  return { error: null, people: (data ?? []).map((e) => ({ id: e.employee_id, name: e.display_name, number: e.employee_number, department: e.department_name })) };
}

export interface AvailabilityAnswer { error: string | null; kind?: "item" | "technology"; result?: unknown; timeZone?: string; usesRange?: { from: string; until: string } }

/** The Availability dialog: dates are typed as local times at the chosen location and converted here with that location's time zone. */
export async function checkAvailability(input: { kind: "item" | "technology"; id: string; qty: number; locationId: string; from: string; until: string }): Promise<AvailabilityAnswer> {
  const parsed = z.object({ kind: z.enum(["item", "technology"]), id: z.string().uuid("Choose an item or a technology"), qty: qtyField, locationId: z.string().uuid("Choose a location"), from: z.string(), until: z.string() }).safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const db = await createClient();
  const { data: loc } = await db.from("inv_locations").select("timezone").eq("id", parsed.data.locationId).maybeSingle();
  if (!loc) return { error: "That location does not exist, or you cannot see it." };
  const from = zonedLocalToUtcIso(parsed.data.from, loc.timezone);
  const until = zonedLocalToUtcIso(parsed.data.until, loc.timezone);
  if (!from || !until) return { error: "Give a start and an end date and time" };
  if (until <= from) return { error: "The end must be after the start" };
  if (parsed.data.kind === "item") {
    const { data, error } = await db.rpc("inv_availability", { p_item_id: parsed.data.id, p_location_id: parsed.data.locationId, p_from: from, p_until: until });
    if (error) return { error: fail(error.message).error };
    return { error: null, kind: "item", result: data, timeZone: loc.timezone };
  }
  const { data, error } = await db.rpc("inv_technology_availability", { p_technology_id: parsed.data.id, p_qty: parsed.data.qty, p_location_id: parsed.data.locationId, p_from: from, p_until: until });
  if (error) return { error: fail(error.message).error };
  return { error: null, kind: "technology", result: data, timeZone: loc.timezone };
}

export interface FreeUnitOption { id: string; code: string; serial: string | null; free: boolean; reason: string | null }
/** For "pick named units": which units of the line's item are free for the request's window at the chosen location. */
export async function unitsForReserve(lineId: string, locationId: string): Promise<{ error: string | null; units: FreeUnitOption[]; free: number | null }> {
  if (!uuid.safeParse(lineId).success || !uuid.safeParse(locationId).success) return { error: "Choose a location", units: [], free: null };
  const db = await createClient();
  const { data: line } = await db.from("inv_request_lines").select("item_id, original_item_id, substitution_status, request_id").eq("id", lineId).maybeSingle();
  if (!line) return { error: "This line does not exist, or you cannot see it.", units: [], free: null };
  const { data: req } = await db.from("inv_requests").select("needed_from, needed_until").eq("id", line.request_id).maybeSingle();
  if (!req?.needed_from || !req.needed_until) return { error: "The request has no planning window yet. Set its dates first.", units: [], free: null };
  const itemId = line.substitution_status === "proposed" && line.original_item_id ? line.original_item_id : line.item_id;
  const { data, error } = await db.rpc("inv_availability", { p_item_id: itemId, p_location_id: locationId, p_from: req.needed_from, p_until: req.needed_until });
  if (error) return { error: fail(error.message).error, units: [], free: null };
  const r = asRecord(data);
  return {
    error: null, free: num(r.free_for_range),
    units: asArray(r.units).map((u) => {
      const x = asRecord(u);
      return { id: String(x.unit_id ?? ""), code: String(x.code ?? ""), serial: str(x.serial_number), free: x.free === true, reason: str(x.reason) };
    }),
  };
}
