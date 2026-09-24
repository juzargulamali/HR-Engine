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
  const [{ data: linkedProfile }, { data: managers }] = await Promise.all([
    employee.user_id
      ? supabase.from("profiles").select("email").eq("id", employee.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("employees").select("id, first_name, last_name").eq("company_id", employee.company_id).is("deleted_at", null),
  ]);

  const outstanding: string[] = [];
  if (!employee.job_title) outstanding.push("No job title set.");
  if (!employee.manager_id && employee.employment_status === "active") outstanding.push("No manager assigned.");

  return (
    <div className="space-y-4">
      {outstanding.length > 0 ? (
        <Alert variant="warning">{outstanding.join(" ")}</Alert>
      ) : null}
      <EditEmployeeForm
        employee={employee}
        linkedEmail={linkedProfile?.email ?? null}
        managers={(managers ?? []).filter((m) => m.id !== employee.id)}
        canEditCore={canEditCore}
        isSelf={isSelf}
      />
    </div>
  );
}
