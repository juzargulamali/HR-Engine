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
  const [{ data: linkedProfile }, { data: managers }, { data: managerName }] = await Promise.all([
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
  ]);

  // A CEO/CTO is top of the org chart: nothing ever assigns them a manager and
  // nothing should, so "No manager assigned" is noise for them. Only looked up
  // when it could matter (active, no manager). If the viewer's access hides the
  // role rows, this reads as "not an exec" and the callout is shown, as before.
  let isExecutive = false;
  if (!employee.manager_id && employee.employment_status === "active" && employee.user_id) {
    const { data: execRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", employee.user_id)
      .in("role", ["ceo", "cto"])
      .is("revoked_at", null)
      .limit(1);
    isExecutive = (execRoles ?? []).length > 0;
  }

  const outstanding: string[] = [];
  if (!employee.job_title) outstanding.push("No job title set.");
  if (!employee.manager_id && employee.employment_status === "active" && !isExecutive) outstanding.push("No manager assigned.");

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
        canEditCore={canEditCore}
        isSelf={isSelf}
      />
    </div>
  );
}
