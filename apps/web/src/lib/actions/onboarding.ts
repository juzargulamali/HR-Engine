"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEditEmployeeCore, evaluateGrant, hasRole, isSysAdmin, type AccessModule } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { sendInvitation } from "@/lib/auth/invite-email";
import { friendlyBudgetError } from "@/lib/budget/errors";
import { friendlyCrmError } from "@/lib/crm/errors";
import { friendlyInventoryError } from "@/lib/inventory/action-utils";
import { friendlyProjectError } from "@/lib/projects/errors";
import { ownModuleGrants } from "@/lib/people-access/data";
import { EMPTY_PLAN, normalisePlan, planSchema, type AccessSnapshot, type OnboardingPlan } from "@/lib/hr/onboarding";
import type { ActionState } from "./companies";

/**
 * The guided onboarding's three actions. None of them widens anyone's authority: saving a plan is what an HR Admin of the company (or an unrestricted System Administrator) may already do to the employee's record;
 * the invitation is the System Administrator's existing Admin-API call; roles go through the same user_roles insert a System Administrator already makes (the database policy decides); module rights go through each
 * module's own grant function (founders and access managers only; the function decides). The company, the account and the employee always come from the database, never from the browser.
 * Retries are safe by construction: the plan is one row per employee; the invitation looks for an existing account first; every role and right is checked against what is already held and skipped when it is.
 */

const uuid = z.string().uuid();
const GRANT_RPC = { sales: "crm_grant_access", projects: "proj_grant_access", inventory: "inv_grant_access", budget: "pbx_grant_access" } as const;
const friendly: Record<AccessModule, (m: string) => string> = { sales: friendlyCrmError, projects: friendlyProjectError, inventory: friendlyInventoryError, budget: (m) => friendlyBudgetError(m) };

export interface ApplyResult { key: string; label: string; outcome: "applied" | "already" | "blocked" | "failed"; message: string }
export interface OnboardingActionState extends ActionState { notice?: string; results?: ApplyResult[] }

async function context(employeeId: string) {
  const parsed = uuid.safeParse(employeeId);
  if (!parsed.success) return { ok: false, error: "That employee could not be identified. Reload the page and try again." } as const;
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "Sign in again to continue." } as const;
  const supabase = await createClient();
  const { data: employee } = await supabase.from("employees").select("id, company_id, first_name, last_name, user_id, employment_status, deleted_at").eq("id", parsed.data).maybeSingle();
  if (!employee) return { ok: false, error: "Employee not found." } as const;
  const sysAdmin = isSysAdmin(session.grants);
  const hrHere = canEditEmployeeCore(session.grants, employee.company_id);
  if (!hrHere && !sysAdmin) return { ok: false, error: "Only an HR Admin of this employee's company or a System Administrator can work on onboarding." } as const;
  if (employee.deleted_at || employee.employment_status === "terminated") return { ok: false, error: "This record is not active, so there is nothing to onboard." } as const;
  return { ok: true, session, supabase, employee, sysAdmin, hrHere } as const;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Save what is intended: the invitation address, the HR roles and the module rights. It grants nothing. Saving changes the plan, so an earlier review no longer counts. */
export async function saveOnboardingPlan(_prev: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> {
  const ctx = await context(String(formData.get("employeeId") ?? ""));
  if (!ctx.ok) return { error: ctx.error };
  let raw: unknown;
  try { raw = JSON.parse(String(formData.get("plan") ?? "")); } catch { return { error: "The plan could not be read. Reload the page and try again." }; }
  const email = String((raw as { inviteEmail?: unknown })?.inviteEmail ?? "").trim();
  const parsed = planSchema.safeParse({ ...(raw as object), inviteEmail: email === "" ? null : email });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the plan and try again." };
  const plan = normalisePlan(parsed.data);

  // A role or right can be planned only for a company the person planning administers (the employee's own company, or one they run HR for; a System Administrator any).
  const companies = new Set([...plan.hrRoles.map((r) => r.companyId), ...plan.modules.map((m) => m.companyId)]);
  for (const c of companies) {
    if (c !== ctx.employee.company_id && !ctx.sysAdmin && !hasRole(ctx.session.grants, "hr_admin", { companyId: c })) return { error: "You can plan access only for companies you run HR for." };
  }
  for (const m of plan.modules) {
    if (m.module === "budget" && m.capabilities.length === 0) return { error: "Budget access needs at least one right. Choose a right or remove the Budget line." };
  }

  const now = new Date().toISOString();
  const row = { invite_email: plan.inviteEmail, hr_roles: plan.hrRoles, module_grants: plan.modules.map((m) => ({ ...m })), updated_by: ctx.session.userId, updated_at: now, reviewed_by: null, reviewed_at: null };
  const { data: existing, error: readError } = await ctx.supabase.from("employee_onboarding_plans").select("employee_id").eq("employee_id", ctx.employee.id).maybeSingle();
  if (readError) return { error: "The plan could not be saved. Nothing was changed. Try again." };
  const write = existing
    ? await ctx.supabase.from("employee_onboarding_plans").update(row).eq("employee_id", ctx.employee.id)
    : await ctx.supabase.from("employee_onboarding_plans").insert({ employee_id: ctx.employee.id, company_id: ctx.employee.company_id, prepared_by: ctx.session.userId, ...row });
  if (write.error) {
    if (write.error.code === "23505") {
      // Two saves raced for the first row: the other one made it; this one updates it.
      const again = await ctx.supabase.from("employee_onboarding_plans").update(row).eq("employee_id", ctx.employee.id);
      if (again.error) return { error: "The plan could not be saved. Nothing was changed. Try again." };
    } else return { error: "The plan could not be saved. Nothing was changed. Try again." };
  }
  revalidatePath(`/employees/${ctx.employee.id}/onboarding`);
  return { error: null, notice: "Plan saved. Review it below, then apply what you are allowed to apply." };
}

/** Invite the planned address and link the account to THIS employee, reusing an account that already exists; a retry never sends a second invitation. */
export async function inviteAndLinkEmployee(_prev: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> {
  const ctx = await context(String(formData.get("employeeId") ?? ""));
  if (!ctx.ok) return { error: ctx.error };
  if (ctx.employee.user_id) return { error: null, notice: "This employee already has a linked account. Nothing was sent." };

  const { data: planRow } = await ctx.supabase.from("employee_onboarding_plans").select("invite_email").eq("employee_id", ctx.employee.id).maybeSingle();
  const email = (planRow?.invite_email ?? "").trim().toLowerCase();
  if (!email) return { error: "Add the work email address to the plan first." };

  const findAccount = async () => (await ctx.supabase.from("profiles").select("id").ilike("email", escapeLike(email)).maybeSingle()).data;
  let profile = await findAccount();
  let invited = false;
  if (!profile) {
    if (!ctx.sysAdmin) return { error: `${email} has no account yet. Only a System Administrator can send the invitation. The address stays in the plan.` };
    const sent = await sendInvitation(email, `${ctx.employee.first_name} ${ctx.employee.last_name}`.trim());
    if (sent.error) return { error: `The invitation could not be sent: ${sent.error}` };
    invited = !sent.alreadyRegistered;
    profile = await findAccount();
    if (!profile) return { error: null, notice: "The invitation was sent. Reload in a moment: once the account appears, an HR Admin of this company links it." };
  }
  if (!ctx.hrHere) return { error: null, notice: invited ? "The invitation was sent. An HR Admin of this company links the new account." : "That account exists. An HR Admin of this company links it." };

  const { error } = await ctx.supabase.from("employees").update({ user_id: profile.id }).eq("id", ctx.employee.id).is("user_id", null);
  if (error) return { error: error.message.includes("employees_user_id_unique") ? "That account is already linked to a different employee record." : "The account could not be linked. Try again." };
  revalidatePath(`/employees/${ctx.employee.id}/onboarding`);
  revalidatePath("/people-access");
  return { error: null, notice: invited ? `Invitation sent to ${email} and linked to ${ctx.employee.first_name}.` : `The existing account for ${email} is now linked. No second invitation was sent.` };
}

/** Apply the saved plan: every role and right the viewer is allowed to apply and that is not already in place. What is not theirs is reported with who can do it; nothing is removed. */
export async function applyOnboardingAccess(_prev: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> {
  const ctx = await context(String(formData.get("employeeId") ?? ""));
  if (!ctx.ok) return { error: ctx.error };
  if (formData.get("confirmReviewed") !== "on") return { error: "Tick the box to confirm you have reviewed the list above." };
  const userId = ctx.employee.user_id;
  if (!userId) return { error: "Link the employee's account first. Roles and rights belong to the account." };

  const { data: planRow } = await ctx.supabase.from("employee_onboarding_plans").select("invite_email, hr_roles, module_grants").eq("employee_id", ctx.employee.id).maybeSingle();
  const parsed = planRow ? planSchema.safeParse({ inviteEmail: planRow.invite_email, hrRoles: planRow.hr_roles, modules: planRow.module_grants }) : null;
  const plan: OnboardingPlan = parsed?.success ? normalisePlan(parsed.data) : EMPTY_PLAN;
  if (plan.hrRoles.length === 0 && plan.modules.length === 0) return { error: "There is nothing in the plan to apply." };

  const snap = await ctx.supabase.rpc("onboarding_access_snapshot", { p_employee_id: ctx.employee.id });
  if (snap.error || !snap.data) return { error: "What this person already holds could not be read, so nothing was applied. Try again." };
  const held = snap.data as unknown as AccessSnapshot;
  const { data: companyRows } = await ctx.supabase.from("companies").select("id, legal_name");
  const names = new Map((companyRows ?? []).map((c) => [c.id, c.legal_name]));
  const name = (id: string) => names.get(id) ?? "the company";
  const results: ApplyResult[] = [];

  for (const r of plan.hrRoles) {
    const key = `role:${r.role}:${r.companyId}`;
    const label = `${r.role.replace(/_/g, " ")} for ${name(r.companyId)}`;
    if (held.roles.some((x) => x.role === r.role && (x.companyId === r.companyId || x.companyId === null))) { results.push({ key, label, outcome: "already", message: "Already in place." }); continue; }
    if (!ctx.sysAdmin) { results.push({ key, label, outcome: "blocked", message: "Only an unrestricted System Administrator can assign HR roles." }); continue; }
    // Re-check just before writing: the unique key treats a missing country as different, so a double apply would otherwise add a second identical row.
    const { data: now } = await ctx.supabase.from("user_roles").select("id").eq("user_id", userId).eq("role", r.role).eq("company_id", r.companyId).is("revoked_at", null).limit(1);
    if (now && now.length > 0) { results.push({ key, label, outcome: "already", message: "Already in place." }); continue; }
    const { error } = await ctx.supabase.from("user_roles").insert({ user_id: userId, role: r.role, company_id: r.companyId });
    results.push(error ? { key, label, outcome: "failed", message: /row-level security/.test(error.message) ? "The database refused: assigning HR roles needs an unrestricted System Administrator grant." : "It could not be applied. Try again." } : { key, label, outcome: "applied", message: "Applied." });
  }

  const own = await ownModuleGrants(ctx.supabase, ctx.session.userId);
  for (const m of plan.modules) {
    const key = `module:${m.module}:${m.companyId}`;
    const label = `${m.module} for ${name(m.companyId)}`;
    const current = held.modules.find((g) => g.module === m.module && g.companyId === m.companyId);
    const heldCaps = current ? [...current.capabilities].sort() : [];
    if (current && m.capabilities.every((c) => heldCaps.includes(c))) { results.push({ key, label, outcome: "already", message: "Already in place." }); continue; }
    const viewer = own.find((g) => g.module === m.module && g.companyId === m.companyId);
    const desired = [...new Set([...heldCaps, ...m.capabilities])];
    const verdict = viewer ? evaluateGrant(m.module, viewer.capabilities, { capabilities: heldCaps, self: false }, desired) : { allowed: false, reason: "You do not manage this access." };
    if (!verdict.allowed) { results.push({ key, label, outcome: "blocked", message: `${verdict.reason ?? "You cannot apply this."} A founder or access manager for this module and company can.` }); continue; }
    const { error } = await ctx.supabase.rpc(GRANT_RPC[m.module], { p_user_id: userId, p_company_id: m.companyId, p_capabilities: desired, p_note: m.note ?? "Onboarding" });
    results.push(error ? { key, label, outcome: "failed", message: friendly[m.module](error.message) } : { key, label, outcome: "applied", message: "Applied." });
  }

  await ctx.supabase.from("employee_onboarding_plans").update({ reviewed_by: ctx.session.userId, reviewed_at: new Date().toISOString() }).eq("employee_id", ctx.employee.id);
  revalidatePath(`/employees/${ctx.employee.id}/onboarding`);
  revalidatePath("/people-access");
  const applied = results.filter((r) => r.outcome === "applied").length;
  const left = results.filter((r) => r.outcome === "blocked" || r.outcome === "failed").length;
  return { error: null, notice: `${applied} applied${left ? `, ${left} still to be done by someone else or to retry` : ""}.`, results };
}
