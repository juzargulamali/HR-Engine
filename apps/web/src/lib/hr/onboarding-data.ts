import "server-only";
import { canEditEmployeeCore, canManageUsers, canViewCompensation, canViewContracts, isSysAdmin, ACCESS_MODULES, type AccessModule, type AppRole, type RoleGrant } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ownModuleGrants } from "@/lib/people-access/data";
import { loadProfileSetup, type HrReadClient } from "./profile-data";
import { buildOnboarding, EMPTY_PLAN, planSchema, type AccessSnapshot, type OnboardingModel, type OnboardingPlan } from "./onboarding";

export interface OnboardingCompany { id: string; name: string }
export type OnboardingLoad =
  | { kind: "signed-out" }
  | { kind: "not-found" }
  | { kind: "denied" }
  | {
      kind: "ok";
      employee: { id: string; companyId: string; companyName: string; fullName: string; employeeNumber: string; jobTitle: string | null; removed: boolean; terminated: boolean; linkedUserId: string | null };
      model: OnboardingModel;
      plan: OnboardingPlan;
      planSaved: boolean;
      reviewedAt: string | null;
      /** Companies a role or module right can be planned for: every active company for a System Administrator, else the companies the viewer runs HR for. */
      companies: OnboardingCompany[];
      viewer: { isSysAdmin: boolean; hrHere: boolean };
      /** Parts that could not be read; the screen says so instead of showing them as "nothing". */
      failed: string[];
    };

const MODULES: readonly AccessModule[] = ACCESS_MODULES;

/**
 * Everything the guided onboarding screen needs, read through the signed-in viewer's own client (row level security decides what comes back). What "is done" comes from the real records; the plan
 * (what somebody intends) comes from employee_onboarding_plans. A read that fails is named, never turned into "nothing to do".
 */
export async function loadOnboarding(employeeId: string): Promise<OnboardingLoad> {
  const session = await getCurrentSession();
  if (!session) return { kind: "signed-out" };
  const supabase = await createClient();

  const { data: e } = await supabase
    .from("employees")
    .select("id, company_id, country_code, first_name, last_name, employee_number, job_title, manager_id, user_id, employment_status, deleted_at")
    .eq("id", employeeId)
    .maybeSingle();
  if (!e) return { kind: "not-found" };

  const sysAdmin = isSysAdmin(session.grants);
  const hrHere = canEditEmployeeCore(session.grants, e.company_id);
  if (!hrHere && !sysAdmin) return { kind: "denied" };

  const failed: string[] = [];
  const [companiesRes, planRes, snapshotRes, ownModules] = await Promise.all([
    supabase.from("companies").select("id, legal_name").eq("is_active", true).is("deleted_at", null).order("legal_name"),
    supabase.from("employee_onboarding_plans").select("invite_email, hr_roles, module_grants, reviewed_at").eq("employee_id", e.id).maybeSingle(),
    supabase.rpc("onboarding_access_snapshot", { p_employee_id: e.id }),
    ownModuleGrants(supabase, session.userId),
  ]);
  if (companiesRes.error) failed.push("companies");
  if (planRes.error) failed.push("the saved plan");
  if (snapshotRes.error) failed.push("the account and access now on record");

  const allCompanies: OnboardingCompany[] = (companiesRes.data ?? []).map((c) => ({ id: c.id, name: c.legal_name }));
  const hrCompanyIds = new Set(session.grants.filter((g: RoleGrant) => g.role === "hr_admin" && g.companyId).map((g) => g.companyId as string));
  const hrAll = session.grants.some((g: RoleGrant) => g.role === "hr_admin" && !g.companyId);
  const companies = sysAdmin || hrAll ? allCompanies : allCompanies.filter((c) => hrCompanyIds.has(c.id) || c.id === e.company_id);
  const names = new Map(allCompanies.map((c) => [c.id, c.name]));

  const parsed = planRes.data
    ? planSchema.safeParse({ inviteEmail: planRes.data.invite_email, hrRoles: planRes.data.hr_roles, modules: planRes.data.module_grants })
    : null;
  const plan: OnboardingPlan = parsed?.success ? parsed.data : EMPTY_PLAN;
  if (parsed && !parsed.success) failed.push("the saved plan (it could not be understood)");

  const raw = snapshotRes.error ? null : (snapshotRes.data as { account: AccessSnapshot["account"]; roles: { role: AppRole; companyId: string | null }[]; modules: { module: AccessModule; companyId: string; capabilities: string[] }[] } | null);
  const snapshot: AccessSnapshot | null = raw ? { account: raw.account, roles: raw.roles ?? [], modules: (raw.modules ?? []).filter((m) => MODULES.includes(m.module)) } : null;

  // Does a login already exist for the planned address? (Only worth asking while no login is linked.)
  let accountExistsForEmail: boolean | null = null;
  if (!e.user_id && plan.inviteEmail) {
    const { data: p, error } = await supabase.from("profiles").select("id").ilike("email", plan.inviteEmail).maybeSingle();
    accountExistsForEmail = error ? null : !!p;
  }

  const setup = hrHere
    ? (await loadProfileSetup(supabase as unknown as HrReadClient, {
        id: e.id, country_code: e.country_code, employment_status: e.employment_status, deleted_at: e.deleted_at, user_id: e.user_id, job_title: e.job_title, manager_id: e.manager_id,
      }, {
        canEditCore: true,
        canSeeContracts: canViewContracts(session.grants, e.company_id, { isSelf: false, isManager: false }),
        canSeeComp: canViewCompensation(session.grants, e.company_id, false),
        canSeeIdentity: true, canSeeDocuments: true, canSeeCareerEvents: true,
        canInvite: true, canOpenAccess: true,
      }, { managerNotExpected: true })).steps
    : null;

  const fullName = `${e.first_name} ${e.last_name}`.trim();
  const model = buildOnboarding({
    employee: { id: e.id, companyId: e.company_id, fullName, removed: e.deleted_at !== null, terminated: e.employment_status === "terminated", linkedUserId: e.user_id },
    companyNames: names, setup, plan, snapshot, accountExistsForEmail, viewer: { grants: session.grants, moduleGrants: ownModules },
  });
  return {
    kind: "ok",
    employee: { id: e.id, companyId: e.company_id, companyName: names.get(e.company_id) ?? "this company", fullName, employeeNumber: e.employee_number, jobTitle: e.job_title, removed: e.deleted_at !== null, terminated: e.employment_status === "terminated", linkedUserId: e.user_id },
    model, plan, planSaved: !!planRes.data, reviewedAt: planRes.data?.reviewed_at ?? null, companies, viewer: { isSysAdmin: sysAdmin, hrHere }, failed,
  };
}
