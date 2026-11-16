import { canCreateEmployee, hasRoleAnyScope } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { LoadError } from "@/components/workspace/states";
import { NewEmployeeForm } from "./new-employee-form";
import { AccessNotice } from "@/components/os/access-notice";
import { PageHeader } from "@/components/projects/parts";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const session = await getCurrentSession();
  // hasRoleAnyScope, not a bare isHrAdmin(grants): hr_admin is always company-scoped (a real grant's companyId is never null), so an unscoped check can never match a
  // real HR Admin. The company is chosen inside the form, so there is no single company to check here yet; the per-company check is canCreateEmployee() and the
  // database's own policy when the form is sent.
  if (!session || !hasRoleAnyScope(session.grants, "hr_admin")) {
    return <AccessNotice title="Add employee">You need the HR Admin role to add an employee.</AccessNotice>;
  }

  const supabase = await createClient();
  const [companies, countries, departments, managers] = await Promise.all([
    supabase.from("companies").select("id, legal_name, country_code, default_currency").order("legal_name"),
    supabase.from("countries").select("code, name").order("name"),
    supabase.from("departments").select("id, company_id, name").is("deleted_at", null).order("name"),
    supabase.from("employees").select("id, company_id, first_name, last_name, employee_number").is("deleted_at", null).neq("employment_status", "terminated").order("first_name"),
  ]);
  // The company and country lists are what the form stands on; departments and managers are optional pickers, so a failed read of those only empties them.
  if (companies.error || countries.error) return <LoadError what="the companies" retryHref="/employees/new" />;

  // Only the companies this person may add employees to are offered, and only their departments and managers: a restricted HR Admin never sees another company in the picker.
  const allowed = (companies.data ?? []).filter((c) => canCreateEmployee(session.grants, c.id));
  const allowedIds = new Set(allowed.map((c) => c.id));
  if (allowed.length === 0) return <AccessNotice title="Add employee">You need the HR Admin role for a company to add an employee to it.</AccessNotice>;

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Add employee" description="Choose the company, enter who they are once, and open their profile. Contract, pay, documents and the account can be finished there." />
      <NewEmployeeForm companies={allowed} countries={countries.data ?? []} departments={(departments.data ?? []).filter((d) => allowedIds.has(d.company_id))} managers={(managers.data ?? []).filter((m) => allowedIds.has(m.company_id))} />
    </div>
  );
}
