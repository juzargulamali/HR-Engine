import { resolveContractAsOf } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { LoadError } from "@/components/workspace/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContractHistory } from "./contract-history";
import { CareerHistorySection } from "./career-history-section";

/**
 * Groups the two employment-history sections under one tab — same
 * components as before, unchanged; only the contracts fetch (previously
 * always run on every page load) now happens lazily, when this tab is
 * actually selected.
 */
export async function EmploymentSection({
  employeeId,
  canSeeContracts,
  canEditContracts,
  canSeeCareerEvents,
  canRecordCareer,
}: {
  employeeId: string;
  canSeeContracts: boolean;
  canEditContracts: boolean;
  canSeeCareerEvents: boolean;
  canRecordCareer: boolean;
}) {
  const supabase = await createClient();
  const { data: contracts, error: contractsError } = canSeeContracts
    ? await supabase
        .from("employment_contracts")
        .select("id, contract_type, start_date, end_date, notice_period_days, is_current, version_no")
        .eq("employee_id", employeeId)
        .order("version_no", { ascending: false })
    : { data: null, error: null };

  const currentContract = resolveContractAsOf(
    (contracts ?? []).map((c) => ({ startDate: c.start_date, endDate: c.end_date, versionNo: c.version_no, ...c })),
    new Date().toISOString().slice(0, 10),
  );

  return (
    <div className="space-y-6">
      {canSeeContracts ? (
        <Card>
          <CardHeader>
            <CardTitle>Contract history</CardTitle>
          </CardHeader>
          <CardContent>
            {/* A failed read is not "No contract on record", and the add-version form (which numbers the next version from this list) is withheld too. */}
            {contractsError ? (
              <LoadError what="the contract history" retryHref={`/employees/${employeeId}?tab=employment`} />
            ) : (
              <ContractHistory
                employeeId={employeeId}
                contracts={contracts ?? []}
                currentAsOfTodayVersionNo={currentContract?.versionNo ?? null}
                canEdit={canEditContracts}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {canSeeCareerEvents ? (
        <Card>
          <CardHeader>
            <CardTitle>Promotions & salary history</CardTitle>
          </CardHeader>
          <CardContent>
            <CareerHistorySection employeeId={employeeId} canView={canSeeCareerEvents} canRecord={canRecordCareer} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
