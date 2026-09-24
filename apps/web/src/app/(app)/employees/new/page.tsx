import { hasRoleAnyScope } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { NewEmployeeForm } from "./new-employee-form";

export default async function NewEmployeePage() {
  const session = await getCurrentSession();
  // hasRoleAnyScope, not a bare isHrAdmin(grants) — hr_admin is always
  // company-scoped (a real grant's companyId is never null), so an unscoped
  // isHrAdmin() check can never match a real HR Admin at all. The company
  // this employee is created in is picked inside the form itself (below),
  // so there's no single companyId to check here yet either way — the real
  // per-company authorization is canCreateEmployee()/RLS at submission time.
  if (!session || !hasRoleAnyScope(session.grants, "hr_admin")) {
    return <Alert variant="destructive">You need the HR Admin role to add an employee.</Alert>;
  }

  const supabase = await createClient();
  const [{ data: companies }, { data: countries }] = await Promise.all([
    supabase.from("companies").select("id, legal_name, country_code, default_currency").order("legal_name"),
    supabase.from("countries").select("code, name").order("name"),
  ]);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>New employee</CardTitle>
      </CardHeader>
      <CardContent>
        <NewEmployeeForm companies={companies ?? []} countries={countries ?? []} />
      </CardContent>
    </Card>
  );
}
