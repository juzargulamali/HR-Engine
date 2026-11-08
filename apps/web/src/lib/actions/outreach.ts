"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasCrmCapability } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { getCrmContext } from "@/lib/crm/context";
import { friendlyCrmError } from "@/lib/crm/errors";
import { isOutcomeValidForKind, OUTREACH_KINDS, OUTREACH_OUTCOME_LABEL, OUTREACH_OUTCOMES, OUTREACH_OUTCOMES_BY_KIND, OUTREACH_SETTABLE_STATUSES } from "@/lib/crm/clients-agencies/outreach";
import type { ActionState } from "./companies";

/**
 * Pre-inquiry outreach server actions. Thin wrappers over the crm_* functions of migration 20261219000100 (section 8): the database decides who may assign
 * (assign_owner), who may act on an outreach (its assignee or an assign_owner holder) and every status rule, so a forged request gets the same refusal.
 * The only check made here first is the assign_owner capability for assigning, read from the caller's own grants.
 */

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const fail = (message: string): ActionState => ({ error: friendlyCrmError(message) });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input.";
const refresh = () => revalidatePath("/sales", "layout");
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optText = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const optDate = z.preprocess(blank, date.optional());

export type AssignOutreachState = ActionState & { results?: { organisation_id: string; result: string }[] };

const assignSchema = z.object({
  companyId: uuid, assigneeId: z.string().uuid("Choose who the outreach is for."), target: date, objective: optText(500),
  orgIds: z.array(uuid).min(1, "Choose at least one account").max(200, "Assign at most 200 accounts at a time"),
});

/** Assign one or several accounts to an eligible salesperson with a target date and an optional objective. Never touches the account owner. */
export async function assignOutreach(_prev: AssignOutreachState, formData: FormData): Promise<AssignOutreachState> {
  const p = assignSchema.safeParse({ ...Object.fromEntries(formData), orgIds: formData.getAll("orgId").map(String) });
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const ctx = await getCrmContext();
  if (!ctx || ctx.loadFailed) return { error: "Could not check your Sales access. Nothing was saved." };
  if (!hasCrmCapability(ctx.grants, d.companyId, "assign_owner")) return { error: "Only a founder, or someone with the assign owners right, can assign outreach." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_assign_outreach", { p_company: d.companyId, p_orgs: d.orgIds, p_assignee: d.assigneeId, p_target: d.target, p_objective: d.objective ?? null });
  if (error) return fail(error.message);
  refresh();
  return { error: null, results: data ?? [] };
}

const logSchema = z.object({
  outreachId: uuid, kind: z.enum(OUTREACH_KINDS as unknown as [string, ...string[]], { message: "Choose call, email or meeting" }),
  on: date, outcome: z.enum(OUTREACH_OUTCOMES as unknown as [string, ...string[]], { message: "Choose an outcome" }),
  note: optText(1000), nextAction: optText(300), nextDue: optDate,
}).superRefine((d, ctx) => {
  // the outcome must fit the kind (the database function checks the same lists again)
  if (!isOutcomeValidForKind(d.kind, d.outcome)) {
    const fit = OUTREACH_OUTCOMES_BY_KIND[d.kind as keyof typeof OUTREACH_OUTCOMES_BY_KIND].map((o) => OUTREACH_OUTCOME_LABEL[o]).join(", ");
    ctx.addIssue({ code: "custom", path: ["outcome"], message: `That outcome does not fit a ${d.kind}. Choose one of: ${fit}` });
  }
});

/** Log a call, email or meeting with its date, outcome and a short note, and optionally the next action. Outcome is chosen, never inferred. */
export async function logOutreachActivity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = logSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  if (!!d.nextAction !== !!d.nextDue) return { error: "The next action needs both what to do and a due date." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_outreach_log", { p_outreach: d.outreachId, p_kind: d.kind, p_on: d.on, p_outcome: d.outcome, p_note: d.note ?? null, p_next_action: d.nextAction ?? null, p_next_due: d.nextDue ?? null });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}

const nextSchema = z.object({ outreachId: uuid, nextAction: z.string().trim().min(1, "Say what to do next").max(300), nextDue: date });

export async function setOutreachNextAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = nextSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_outreach_set_next", { p_outreach: p.data.outreachId, p_text: p.data.nextAction, p_due: p.data.nextDue });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}

const statusSchema = z.object({ outreachId: uuid, status: z.enum(OUTREACH_SETTABLE_STATUSES as unknown as [string, ...string[]], { message: "Choose a status" }), reason: optText(500) });

/** Set the progress status by hand. Closed needs a reason; Inquiry raised can only come from linking an inquiry. */
export async function setOutreachStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = statusSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  if (p.data.status === "closed" && !p.data.reason) return { error: "Say why it is closed." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_outreach_set_status", { p_outreach: p.data.outreachId, p_status: p.data.status, p_reason: p.data.reason ?? null });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}

const linkSchema = z.object({ outreachId: uuid, opportunityId: z.string().uuid("Choose the inquiry to link.") });

/** Link an existing inquiry of this account: sets Inquiry raised. Creates nothing. */
export async function linkOutreachInquiry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = linkSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_outreach_link_inquiry", { p_outreach: p.data.outreachId, p_opportunity: p.data.opportunityId });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}
