import type { ComponentProps } from "react";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { LoadError } from "@/components/workspace/states";
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
  const [{ data: linkedProfile, error: profileError }, { data: managers, error: managersError }, { data: managerName, error: managerNameError }] = await Promise.all([
    employee.user_id
      ? supabase.from("profiles").select("email").eq("id", employee.user_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
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
    employee.manager_id ? supabase.rpc("get_employee_manager_name", { p_employee_id: employee.id }) : Promise.resolve({ data: null, error: null }),
  ]);

  // A CEO/CTO is top of the org chart: nothing ever assigns them a manager and
  // nothing should, so "No manager assigned" is noise for them. Asked through
  // employee_is_c_level() (gated like the manager-name lookup above) rather than
  // by reading user_roles, which only the owner and a Sys Admin can read — an HR
  // Admin looking at a CEO's profile must get the same answer. Only looked up
  // when it could matter (active, no manager).
  let isExecutive = false;
  let executiveCheckFailed = false;
  if (!employee.manager_id && employee.employment_status === "active") {
    const { data, error } = await supabase.rpc("employee_is_c_level", { p_employee_id: employee.id });
    isExecutive = data === true;
    executiveCheckFailed = !!error;
  }

  const outstanding: string[] = [];
  if (!employee.job_title) outstanding.push("No job title set.");
  // "No manager assigned" is only said when it is known: an unreadable manager name or C-level check is reported below instead.
  if (!employee.manager_id && employee.employment_status === "active" && !isExecutive && !executiveCheckFailed) outstanding.push("No manager assigned.");
  const unreadable = [
    profileError ? "the linked login" : null,
    managersError ? "the list of possible managers" : null,
    managerNameError ? "the manager's name" : null,
    executiveCheckFailed ? "whether this person is a C-level executive" : null,
  ].filter((x): x is string => x !== null);

  return (
    <div className="space-y-4">
      {unreadable.length > 0 ? <LoadError what={unreadable.join(", ")} retryHref={`/employees/${employee.id}`} note="Nothing here is missing: those parts could not be read, and editing is withheld until they load." /> : null}
      {outstanding.length > 0 ? (
        <Alert variant="warning">{outstanding.join(" ")}</Alert>
      ) : null}
      <EditEmployeeForm
        employee={employee}
        linkedEmail={linkedProfile?.email ?? null}
        managers={(managers ?? []).filter((m) => m.id !== employee.id)}
        managerName={managerNameError ? "Could not load" : managerName ?? null}
        canEditCore={canEditCore && !profileError && !managersError}
        isSelf={isSelf}
      />
    </div>
  );
}
