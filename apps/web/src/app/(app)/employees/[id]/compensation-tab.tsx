import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompensationSection } from "./compensation-section";
import { FinalSettlementSection } from "./final-settlement-section";

/**
 * Final settlement only ever applied to a terminated employee with a
 * termination date — it nests under Compensation rather than being its own
 * top-level tab, since it's not one of the ten requested sections.
 */
export function CompensationTab({
  employeeId,
  canSeeComp,
  isSelf,
  canSeeSettlement,
  employmentStatus,
  countryCode,
  hireDate,
  terminationDate,
}: {
  employeeId: string;
  canSeeComp: boolean;
  isSelf: boolean;
  canSeeSettlement: boolean;
  employmentStatus: string;
  countryCode: string;
  hireDate: string;
  terminationDate: string | null;
}) {
  return (
    <div className="space-y-6">
      {canSeeComp ? (
        <Card>
          <CardHeader>
            <CardTitle>Compensation</CardTitle>
          </CardHeader>
          <CardContent>
            <CompensationSection employeeId={employeeId} canEdit={!isSelf && canSeeComp} isSelf={isSelf} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeSettlement && employmentStatus === "terminated" && terminationDate ? (
        <Card>
          <CardHeader>
            <CardTitle>Final settlement</CardTitle>
          </CardHeader>
          <CardContent>
            <FinalSettlementSection
              employeeId={employeeId}
              countryCode={countryCode}
              hireDate={hireDate}
              terminationDate={terminationDate}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
