import { notFound } from "next/navigation";
import {
  canDeleteOrRestoreEmployee,
  canEditEmployeeCore,
  canManageContracts,
  canManageEmployeeDocuments,
  canManageIdentityDocuments,
  canViewCompensation,
  canViewContracts,
  canViewEmployeeDocuments,
  canViewFinalSettlement,
  canViewIdentityDocuments,
  resolveContractAsOf,
} from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { restoreEmployee, softDeleteEmployee } from "@/lib/actions/employees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EditEmployeeForm } from "./edit-employee-form";
import { ContractHistory } from "./contract-history";
import { CompensationSection } from "./compensation-section";
import { IdentityDocumentsSection } from "./identity-documents-section";
import { EmployeeDocumentsSection } from "./employee-documents-section";
import { FinalSettlementSection } from "./final-settlement-section";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select(
      "id, first_name, last_name, job_title, employment_status, company_id, country_code, manager_id, hire_date, termination_date, deleted_at, personal_email, phone, user_id",
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
    supabase.from("companies").select("legal_name").eq("id", employee.company_id).single(),
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
  const canSeeIdentity = canViewIdentityDocuments(session.grants, employee.company_id, isSelf);
  const canEditIdentity = canManageIdentityDocuments(session.grants, employee.company_id);
  const canSeeDocuments = canViewEmployeeDocuments(session.grants, employee.company_id, isSelf);
  const canEditDocuments = canManageEmployeeDocuments(session.grants, employee.company_id);
  const canSeeSettlement = canViewFinalSettlement(session.grants, employee.company_id);
  const canDelete = canDeleteOrRestoreEmployee(session.grants, employee.company_id);

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
            employee.deleted_at ? (
              <form action={restoreEmployee.bind(null, employee.id)}>
                <Button type="submit" variant="outline" size="sm">
                  Restore
                </Button>
              </form>
            ) : (
              <form action={softDeleteEmployee.bind(null, employee.id)}>
                <Button type="submit" variant="destructive" size="sm">
                  Remove
                </Button>
              </form>
            )
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

      {canSeeIdentity ? (
        <Card>
          <CardHeader>
            <CardTitle>Identity documents</CardTitle>
          </CardHeader>
          <CardContent>
            <IdentityDocumentsSection employeeId={employee.id} companyId={employee.company_id} canEdit={canEditIdentity} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeDocuments ? (
        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <EmployeeDocumentsSection employeeId={employee.id} companyId={employee.company_id} canEdit={canEditDocuments} />
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
