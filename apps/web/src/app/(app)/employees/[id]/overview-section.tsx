import type { ComponentProps } from "react";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { EditEmployeeForm } from "./edit-employee-form";

// Reuses EditEmployeeForm's own prop type (rather than redeclaring it) so
// employment_status's literal union stays in sync automatically, plus the
// two extra fields (company_id, user_id) this component itself needs that
// EditEmployeeForm doesn't.
type OverviewEmployee = ComponentProps<typeof EditEmployeeForm>["employee"] & {
  company_id: string;
  user_id: string | null;
};

/**
 * The one always-visible tab: the same core-fields edit form every viewer
 * already saw at the top of the old single-page layout, plus a short,
 * cheap "outstanding" callout computed from data already on hand — not a
 * second copy of any other tab's content. The linked-login lookup and the
 * managers list only ever mattered here, so both are fetched lazily in this
 * component now instead of unconditionally on every page load.
 */
export async function OverviewSection({
  employee,
  canEditCore,
  isSelf,
}: {
  employee: OverviewEmployee;
  canEditCore: boolean;
  isSelf: boolean;
}) {
  const supabase = await createClient();
  const [{ data: linkedProfile }, { data: managers }, { data: managerName }, { data: hrAdminCandidates }] = await Promise.all([
    employee.user_id
      ? supabase.from("profiles").select("email").eq("id", employee.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("employees").select("id, first_name, last_name").eq("company_id", employee.company_id).is("deleted_at", null),
    // The `managers` list above is RLS-scoped to the CURRENT VIEWER (self,
    // rows they manage, or hr_admin/sys_admin/finance/ceo/cto) — it never
    // includes the viewer's OWN manager's row, so `managers.find(m => m.id
    // === employee.manager_id)` can never resolve a name for a plain
    // viewer even when manager_id is set and correct (confirmed live on
    // the Employee E2E test account's own profile). get_employee_manager_name
    // is a narrowly-scoped RPC that resolves just this one name, gated by
    // the same visibility rule employees_select already applies — see its
    // migration/schema.sql doc comment.
    employee.manager_id ? supabase.rpc("get_employee_manager_name", { p_employee_id: employee.id }) : Promise.resolve({ data: null }),
    // HR Owner candidates (Recovery Leave routing — see schema.sql's
    // list_active_hr_admins). Only ever needed when this HR-Admin-only
    // section is even rendering (canEditCore below), same lazy-load
    // rationale as the managers list above. user_roles has no SELECT
    // policy that would let a plain query filter "who holds hr_admin" —
    // this definer RPC is the only way to list valid candidates.
    canEditCore
      ? supabase.rpc("list_active_hr_admins", { p_company_id: employee.company_id })
      : Promise.resolve({ data: [] as { employee_id: string; first_name: string; last_name: string }[] }),
  ]);

  const outstanding: string[] = [];
  if (!employee.job_title) outstanding.push("No job title set.");
  if (!employee.manager_id && employee.employment_status === "active") outstanding.push("No manager assigned.");
  if (!employee.hr_owner_id && employee.employment_status === "active") outstanding.push("No HR owner assigned.");

  // hrAdminCandidates only ever lists CURRENTLY active hr_admin holders — if
  // this employee's existing hr_owner_id has since had that role revoked,
  // it won't be in that list, but the <select> must still show who it
  // currently is (defaultValue) rather than silently falling back to
  // whichever option happens to render first. managers is already a full
  // company-employee read (HR Admin's own employees_select scope, same
  // query this section already makes), so it's a safe, no-extra-query
  // source for just that display name.
  const hrOwners = (hrAdminCandidates ?? []).map((c) => ({ id: c.employee_id, first_name: c.first_name, last_name: c.last_name }));
  if (employee.hr_owner_id && !hrOwners.some((o) => o.id === employee.hr_owner_id)) {
    const current = (managers ?? []).find((m) => m.id === employee.hr_owner_id);
    if (current) hrOwners.push({ ...current, last_name: `${current.last_name} (role no longer active)` });
  }

  return (
    <div className="space-y-4">
      {outstanding.length > 0 ? (
        <Alert variant="warning">{outstanding.join(" ")}</Alert>
      ) : null}
      <EditEmployeeForm
        employee={employee}
        linkedEmail={linkedProfile?.email ?? null}
        managers={(managers ?? []).filter((m) => m.id !== employee.id)}
        managerName={managerName ?? null}
        hrOwners={hrOwners}
        canEditCore={canEditCore}
        isSelf={isSelf}
      />
    </div>
  );
}
