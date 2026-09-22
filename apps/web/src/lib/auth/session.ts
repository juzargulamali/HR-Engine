import { cache } from "react";
import type { RoleGrant } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";

export interface CurrentSession {
  userId: string;
  email: string | null;
  fullName: string | null;
  grants: RoleGrant[];
  employeeId: string | null;
}

/**
 * The one place that turns a Supabase session into the shape the rest of
 * the app (and @enginious-hr/domain's permission checks) works with.
 * `cache()` de-dupes this within a single request — several Server
 * Components on one page can call it without re-querying.
 */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [{ data: profile }, { data: roleRows }, { data: employee }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role, company_id, country_code").eq("user_id", user.id).is("revoked_at", null),
    supabase.from("employees").select("id").eq("user_id", user.id).is("deleted_at", null).maybeSingle(),
  ]);

  const grants: RoleGrant[] = (roleRows ?? []).map((row) => ({
    role: row.role,
    companyId: row.company_id,
    countryCode: row.country_code,
  }));

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? null,
    grants,
    employeeId: employee?.id ?? null,
  };
});
