import { z } from "zod";
import {
  ACCESS_MODULES, ACCESS_MODULE_LABELS, ROLES, ROLE_LABELS, canEditEmployeeCore, evaluateGrant, isSysAdmin, capabilitiesOf,
  type AccessModule, type AppRole, type ModuleGrantRef, type RoleGrant,
} from "@enginious-hr/domain";
import { remainingSteps, type SetupStep } from "./setup";

/**
 * One guided, resumable onboarding: Add employee -> complete profile -> invite -> HR roles -> module access -> review. The SAME employee, company and account run through every step.
 * Nothing about "what is done" is stored: it is derived from the real records (the employee, the linked login, user_roles, the module grants) so a retry, another device or another person sees the same
 * answer and nothing is applied twice. What IS stored is the PLAN (employee_onboarding_plans): the invitation address, the HR roles and the module rights somebody intends, so whoever can finish the next step sees
 * exactly what to apply. A plan grants nothing: each item is applied by a person who is allowed to, through the existing route (an HR Admin of the employee's company for the Employee and Reporting Manager roles; an unrestricted System Administrator for any other role; each module's own grant function).
 *
 * Pure functions: the loader passes in what the viewer may read; the screen renders the result.
 */

export type OnboardingStepKey = "employee" | "profile" | "account" | "roles" | "modules" | "review";
/** done: finished. ready: the viewer can do it now. blocked: someone else must do it (who is named). waiting: an earlier step must finish first. optional: nothing chosen, nothing needed. */
export type OnboardingStatus = "done" | "ready" | "blocked" | "waiting" | "optional";

export const PRIVILEGED_ROLES: readonly AppRole[] = ["hr_admin", "finance", "ceo", "cto", "sys_admin"];
/** The only roles an HR Admin of a company may give, and only for that company, to the login linked to one of its employees (the database policy user_roles_insert_hr_admin_employee says the same). Every other role is privileged. */
export const HR_ADMIN_ASSIGNABLE_ROLES: readonly AppRole[] = ["employee", "line_manager"];

const uuid = z.string().uuid();
export const planSchema = z.object({
  inviteEmail: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200).nullable(),
  hrRoles: z.array(z.object({ role: z.enum(ROLES), companyId: uuid })).max(40),
  modules: z.array(z.object({
    module: z.enum(ACCESS_MODULES),
    companyId: uuid,
    capabilities: z.array(z.string().max(60)).max(40),
    note: z.string().trim().max(200).nullable().optional(),
  })).max(40),
});
export type OnboardingPlan = z.infer<typeof planSchema>;
export const EMPTY_PLAN: OnboardingPlan = { inviteEmail: null, hrRoles: [], modules: [] };

/** One entry per role+company and per module+company, capabilities de-duplicated and limited to the module's own vocabulary, in a stable order. */
export function normalisePlan(plan: OnboardingPlan): OnboardingPlan {
  const roles = new Map<string, OnboardingPlan["hrRoles"][number]>();
  for (const r of plan.hrRoles) roles.set(`${r.role}:${r.companyId}`, r);
  const mods = new Map<string, OnboardingPlan["modules"][number]>();
  for (const m of plan.modules) {
    const vocab = new Set(capabilitiesOf(m.module));
    const caps = [...new Set(m.capabilities.filter((c) => vocab.has(c)))].sort();
    mods.set(`${m.module}:${m.companyId}`, { module: m.module, companyId: m.companyId, capabilities: caps, note: m.note?.trim() ? m.note.trim() : null });
  }
  return {
    inviteEmail: plan.inviteEmail,
    hrRoles: [...roles.values()].sort((a, b) => a.companyId.localeCompare(b.companyId) || a.role.localeCompare(b.role)),
    modules: [...mods.values()].sort((a, b) => a.module.localeCompare(b.module) || a.companyId.localeCompare(b.companyId)),
  };
}

export interface AccessSnapshot {
  account: { status: "invited" | "active" | "deactivated"; active: boolean; email: string | null } | null;
  roles: { role: AppRole; companyId: string | null }[];
  modules: { module: AccessModule; companyId: string; capabilities: string[] }[];
}

export interface OnboardingInput {
  employee: { id: string; companyId: string; fullName: string; removed: boolean; terminated: boolean; linkedUserId: string | null };
  companyNames: ReadonlyMap<string, string>;
  /** The profile's own setup steps (contract, pay, documents, opening balances, account), or null when the viewer cannot see them. */
  setup: readonly SetupStep[] | null;
  plan: OnboardingPlan | null;
  /** What the employee's account, roles and rights are now, as far as the viewer may see; null when it could not be read. */
  snapshot: AccessSnapshot | null;
  /** Whether a login already exists for the planned email address (null: not known). */
  accountExistsForEmail: boolean | null;
  viewer: { grants: readonly RoleGrant[]; moduleGrants: readonly ModuleGrantRef[] };
}

export interface RoleItemState {
  key: string; role: AppRole; companyId: string; companyName: string; label: string;
  applied: boolean; privileged: boolean; canApply: boolean; who: string;
}
export interface ModuleItemState {
  key: string; module: AccessModule; companyId: string; companyName: string; label: string;
  capabilities: string[]; held: string[]; missing: string[]; applied: boolean; canApply: boolean; reason: string | null; who: string; note: string | null;
}
export interface OnboardingStep {
  key: OnboardingStepKey; label: string; status: OnboardingStatus;
  /** One readable sentence about where this step stands. */
  detail: string;
  /** Who can finish it, in words, and whether that is the viewer. */
  who: string; viewerCan: boolean;
  nextAction: string | null;
}
export interface OnboardingModel {
  steps: OnboardingStep[];
  roles: RoleItemState[];
  modules: ModuleItemState[];
  progress: { done: number; total: number };
  next: OnboardingStep | null;
  /** The viewer can apply at least one pending item now. */
  canApplyAny: boolean;
  planned: boolean;
}

const SYS = "A System Administrator (an unrestricted one: a System Administrator grant limited to one company is not enough)";
const hrWho = (company: string) => `An HR Admin of ${company}`;
const INVITE_WHO = "An HR Admin of the employee's company, or a System Administrator";

const moduleWho = (module: AccessModule, company: string) => `A ${ACCESS_MODULE_LABELS[module]} founder or access manager for ${company}`;

export function buildOnboarding(i: OnboardingInput): OnboardingModel {
  const plan = normalisePlan(i.plan ?? EMPTY_PLAN);
  const companyName = (id: string) => i.companyNames.get(id) ?? "this company";
  const sysAdmin = isSysAdmin(i.viewer.grants);
  const hrHere = canEditEmployeeCore(i.viewer.grants, i.employee.companyId);
  const hasUser = !!i.employee.linkedUserId;
  const inactive = i.employee.removed || i.employee.terminated;

  // ---- HR roles: Employee and Reporting Manager by an HR Admin of the employee's own company; every other role by an unrestricted System Administrator -----------------
  const heldRole = (role: AppRole, companyId: string) => !!i.snapshot?.roles.some((r) => r.role === role && (r.companyId === companyId || r.companyId === null));
  const roles: RoleItemState[] = plan.hrRoles.map((r) => {
    const delegable = HR_ADMIN_ASSIGNABLE_ROLES.includes(r.role) && r.companyId === i.employee.companyId;
    return {
      key: `${r.role}:${r.companyId}`, role: r.role, companyId: r.companyId, companyName: companyName(r.companyId), label: `${ROLE_LABELS[r.role]} for ${companyName(r.companyId)}`,
      applied: heldRole(r.role, r.companyId), privileged: PRIVILEGED_ROLES.includes(r.role), canApply: sysAdmin || (delegable && hrHere), who: delegable ? hrWho(companyName(r.companyId)) : SYS,
    };
  });

  // ---- Module rights (applied through each module's own grant function; founders and access managers only) -------------------------------------------------------
  const modules: ModuleItemState[] = plan.modules.map((m) => {
    const current = i.snapshot?.modules.find((g) => g.module === m.module && g.companyId === m.companyId) ?? null;
    const held = current ? [...current.capabilities].sort() : [];
    const missing = m.capabilities.filter((c) => !held.includes(c));
    const applied = current !== null && missing.length === 0;
    const viewerGrant = i.viewer.moduleGrants.find((g) => g.module === m.module && g.companyId === m.companyId);
    // Onboarding only ever ADDS rights (the union of what is held and what is planned), so applying never removes anything the person already has.
    const desired = [...new Set([...held, ...m.capabilities])];
    const verdict = viewerGrant ? evaluateGrant(m.module, viewerGrant.capabilities, { capabilities: held, self: false }, desired) : { allowed: false, reason: "You do not manage this access." };
    return {
      key: `${m.module}:${m.companyId}`, module: m.module, companyId: m.companyId, companyName: companyName(m.companyId),
      label: `${ACCESS_MODULE_LABELS[m.module]} for ${companyName(m.companyId)}`, capabilities: m.capabilities, held, missing, applied,
      canApply: verdict.allowed, reason: verdict.allowed ? null : verdict.reason, who: moduleWho(m.module, companyName(m.companyId)), note: m.note ?? null,
    };
  });

  // ---- Steps ---------------------------------------------------------------------------------------------------------------------------------------------------
  const steps: OnboardingStep[] = [];
  steps.push({ key: "employee", label: "Add employee", status: "done", detail: `${i.employee.fullName} is on record for ${companyName(i.employee.companyId)}.`, who: "HR Admin of the company", viewerCan: hrHere, nextAction: null });

  const todo = i.setup ? remainingSteps(i.setup).filter((s) => s.key !== "account") : null;
  steps.push(todo === null
    ? { key: "profile", label: "Complete profile", status: inactive ? "optional" : "waiting", detail: inactive ? "Not applicable: this record is not active." : "The profile steps are visible to the company's HR Admin.", who: "HR Admin of the company", viewerCan: false, nextAction: null }
    : todo.length === 0
      ? { key: "profile", label: "Complete profile", status: "done", detail: "Contract, pay and documents are on record.", who: "HR Admin of the company", viewerCan: hrHere, nextAction: null }
      : { key: "profile", label: "Complete profile", status: hrHere ? "ready" : "blocked", detail: `${todo.length === 1 ? "1 profile step" : `${todo.length} profile steps`} left: ${todo.map((s) => s.label.toLowerCase()).join(", ")}.`, who: "HR Admin of the company", viewerCan: hrHere, nextAction: todo[0]?.actionLabel ?? "Open the profile" });

  const email = plan.inviteEmail;
  const accountStatus = i.snapshot?.account?.status ?? null;
  if (inactive) {
    steps.push({ key: "account", label: "Invite", status: "optional", detail: "Not applicable: this record is not active.", who: "-", viewerCan: false, nextAction: null });
  } else if (hasUser && accountStatus === "deactivated") {
    steps.push({ key: "account", label: "Invite", status: "blocked", detail: "The linked account is deactivated, so the person cannot sign in. Reactivating it is a System Administrator's decision.", who: SYS, viewerCan: sysAdmin, nextAction: "Reactivate in People & Access" });
  } else if (hasUser) {
    steps.push({ key: "account", label: "Invite", status: "done", detail: accountStatus === "invited" ? "Invited and linked. They have not set a password yet." : "A login is linked, so this person sees their own profile, leave and approvals.", who: INVITE_WHO, viewerCan: hrHere || sysAdmin, nextAction: null });
  } else if (!email) {
    steps.push({ key: "account", label: "Invite", status: "waiting", detail: "Enter the work email address in the plan. The same address is used to find an existing account or to send the invitation.", who: INVITE_WHO, viewerCan: hrHere || sysAdmin, nextAction: "Add the email address" });
  } else if (i.accountExistsForEmail) {
    steps.push({ key: "account", label: "Invite", status: hrHere ? "ready" : "blocked", detail: `${email} already has an account: it is linked to this employee, and no second invitation is sent.${hrHere ? "" : " Linking is done by an HR Admin of this company."}`, who: "HR Admin of the company", viewerCan: hrHere, nextAction: "Link the account" });
  } else if (hrHere || sysAdmin) {
    steps.push({ key: "account", label: "Invite", status: "ready", detail: `Send the invitation to ${email}${hrHere ? " and link the new account to this employee" : "; an HR Admin of this company then links the new account"}.`, who: INVITE_WHO, viewerCan: true, nextAction: hrHere ? "Invite and link" : "Send the invitation" });
  } else {
    steps.push({ key: "account", label: "Invite", status: "blocked", detail: `${email} has no account yet. Only an HR Admin of this company or a System Administrator can send the invitation; the address stays in the plan so nothing has to be retyped.`, who: INVITE_WHO, viewerCan: false, nextAction: null });
  }
  const accountDone = steps[steps.length - 1]!.status === "done";

  const rolesStep = (): OnboardingStep => {
    const rolesWho = (items: readonly RoleItemState[]) => [...new Set(items.map((r) => r.who))].join("; ") || "-";
    if (roles.length === 0) return { key: "roles", label: "HR roles", status: "optional", detail: "No HR role chosen yet. Choose the roles this person needs (for example Employee or Reporting Manager).", who: INVITE_WHO, viewerCan: hrHere || sysAdmin, nextAction: "Choose HR roles" };
    const pending = roles.filter((r) => !r.applied);
    if (pending.length === 0) return { key: "roles", label: "HR roles", status: "done", detail: `${roles.length === 1 ? "The chosen role is" : `All ${roles.length} chosen roles are`} in place.`, who: rolesWho(roles), viewerCan: roles.some((r) => r.canApply), nextAction: null };
    if (!accountDone) return { key: "roles", label: "HR roles", status: "waiting", detail: `${pending.length === 1 ? "1 role" : `${pending.length} roles`} chosen; they can be applied once the account is linked.`, who: rolesWho(pending), viewerCan: pending.some((r) => r.canApply), nextAction: null };
    const mine = pending.filter((r) => r.canApply);
    const others = pending.filter((r) => !r.canApply);
    return mine.length > 0
      ? { key: "roles", label: "HR roles", status: "ready", detail: `${mine.length} of ${pending.length} waiting role${pending.length === 1 ? "" : "s"} you can apply${others.length ? `; the rest need: ${rolesWho(others)}` : ""}.`, who: others.length ? rolesWho(others) : "You", viewerCan: true, nextAction: "Review and apply" }
      : { key: "roles", label: "HR roles", status: "blocked", detail: `${pending.length === 1 ? "1 role is" : `${pending.length} roles are`} waiting. ${rolesWho(pending)} must apply ${pending.length === 1 ? "it" : "them"}: only a System Administrator can give HR Admin, Finance, CEO, CTO or System Administrator, and only an HR Admin of the employee's own company can give Employee or Reporting Manager.`, who: rolesWho(pending), viewerCan: false, nextAction: null };
  };
  steps.push(rolesStep());

  const modulesStep = (): OnboardingStep => {
    if (modules.length === 0) return { key: "modules", label: "Module access", status: "optional", detail: "No module access chosen yet (Sales, Projects, Inventory, Budget).", who: "A founder or access manager of each module", viewerCan: hrHere || sysAdmin, nextAction: "Choose module access" };
    const pending = modules.filter((m) => !m.applied);
    if (pending.length === 0) return { key: "modules", label: "Module access", status: "done", detail: `All ${modules.length === 1 ? "1 chosen module right is" : `${modules.length} chosen module rights are`} in place.`, who: "A founder or access manager of each module", viewerCan: true, nextAction: null };
    const mine = pending.filter((m) => m.canApply);
    const who = [...new Set(pending.filter((m) => !m.canApply).map((m) => m.who))].join("; ") || "-";
    if (!accountDone) return { key: "modules", label: "Module access", status: "waiting", detail: `${pending.length} chosen; they can be applied once the account is linked.`, who: [...new Set(pending.map((m) => m.who))].join("; "), viewerCan: mine.length > 0, nextAction: null };
    return mine.length > 0
      ? { key: "modules", label: "Module access", status: "ready", detail: `${mine.length} of ${pending.length} waiting item${pending.length === 1 ? "" : "s"} you can apply${mine.length < pending.length ? `; the rest need: ${who}` : ""}.`, who: mine.length < pending.length ? who : "You", viewerCan: true, nextAction: "Review and apply" }
      : { key: "modules", label: "Module access", status: "blocked", detail: `${pending.length} waiting. ${who} must apply ${pending.length === 1 ? "it" : "them"}.`, who, viewerCan: false, nextAction: null };
  };
  steps.push(modulesStep());

  const pendingRoles = roles.filter((r) => !r.applied);
  const pendingMods = modules.filter((m) => !m.applied);
  const canApplyAny = accountDone && (pendingRoles.some((r) => r.canApply) || pendingMods.some((m) => m.canApply));
  const nothingPlanned = roles.length === 0 && modules.length === 0;
  steps.push(nothingPlanned
    ? { key: "review", label: "Review", status: "optional", detail: "Nothing to review: no HR role or module access is planned.", who: "HR Admin of the company", viewerCan: hrHere || sysAdmin, nextAction: null }
    : pendingRoles.length === 0 && pendingMods.length === 0
      ? { key: "review", label: "Review", status: "done", detail: "Everything planned is in place.", who: "-", viewerCan: false, nextAction: null }
      : { key: "review", label: "Review", status: canApplyAny ? "ready" : accountDone ? "blocked" : "waiting", detail: canApplyAny ? "Check the exact companies, HR roles and module rights below, then apply what you are allowed to apply." : accountDone ? "Nothing here is yours to apply. The list shows who can." : "The list can be applied once the account is linked.", who: canApplyAny ? "You" : "See each line", viewerCan: canApplyAny, nextAction: canApplyAny ? "Apply what I can" : null });

  const counted = steps.filter((s) => s.status !== "optional");
  const done = counted.filter((s) => s.status === "done").length;
  const next = steps.find((s) => s.status === "ready" || s.status === "blocked" || s.status === "waiting") ?? null;
  return { steps, roles, modules, progress: { done, total: counted.length }, next, canApplyAny, planned: !nothingPlanned };
}
