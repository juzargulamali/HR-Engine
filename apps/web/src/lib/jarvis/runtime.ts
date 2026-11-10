import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { registerAllJarvisActions } from "./actions";
import { createAssistant } from "./assistant";
import { readJarvisConfig } from "./config";
import { defaultNewId, type JarvisDeps } from "./dispatcher";
import { selectProvider } from "./provider";
import { hasSalesGrant, salesCompanies } from "./sales/grants";

/**
 * The production wiring: the signed-in person's own session (cookies -> Supabase anon client with their JWT; RLS applies), the environment configuration, and the module grant
 * checkers. There is no service-role client anywhere in JARVIS.
 */
export const defaultJarvisDeps: JarvisDeps = {
  config: () => readJarvisConfig(),
  provider: (c) => selectProvider(c),
  identity: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user ? { userId: user.id } : null;
  },
  supabase: async () => (await createClient()) as unknown as SupabaseClient,
  // One checker per module. Projects, Inventory and People & HR register theirs here when their actions are added (they are not part of JARVIS yet: no grant ever passes for them).
  moduleGrant: async ({ module, supabase, userId, companyId, capability }) => (module === "sales" ? hasSalesGrant(supabase, userId, companyId, capability) : false),
  companies: ({ supabase, userId }) => salesCompanies(supabase, userId),
  // The person's own HR roles and budget grant, through their own session: the same facts the navigation uses to offer Payroll, Employees and Project budgets.
  protectedAccess: async ({ supabase, userId, companyId }) => {
    const [roles, budget] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId).is("revoked_at", null),
      supabase.from("pbx_company_grants").select("company_id").eq("user_id", userId).eq("company_id", companyId).is("revoked_at", null),
    ]);
    if (roles.error || budget.error) return "error";
    return { roles: ((roles.data ?? []) as { role: string }[]).map((r) => r.role), budget: (budget.data ?? []).length > 0 };
  },
  now: () => new Date(),
  newId: defaultNewId,
};

export function getJarvis() {
  registerAllJarvisActions();
  return createAssistant(defaultJarvisDeps);
}
