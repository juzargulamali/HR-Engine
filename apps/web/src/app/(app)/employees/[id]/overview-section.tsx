import type { ComponentProps } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { EmploymentStatusBadge } from "@/components/hr/status";
import { LoadError } from "@/components/workspace/states";
import { cn } from "@/lib/utils";
import { loadProfileSetup, type HrReadClient, type ProfileViewer } from "@/lib/hr/profile-data";
import { peopleAccessHref } from "@/lib/hr/setup";
import { EditEmployeeForm } from "./edit-employee-form";
import { SetupChecklist } from "./setup-checklist";
import { NextActions } from "./next-actions";

// Reuses EditEmployeeForm's own prop type (rather than redeclaring it) so
// employment_status's literal union stays in sync automatically, plus the
// two extra fields (company_id, user_id) this component itself needs that
// EditEmployeeForm doesn't.
type OverviewEmployee = ComponentProps<typeof EditEmployeeForm>["employee"] & {
  company_id: string;
  country_code: string;
  first_name: string;
  last_name: string;
  hire_date: string;
  deleted_at: string | null;
  user_id: string | null;
};

/** The modules whose access can change in People & Access, named before anyone goes there. */
const ACCESS_MODULES = "Sales, Projects, Operations, Inventory, Finance and HR";

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
  companyName,
  departmentName,
  canEditCore,
  isSelf,
  viewer,
  focusStep,
}: {
  employee: OverviewEmployee;
  companyName: string;
  /** Null when the employee has none, or the viewer cannot read departments. */
  departmentName: string | null;
  canEditCore: boolean;
  isSelf: boolean;
  viewer: ProfileViewer;
  /** The setup step the person came from (`?step=`): its row is highlighted and, for the account step, the link form is highlighted. */
  focusStep?: string;
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

  const setup = await loadProfileSetup(supabase as unknown as HrReadClient, employee, viewer, { managerNotExpected: isExecutive || executiveCheckFailed || managerNameError !== null });
  const employeeName = `${employee.first_name} ${employee.last_name}`;
  const accessTab = viewer.canInvite ? "account" : "job";

  return (
    <div className="space-y-4">
      {unreadable.length > 0 ? <LoadError what={unreadable.join(", ")} retryHref={`/employees/${employee.id}`} note="Nothing here is missing: those parts could not be read, and editing is withheld until they load." /> : null}
      <SetupChecklist steps={setup.steps} employeeName={employeeName} companyName={companyName} focusStep={focusStep} />
      <NextActions exceptions={setup.exceptions} />

      <Card data-testid="employee-facts">
        <CardHeader>
          <CardTitle className="text-base">At a glance</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Company</dt>
            <dd data-testid="fact-company">{companyName}</dd>
            <dt className="text-muted-foreground">Department</dt>
            <dd data-testid="fact-department">{departmentName ?? "Not set"}</dd>
            <dt className="text-muted-foreground">Manager</dt>
            <dd data-testid="fact-manager">{managerNameError ? "Could not load" : managerName ?? (isExecutive ? "Not needed (top of the organisation)" : "Not set")}</dd>
            <dt className="text-muted-foreground">Employment status</dt>
            <dd>
              <EmploymentStatusBadge status={employee.employment_status} />
            </dd>
            <dt className="text-muted-foreground">Hire date</dt>
            <dd>{employee.hire_date}</dd>
          </dl>
        </CardContent>
      </Card>

      {viewer.canOpenAccess ? (
        <Card data-testid="people-access-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-1 text-base">
              Account, HR roles and module access
              <InfoHint label="Account and access">
                <p>Invitations, HR roles and module access are managed in People & Access, one place for every module. Saving this employee&apos;s employment details never changes an invitation or an access grant, and changing access there never edits employment details.</p>
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p data-testid="people-access-scope">
              Changing access there affects <span className="font-medium">{companyName}</span>: {ACCESS_MODULES}.
            </p>
            <p className="text-muted-foreground">{employee.user_id ? "This person has a linked login." : "No login is linked yet."}</p>
            <Link href={peopleAccessHref(employee.user_id, employee.id, accessTab)} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "w-full sm:w-auto")}>
              Open People & Access
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {/* For an HR Admin the same gaps are in Next actions above, each with its link; everyone else keeps this plain notice. */}
      {!viewer.canEditCore && outstanding.length > 0 ? (
        <Alert variant="warning">{outstanding.join(" ")}</Alert>
      ) : null}
      <EditEmployeeForm
        employee={employee}
        linkedEmail={linkedProfile?.email ?? null}
        managers={(managers ?? []).filter((m) => m.id !== employee.id)}
        canEditCore={canEditCore && !profileError && !managersError}
        isSelf={isSelf}
        focusAccount={focusStep === "account"}
        focusJob={focusStep === "job"}
      />
    </div>
  );
}
