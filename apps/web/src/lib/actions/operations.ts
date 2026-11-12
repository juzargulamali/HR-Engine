"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/actions/companies";
import { createClient } from "@/lib/supabase/server";

/**
 * Operations server actions (migration 20270102000100). One action: the Operations side of a flagged enquiry (provisional Project Manager, risk, capacity conflict,
 * a question for Sales). The database function decides who may do it (the Operations Managers of the enquiry's company) and writes only the planning row: no project,
 * no crew booking and no stock reservation is created by a provisional assignment. Assigning the real Project Manager is the existing handover action in Projects.
 */
type S = ActionState & { notice?: string | null };
const text = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max, `Keep it under ${max} characters`).optional());
const FRIENDLY: [RegExp, string][] = [
  [/Enquiry not found/i, "This enquiry is not available to you in Operations. It may have been removed from Operations planning, or your Operations access for this company has ended."],
  [/has not flagged/i, "Sales has removed this enquiry from Operations planning. Reload the page."],
  [/was lost/i, "This enquiry was lost, so it can no longer be planned."],
  [/Projects access for this company/i, "Choose someone who has Projects access for this company."],
];

export async function saveEnquiryPlanning(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    opportunityId: z.string().uuid(), provisionalPmId: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().uuid().optional()),
    risk: z.enum(["unknown", "low", "medium", "high"]), riskNote: text(500), capacityNote: text(500), question: text(1000),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
  const patch: Record<string, unknown> = {
    provisional_pm_id: p.data.provisionalPmId ?? null, risk: p.data.risk, risk_note: p.data.riskNote ?? null,
    capacity_conflict: fd.get("capacityConflict") === "on", capacity_note: p.data.capacityNote ?? null,
  };
  // The question is sent only when it was changed: saving the form again must not clear an answer Sales already gave.
  if (fd.get("questionChanged") === "1") patch.question = p.data.question ?? null;
  const { error } = await (await createClient()).rpc("ops_set_enquiry_planning", { p_opportunity_id: p.data.opportunityId, p_patch: patch });
  if (error) return { error: FRIENDLY.find(([re]) => re.test(error.message))?.[1] ?? "The planning details could not be saved. Try again." };
  revalidatePath("/operations", "layout");
  return { error: null, notice: p.data.provisionalPmId ? "Saved. The provisional Project Manager is a note for planning: no project, crew or stock was booked." : "Saved." };
}
