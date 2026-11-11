"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { friendlyCrmError } from "@/lib/crm/errors";
import { AGENCY_ROLES } from "@/lib/crm/events/model";
import type { ActionState } from "./companies";

/**
 * Events & Exhibitions server actions (migration 20261224000100). Thin wrappers over the crm_* functions: the function, not this file, decides who may add, edit or
 * archive (any Sales grant adds; the person who added it or a founder edits or archives; nothing is ever deleted), keeps the shape of an observation. This layer parses the form and turns database errors into sentences.
 */
const uuid = z.string().uuid();
const fail = (message: string): ActionState => ({ error: friendlyCrmError(message) });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input.";
const refresh = () => revalidatePath("/sales", "layout");
const text = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
const optionalUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

/** Sets or clears (null = Unrated) the ONE shared outreach priority of an account. Any Sales grant may; the database repeats the check. */
export async function setOutreachPriority(orgId: string, priority: number | null): Promise<ActionState> {
  if (!uuid.safeParse(orgId).success) return { error: "Missing account." };
  if (priority !== null && (!Number.isInteger(priority) || priority < 1 || priority > 5)) return { error: "Outreach priority is 1 to 5 (5 is highest), or Unrated." };
  const { error } = await (await createClient()).rpc("crm_set_outreach_priority", { p_org: orgId, p_priority: priority });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}

const eventSchema = z.object({ id: optionalUuid, name: z.string().trim().min(1, "Enter the event name").max(200, "The event name is too long"), kind: z.enum(["exhibition", "conference", "other"]).default("exhibition"), website: text(300), note: text(1000) });

/** Adds an event (no id) or edits one. A second event with the same name is refused: open it and add the next edition instead. */
export async function saveEvent(_prev: ActionState & { id?: string }, formData: FormData): Promise<ActionState & { id?: string }> {
  const p = eventSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const { data, error } = await (await createClient()).rpc("crm_save_event", { p_id: d.id ?? null, p_name: d.name, p_kind: d.kind, p_website: d.website ?? null, p_note: d.note ?? null });
  if (error) return fail(error.message);
  refresh();
  return { error: null, id: String(data) };
}

const editionSchema = z.object({
  id: optionalUuid, eventId: optionalUuid, start: date, end: date, city: text(100), country: text(2), venue: text(200), note: text(1000),
}).superRefine((d, ctx) => {
  if (!d.id && !d.eventId) ctx.addIssue({ code: "custom", message: "Choose the event." });
  if (d.end < d.start) ctx.addIssue({ code: "custom", message: "The end date cannot be before the start date." });
  if (d.country && !/^[A-Za-z]{2}$/.test(d.country)) ctx.addIssue({ code: "custom", message: "Use a two-letter country code, for example AE." });
});

/** Adds an edition (no id) or corrects one edition's dates and place. Adding the next edition never touches an earlier one. */
export async function saveEdition(_prev: ActionState & { id?: string }, formData: FormData): Promise<ActionState & { id?: string }> {
  const p = editionSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const { data, error } = await (await createClient()).rpc("crm_save_edition", {
    p_id: d.id ?? null, p_event: d.eventId ?? null, p_start: d.start, p_end: d.end, p_city: d.city ?? null, p_country: d.country ? d.country.toUpperCase() : null, p_venue: d.venue ?? null, p_note: d.note ?? null,
  });
  if (error) return fail(error.message);
  refresh();
  return { error: null, id: String(data) };
}

export type EventEditionState = ActionState & { id?: string; editionId?: string };
const eventEditionSchema = z.object({
  eventId: optionalUuid, name: text(200), kind: z.enum(["exhibition", "conference", "other"]).default("exhibition"),
  start: date, end: date, city: text(100), country: text(2), venue: text(200), note: text(1000),
}).superRefine((d, ctx) => {
  if (!d.eventId && !d.name) ctx.addIssue({ code: "custom", message: "Enter the event name" });
  if (d.end < d.start) ctx.addIssue({ code: "custom", message: "The end date cannot be before the start date." });
  if (d.country && !/^[A-Za-z]{2}$/.test(d.country)) ctx.addIssue({ code: "custom", message: "Use a two-letter country code, for example AE." });
});

/**
 * The one "event and edition" form (Add event, and Create event or edition on an enquiry). With `eventId` it adds an edition to that existing event
 * (crm_save_edition). Without it, it adds a NEW event together with its first edition through crm_add_event_with_edition (migration 20261227000100): one database
 * call, so a refused edition never leaves an event behind. It never falls back to two separate saves. Returns the event id (`id`) and the new `editionId`.
 */
export async function saveEventEdition(_prev: EventEditionState, formData: FormData): Promise<EventEditionState> {
  const p = eventEditionSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const place = { p_city: d.city ?? null, p_country: d.country ? d.country.toUpperCase() : null, p_venue: d.venue ?? null };
  const supabase = await createClient();
  if (d.eventId) {
    const { data, error } = await supabase.rpc("crm_save_edition", { p_id: null, p_event: d.eventId, p_start: d.start, p_end: d.end, ...place, p_note: d.note ?? null });
    if (error) return fail(error.message);
    refresh();
    return { error: null, id: d.eventId, editionId: String(data) };
  }
  const { data, error } = await supabase.rpc("crm_add_event_with_edition", { p_name: d.name!, p_kind: d.kind, p_start: d.start, p_end: d.end, ...place, p_website: null, p_event_note: null, p_edition_note: d.note ?? null });
  if (error) {
    if (/could not find the function|schema cache|does not exist/i.test(error.message)) return { error: "Adding an event with its first edition is not available yet: the database update for it has not been applied. Nothing was saved." };
    return fail(error.message);
  }
  const ids = data as { event_id?: unknown; edition_id?: unknown } | null;
  if (typeof ids?.event_id !== "string" || typeof ids.edition_id !== "string") return { error: "The event was saved but its details did not come back. Reload the page to see it before trying again." };
  refresh();
  return { error: null, id: ids.event_id, editionId: ids.edition_id };
}

/**
 * ARCHIVES an edition: the standard (and only) removal. It is archived whatever is attached, so the result never reveals whether an enquiry the person cannot see is linked;
 * every observation and enquiry link stays; the edition stays in history but is no longer offered for new enquiry links.
 */
export async function archiveEdition(editionId: string): Promise<ActionState> {
  if (!uuid.safeParse(editionId).success) return { error: "Missing edition." };
  const { error } = await (await createClient()).rpc("crm_archive_edition", { p_id: editionId });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}

/** ARCHIVES an event. Its editions, observations and enquiry links are all kept exactly as they were; they are no longer offered for new links. */
export async function archiveEvent(eventId: string): Promise<ActionState> {
  if (!uuid.safeParse(eventId).success) return { error: "Missing event." };
  const { error } = await (await createClient()).rpc("crm_archive_event", { p_id: eventId });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}

const observationSchema = z.object({
  id: optionalUuid, editionId: optionalUuid, exhibitorId: optionalUuid,
  kind: z.enum(["exhibited", "did_not_exhibit"]).default("exhibited"),
  agencyId: optionalUuid,
  agencyUnknown: z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean()),
  stand: text(40),
  role: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(AGENCY_ROLES as unknown as [string, ...string[]]).optional()),
  note: text(1000),
  confirmed: z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean()),
}).superRefine((d, ctx) => {
  if (!d.id && !d.editionId) ctx.addIssue({ code: "custom", message: "Choose the edition." });
  if (!d.id && !d.exhibitorId) ctx.addIssue({ code: "custom", message: "Choose the exhibitor from the list." });
  if (d.kind === "exhibited" && !d.agencyId && !d.agencyUnknown) ctx.addIssue({ code: "custom", message: "Choose the agency from the list, or tick “Agency unknown”." });
  if (d.kind === "exhibited" && d.agencyId && d.agencyUnknown) ctx.addIssue({ code: "custom", message: "Choose an agency or tick “Agency unknown”, not both." });
});

/** Records (no id) or corrects an observation: what was seen at ONE edition for ONE exhibitor. It needs no enquiry and creates none. */
export async function saveObservation(_prev: ActionState & { id?: string }, formData: FormData): Promise<ActionState & { id?: string }> {
  const p = observationSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const didNot = d.kind === "did_not_exhibit";
  const common = { p_kind: d.kind, p_agency: didNot ? null : (d.agencyUnknown ? null : d.agencyId ?? null), p_agency_unknown: didNot ? false : d.agencyUnknown, p_stand: didNot ? null : d.stand ?? null, p_role: didNot ? null : d.role ?? null, p_note: d.note ?? null, p_verification: d.confirmed ? "confirmed" : "unverified" };
  const supabase = await createClient();
  if (d.id) {
    const { error } = await supabase.rpc("crm_update_observation", { p_id: d.id, ...common });
    if (error) return fail(error.message);
    refresh();
    return { error: null, id: d.id };
  }
  const { data, error } = await supabase.rpc("crm_record_observation", { p_edition: d.editionId!, p_exhibitor: d.exhibitorId!, ...common });
  if (error) return fail(error.message);
  refresh();
  return { error: null, id: String(data) };
}

export async function removeObservation(observationId: string): Promise<ActionState> {
  if (!uuid.safeParse(observationId).success) return { error: "Missing observation." };
  const { error } = await (await createClient()).rpc("crm_remove_observation", { p_id: observationId });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}

/** Sets, changes or clears (no edition) the edition an enquiry is linked to. Same rule and stale-version check as editing the enquiry's details. */
export async function setOpportunityEdition(opportunityId: string, editionId: string | null, expectedVersion: number | null): Promise<ActionState> {
  if (!uuid.safeParse(opportunityId).success || (editionId !== null && !uuid.safeParse(editionId).success)) return { error: "Missing enquiry or edition." };
  const { error } = await (await createClient()).rpc("crm_set_opportunity_edition", { p_id: opportunityId, p_edition: editionId, p_expected_version: expectedVersion });
  if (error) return fail(error.message);
  revalidatePath("/sales", "layout");
  revalidatePath(`/sales/opportunities/${opportunityId}`);
  return { error: null };
}
