import { notFound } from "next/navigation";
import {
  canDeleteOrRestoreEmployee,
  canEditEmployeeCore,
  canManageAssets,
  canManageAttendance,
  canManageContracts,
  canManageEmployeeDocuments,
  canManageIdentityDocuments,
  canManageInsurance,
  canManageLoans,
  canRateGoal,
  canRecordCareerEvent,
  canViewAssetAssignments,
  canViewAttendance,
  canViewCareerEvents,
  canViewCompensation,
  canViewContracts,
  canViewEmployeeDocuments,
  canViewEmployeeLeave,
  canViewFinalSettlement,
  canViewGoals,
  canViewIdentityDocuments,
  canViewInsurance,
  canViewLoans,
} from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { RestoreOrRemoveEmployeeButton } from "./restore-or-remove-employee-button";
import { ProfileTabs, type ProfileTab } from "./profile-tabs";
import { OverviewSection } from "./overview-section";
import { EmploymentSection } from "./employment-section";
import { CompensationTab } from "./compensation-tab";
import { LeaveSection } from "./leave-section";
import { DocumentsTab } from "./documents-tab";
import { InsuranceLoansTab } from "./insurance-loans-tab";
import { AssetsSection } from "./assets-section";
import { AttendanceSection } from "./attendance-section";
import { PerformanceSection } from "./performance-section";

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: requestedTab } = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select(
      "id, first_name, last_name, job_title, employment_status, company_id, country_code, manager_id, hire_date, date_of_birth, termination_date, deleted_at, personal_email, phone, user_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (!employee) notFound();

  const isSelf = session.employeeId === employee.id;
  // Direct-report approximation only — see the note in
  // packages/domain/src/permissions/employees.ts on why the real
  // manager-chain check (is_manager_of) can't be mirrored client-side.
  const isManager = employee.manager_id === session.employeeId;

  // Only ever needed for the page header (company name) — cheap, single
  // row, kept eager. Everything else that used to load unconditionally here
  // (contracts, the linked-login lookup, the managers list) now loads only
  // when its own tab is selected.
  const { data: company } = await supabase
    .from("companies")
    .select("legal_name, default_currency")
    .eq("id", employee.company_id)
    .single();

  const canEditCore = canEditEmployeeCore(session.grants, employee.company_id);
  const canSeeContracts = canViewContracts(session.grants, employee.company_id, { isSelf, isManager });
  const canEditContracts = canManageContracts(session.grants, employee.company_id);
  const canSeeComp = canViewCompensation(session.grants, employee.company_id, isSelf);
  const canSeeCareerEvents = canViewCareerEvents(session.grants, employee.company_id, isSelf);
  const canRecordCareer = canRecordCareerEvent(session.grants, employee.company_id);
  const canSeeIdentity = canViewIdentityDocuments(session.grants, employee.company_id, isSelf);
  const canEditIdentity = canManageIdentityDocuments(session.grants, employee.company_id);
  const canSeeInsurance = canViewInsurance(session.grants, employee.company_id, isSelf);
  const canEditInsurance = canManageInsurance(session.grants, employee.company_id);
  const canSeeLoans = canViewLoans(session.grants, employee.company_id, isSelf);
  const canEditLoans = canManageLoans(session.grants, employee.company_id);
  const canSeeDocuments = canViewEmployeeDocuments(session.grants, employee.company_id, isSelf);
  const canEditDocuments = canManageEmployeeDocuments(session.grants, employee.company_id);
  const canSeeSettlement = canViewFinalSettlement(session.grants, employee.company_id);
  const canDelete = canDeleteOrRestoreEmployee(session.grants, employee.company_id);
  const canSeeAssets = canViewAssetAssignments(session.grants, employee.company_id, { isSelf, isManager });
  const canEditAssets = canManageAssets(session.grants, employee.company_id);
  const canSeeAttendance = canViewAttendance(session.grants, employee.company_id, { isSelf, isManager });
  const canEditAttendance = canManageAttendance(session.grants, employee.company_id);
  const canSeeGoals = canViewGoals(session.grants, employee.company_id, { isSelf, isManager });
  const canRateGoals = canRateGoal(session.grants, employee.company_id, isManager);
  const canSeeLeave = canViewEmployeeLeave(session.grants, employee.company_id, { isSelf, isManager });

  // Every tab a viewer is allowed to reach, in display order. Determined
  // entirely from the same permission checks the old always-rendered
  // sections already used — nothing here grants access the previous layout
  // didn't already have, it only changes WHEN each section's data loads.
  const tabs: ProfileTab[] = [
    { value: "overview", label: "Overview" },
    ...(canSeeContracts || canSeeCareerEvents ? [{ value: "employment", label: "Employment" }] : []),
    ...(canSeeComp ? [{ value: "compensation", label: "Compensation" }] : []),
    ...(canSeeLeave ? [{ value: "leave", label: "Leave" }] : []),
    ...(canSeeAttendance ? [{ value: "attendance", label: "Attendance" }] : []),
    ...(canSeeDocuments || canSeeIdentity ? [{ value: "documents", label: "Documents" }] : []),
    ...(canSeeInsurance || canSeeLoans ? [{ value: "insurance-loans", label: "Insurance & Loans" }] : []),
    ...(canSeeAssets ? [{ value: "assets", label: "Assets" }] : []),
    ...(canSeeGoals ? [{ value: "performance", label: "Performance" }] : []),
  ];

  // Never render or fetch a tab the viewer can't reach, even if the URL
  // asks for it directly — falls back to the always-visible Overview tab.
  const activeTab = tabs.some((t) => t.value === requestedTab) ? requestedTab! : "overview";

  return (
    <div className="space-y-6">
      {employee.deleted_at ? (
        <Alert variant="destructive">
          This employee was removed on {new Date(employee.deleted_at).toLocaleDateString()}.
          {canDelete ? " You can restore them below." : ""}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {employee.first_name} {employee.last_name}
          </h1>
          <p className="text-muted-foreground">
            {employee.job_title ?? "No job title set"} · {company?.legal_name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{employee.employment_status}</Badge>
          {canDelete ? (
            <RestoreOrRemoveEmployeeButton
              employeeId={employee.id}
              employeeName={`${employee.first_name} ${employee.last_name}`}
              deleted={Boolean(employee.deleted_at)}
            />
          ) : null}
        </div>
      </div>

      <ProfileTabs tabs={tabs} active={activeTab} basePath={`/employees/${employee.id}`} />

      {activeTab === "overview" ? (
        <OverviewSection employee={employee} canEditCore={canEditCore} isSelf={isSelf} />
      ) : null}

      {activeTab === "employment" ? (
        <EmploymentSection
          employeeId={employee.id}
          canSeeContracts={canSeeContracts}
          canEditContracts={canEditContracts}
          canSeeCareerEvents={canSeeCareerEvents}
          canRecordCareer={canRecordCareer}
        />
      ) : null}

      {activeTab === "compensation" ? (
        <CompensationTab
          employeeId={employee.id}
          canSeeComp={canSeeComp}
          isSelf={isSelf}
          canSeeSettlement={canSeeSettlement}
          employmentStatus={employee.employment_status}
          countryCode={employee.country_code}
          hireDate={employee.hire_date}
          terminationDate={employee.termination_date}
        />
      ) : null}

      {activeTab === "leave" ? <LeaveSection employeeId={employee.id} /> : null}

      {activeTab === "attendance" ? <AttendanceSection employeeId={employee.id} canManage={canEditAttendance} /> : null}

      {activeTab === "documents" ? (
        <DocumentsTab
          employeeId={employee.id}
          canSeeDocuments={canSeeDocuments}
          canEditDocuments={canEditDocuments}
          canSeeIdentity={canSeeIdentity}
          canEditIdentity={canEditIdentity}
        />
      ) : null}

      {activeTab === "insurance-loans" ? (
        <InsuranceLoansTab
          employeeId={employee.id}
          canSeeInsurance={canSeeInsurance}
          canEditInsurance={canEditInsurance}
          canSeeLoans={canSeeLoans}
          canEditLoans={canEditLoans}
          defaultCurrency={company?.default_currency ?? "AED"}
        />
      ) : null}

      {activeTab === "assets" ? (
        <AssetsSection employeeId={employee.id} companyId={employee.company_id} canManage={canEditAssets} />
      ) : null}

      {activeTab === "performance" ? (
        <PerformanceSection employeeId={employee.id} companyId={employee.company_id} canManage={canRateGoals} />
      ) : null}
    </div>
  );
}
