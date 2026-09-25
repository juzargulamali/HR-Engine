"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";

const POLICY_TYPES = [
  "leave_rules",
  "overtime_rules",
  "notice_period",
  "probation_rules",
  "working_week",
  "end_of_service_benefit",
] as const;

const draftPolicySchema = z.object({
  countryCode: z.string().length(2),
  policyType: z.enum(POLICY_TYPES),
  versionNo: z.coerce.number().int().min(1),
  effectiveFrom: z.string().min(1),
  payloadJson: z.string().min(1),
});

/**
 * Every new row lands as a draft — RLS enforces that regardless of what
 * this sends (policy_versions_insert requires status = 'draft'), so there's
 * nothing to skip here even if this Server Action changed.
 */
export async function draftPolicy(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = draftPolicySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(parsed.data.payloadJson);
  } catch {
    return { error: "Payload must be valid JSON — e.g. {} or {\"default_days\": 30}." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("policy_versions")
    .insert({
      country_code: parsed.data.countryCode,
      policy_type: parsed.data.policyType,
      version_no: parsed.data.versionNo,
      effective_from: parsed.data.effectiveFrom,
      payload,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Could not draft the policy." };

  revalidatePath("/policies");
  redirect(`/policies/${data.id}`);
}

/**
 * The activation itself is a plain UPDATE — every rule (two-person control,
 * CEO content-edit block, exclusion-constraint check) is enforced by
 * guard_policy_version_update and the exclusion constraint in Postgres, not
 * here. This Server Action's only job is to surface whatever Postgres says.
 */
export async function activatePolicy(policyVersionId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("policy_versions").update({ status: "active" }).eq("id", policyVersionId);
  revalidatePath("/policies");
  revalidatePath(`/policies/${policyVersionId}`);
  return { error: error?.message ?? null };
}

/** policy_versions_delete only allows this while status = 'draft' — an active version is real, in-effect policy and stays forever. */
export async function deletePolicyVersion(policyVersionId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("policy_versions").delete().eq("id", policyVersionId);
  revalidatePath("/policies");
  return { error: error?.message ?? null };
}

const addLeaveTypeSchema = z.object({
  policyVersionId: z.string().uuid(),
  leaveTypeCode: z.string().min(1),
  name: z.string().min(1),
  accrualMethod: z.enum(["monthly_accrual", "annual_grant", "per_service_year"]),
  accrualRatePerPeriod: z.coerce.number().optional(),
  maxBalanceDays: z.coerce.number().optional(),
  carryoverMaxDays: z.coerce.number().optional(),
  carryoverExpiryMonths: z.coerce.number().int().optional(),
  minServiceDaysToAccrue: z.coerce.number().int().optional(),
  approvalLevelsRequired: z.coerce.number().int().min(1).default(1),
});

export async function addPolicyLeaveType(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = addLeaveTypeSchema.safeParse({
    ...raw,
    accrualRatePerPeriod: raw.accrualRatePerPeriod || undefined,
    maxBalanceDays: raw.maxBalanceDays || undefined,
    carryoverMaxDays: raw.carryoverMaxDays || undefined,
    carryoverExpiryMonths: raw.carryoverExpiryMonths || undefined,
    minServiceDaysToAccrue: raw.minServiceDaysToAccrue || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("policy_leave_types").insert({
    policy_version_id: d.policyVersionId,
    leave_type_code: d.leaveTypeCode,
    name: d.name,
    accrual_method: d.accrualMethod,
    accrual_rate_per_period: d.accrualRatePerPeriod ?? null,
    max_balance_days: d.maxBalanceDays ?? null,
    carryover_max_days: d.carryoverMaxDays ?? null,
    carryover_expiry_months: d.carryoverExpiryMonths ?? null,
    min_service_days_to_accrue: d.minServiceDaysToAccrue ?? null,
    approval_levels_required: d.approvalLevelsRequired,
  });

  if (error) return { error: error.message };

  revalidatePath(`/policies/${d.policyVersionId}`);
  return { error: null };
}

const addHolidaySchema = z.object({
  countryCode: z.string().length(2),
  holidayDate: z.string().min(1),
  name: z.string().min(1),
});

export async function addHoliday(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addHolidaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("public_holidays").insert({
    country_code: parsed.data.countryCode,
    holiday_date: parsed.data.holidayDate,
    name: parsed.data.name,
  });

  if (error) return { error: error.message };

  revalidatePath("/holidays");
  return { error: null };
}

export async function deleteHoliday(holidayId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("public_holidays").delete().eq("id", holidayId);
  revalidatePath("/holidays");
  return { error: error?.message ?? null };
}

export interface Phase2bDraftResult {
  countryCode: string;
  policyType: string;
  versionNo: number | null;
  action: string;
}

/**
 * Thin relay to seed_phase2b_policy_drafts() (see supabase/migrations/
 * 20261103000000_phase2b_v2_policy_drafts.sql) — the actor is auth.uid(),
 * resolved server-side from THIS signed-in session's own Supabase client,
 * never a token or id passed from the browser. Authorization (real
 * company-unscoped HR Admin, per country) and the "never touch v1, never
 * duplicate v2" idempotency are both enforced inside that SECURITY DEFINER
 * function itself — this action is not the security boundary, just the
 * one authenticated path to it (the function refuses outright if called
 * with no session, e.g. from the Supabase SQL Editor).
 */
export async function createPhase2bPolicyDrafts(): Promise<{ error: string | null; results: Phase2bDraftResult[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seed_phase2b_policy_drafts");
  revalidatePath("/policies");
  if (error) return { error: error.message, results: [] };
  const results = (data ?? []).map((r) => ({ countryCode: r.country_code, policyType: r.policy_type, versionNo: r.version_no, action: r.action }));
  return { error: null, results };
}
