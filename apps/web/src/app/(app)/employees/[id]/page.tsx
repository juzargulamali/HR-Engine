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
  canViewFinalSettlement,
  canViewGoals,
  canViewIdentityDocuments,
  canViewInsurance,
  canViewLoans,
  resolveContractAsOf,
} from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { RestoreOrRemoveEmployeeButton } from "./restore-or-remove-employee-button";
import { EditEmployeeForm } from "./edit-employee-form";
import { ContractHistory } from "./contract-history";
import { CompensationSection } from "./compensation-section";
import { CareerHistorySection } from "./career-history-section";
import { IdentityDocumentsSection } from "./identity-documents-section";
import { InsuranceSection } from "./insurance-section";
import { LoansSection } from "./loans-section";
import { EmployeeDocumentsSection } from "./employee-documents-section";
import { FinalSettlementSection } from "./final-settlement-section";
import { AssetsSection } from "./assets-section";
import { AttendanceSection } from "./attendance-section";
import { PerformanceSection } from "./performance-section";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const { data: linkedProfile } = employee.user_id
    ? await supabase.from("profiles").select("email").eq("id", employee.user_id).maybeSingle()
    : { data: null };

  const isSelf = session.employeeId === employee.id;
  // Direct-report approximation only — see the note in
  // packages/domain/src/permissions/employees.ts on why the real
  // manager-chain check (is_manager_of) can't be mirrored client-side.
  const isManager = employee.manager_id === session.employeeId;

  const [{ data: contracts }, { data: company }, { data: managers }] = await Promise.all([
    supabase
      .from("employment_contracts")
      .select("id, contract_type, start_date, end_date, notice_period_days, is_current, version_no")
      .eq("employee_id", employee.id)
      .order("version_no", { ascending: false }),
    supabase.from("companies").select("legal_name, default_currency").eq("id", employee.company_id).single(),
    supabase.from("employees").select("id, first_name, last_name").eq("company_id", employee.company_id).is("deleted_at", null),
  ]);

  const currentContract = resolveContractAsOf(
    (contracts ?? []).map((c) => ({ startDate: c.start_date, endDate: c.end_date, versionNo: c.version_no, ...c })),
    new Date().toISOString().slice(0, 10),
  );

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

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <EditEmployeeForm
            employee={employee}
            linkedEmail={linkedProfile?.email ?? null}
            managers={(managers ?? []).filter((m) => m.id !== employee.id)}
            canEditCore={canEditCore}
            isSelf={isSelf}
          />
        </CardContent>
      </Card>

      {canSeeContracts ? (
        <Card>
          <CardHeader>
            <CardTitle>Contract history</CardTitle>
          </CardHeader>
          <CardContent>
            <ContractHistory
              employeeId={employee.id}
              contracts={contracts ?? []}
              currentAsOfTodayVersionNo={currentContract?.versionNo ?? null}
              canEdit={canEditContracts}
            />
          </CardContent>
        </Card>
      ) : null}

      {canSeeComp ? (
        <Card>
          <CardHeader>
            <CardTitle>Compensation</CardTitle>
          </CardHeader>
          <CardContent>
            <CompensationSection employeeId={employee.id} canEdit={!isSelf && canSeeComp} isSelf={isSelf} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeCareerEvents ? (
        <Card>
          <CardHeader>
            <CardTitle>Promotions & salary history</CardTitle>
          </CardHeader>
          <CardContent>
            <CareerHistorySection employeeId={employee.id} canView={canSeeCareerEvents} canRecord={canRecordCareer} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeIdentity ? (
        <Card>
          <CardHeader>
            <CardTitle>Identity documents</CardTitle>
          </CardHeader>
          <CardContent>
            <IdentityDocumentsSection employeeId={employee.id} canEdit={canEditIdentity} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeInsurance ? (
        <Card>
          <CardHeader>
            <CardTitle>Insurance</CardTitle>
          </CardHeader>
          <CardContent>
            <InsuranceSection employeeId={employee.id} canEdit={canEditInsurance} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeLoans ? (
        <Card>
          <CardHeader>
            <CardTitle>Loans & cash advances</CardTitle>
          </CardHeader>
          <CardContent>
            <LoansSection employeeId={employee.id} canEdit={canEditLoans} defaultCurrency={company?.default_currency ?? "AED"} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeDocuments ? (
        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <EmployeeDocumentsSection employeeId={employee.id} canEdit={canEditDocuments} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeAssets ? (
        <Card>
          <CardHeader>
            <CardTitle>Assets</CardTitle>
          </CardHeader>
          <CardContent>
            <AssetsSection employeeId={employee.id} companyId={employee.company_id} canManage={canEditAssets} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeAttendance ? (
        <Card>
          <CardHeader>
            <CardTitle>Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            <AttendanceSection employeeId={employee.id} canManage={canEditAttendance} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeGoals ? (
        <Card>
          <CardHeader>
            <CardTitle>Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceSection employeeId={employee.id} companyId={employee.company_id} canManage={canRateGoals} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeSettlement && employee.employment_status === "terminated" && employee.termination_date ? (
        <Card>
          <CardHeader>
            <CardTitle>Final settlement</CardTitle>
          </CardHeader>
          <CardContent>
            <FinalSettlementSection
              employeeId={employee.id}
              countryCode={employee.country_code}
              hireDate={employee.hire_date}
              terminationDate={employee.termination_date}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
