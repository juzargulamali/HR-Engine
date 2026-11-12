"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";
import { friendlyCrmError } from "@/lib/crm/errors";
import { OPS_TEAMS, OPS_TEXT_MAX, OPS_UNAVAILABLE } from "@/lib/crm/ops-planning";
import { isMissingDatabaseFunction } from "@/lib/crm/zoho-save";

/**
 * Sales -> Operations planning on an enquiry. Every action is a thin wrapper over crm_set_ops_planning (20270102000100_ops_phase2b.sql section 2): the function
 * decides who may do it (the enquiry's owner or a Sales founder), refuses a lost enquiry and checks the version, so a forged request gets the same refusal a
 * normal one would. This layer parses the form and turns database errors into plain sentences. Nothing here reserves, books or creates anything: the fields are
 * what Sales tells Operations, and Operations only sees the enquiry while it is flagged.
 */

const uuid = z.string().uuid();
const optionalDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional());
const optionalInt = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional());
const optionalNote = (what: string) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(OPS_TEXT_MAX, `${what} can be at most ${OPS_TEXT_MAX} characters`).optional());

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input.";
/** The planning function is not installed (the Operations database update has not been run): said as that, never as a refusal of what the person typed. */
const fail = (error: { code?: string; message: string }): ActionState => ({ error: isMissingDatabaseFunction(error) ? OPS_UNAVAILABLE : friendlyCrmError(error.message) });

/** The same early answer crm.ts gives: the database still makes the real version check (and refuses), this only says it in words before anything is sent. */
async function staleMessage(supabase: Awaited<ReturnType<typeof createClient>>, id: string, expected: number | null | undefined): Promise<string | null> {
  if (expected == null || !Number.isFinite(expected)) return null;
  const { data } = await supabase.from("crm_opportunities").select("version").eq("id", id).maybeSingle();
  return data && data.version !== expected ? "This enquiry was changed by someone else. Reload the page to see the latest version, then make your change again." : null;
}

/** As in crm.ts: the Sales lists and the enquiry's own page. */
function refresh(id: string) {
  revalidatePath("/sales", "layout");
  revalidatePath(`/sales/opportunities/${id}`);
}

const planningSchema = z.object({
  id: uuid,
  expectedVersion: optionalInt,
  decisionDate: optionalDate,
  dismantleDate: optionalDate,
  teams: z.array(z.enum(OPS_TEAMS, { message: "Choose teams from the list" })).default([]),
  toConfirm: optionalNote("Still to confirm"),
  note: optionalNote("The note for Operations"),
});

/**
 * Flag the enquiry for Operations planning and save the planning details, or save them on an enquiry that is already flagged (the flag date is kept). Every field
 * of the dialog is sent, so an emptied field is cleared. An unticked "Dates are tentative" is false: the tick is always part of the form.
 */
export async function setOpsPlanning(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = planningSchema.safeParse({ ...Object.fromEntries(formData), teams: formData.getAll("teams").filter((x) => x !== "") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();
  const stale = await staleMessage(supabase, d.id, d.expectedVersion);
  if (stale) return { error: stale };
  const { error } = await supabase.rpc("crm_set_ops_planning", {
    p_id: d.id,
    p_flag: true,
    p_fields: {
      decision_date: d.decisionDate ?? null,
      dates_tentative: formData.get("datesTentative") === "on",
      dismantle_date: d.dismantleDate ?? null,
      teams: [...new Set(d.teams)],
      to_confirm: d.toConfirm ?? null,
      note: d.note ?? null,
    },
    p_expected_version: d.expectedVersion ?? null,
  });
  if (error) return fail(error);
  refresh(d.id);
  return { error: null };
}

const removeSchema = z.object({ id: uuid, expectedVersion: optionalInt });

/** Take the enquiry out of Operations planning. The planning details stay on the enquiry (no field is sent), so flagging it again brings them back. */
export async function removeOpsPlanning(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = removeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();
  const stale = await staleMessage(supabase, d.id, d.expectedVersion);
  if (stale) return { error: stale };
  const { error } = await supabase.rpc("crm_set_ops_planning", { p_id: d.id, p_flag: false, p_fields: {}, p_expected_version: d.expectedVersion ?? null });
  if (error) return fail(error);
  refresh(d.id);
  return { error: null };
}

const answerSchema = z.object({
  id: uuid,
  expectedVersion: optionalInt,
  answer: z.string().trim().min(1, "Write the answer for Operations").max(OPS_TEXT_MAX, `The answer can be at most ${OPS_TEXT_MAX} characters`),
});

/** Sales' answer to the question Operations asked. Only the answer is sent, so no planning field changes; the enquiry stays flagged. */
export async function answerOpsQuestion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = answerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();
  const stale = await staleMessage(supabase, d.id, d.expectedVersion);
  if (stale) return { error: stale };
  const { error } = await supabase.rpc("crm_set_ops_planning", { p_id: d.id, p_flag: true, p_fields: { answer: d.answer }, p_expected_version: d.expectedVersion ?? null });
  if (error) return fail(error);
  refresh(d.id);
  return { error: null };
}
