import type { ProfileFocus } from "@/lib/hr/focus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompensationSection } from "./compensation-section";
import { CompensationHistory } from "./compensation-history";
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
  // `focus` and `companyName` arrive from the profile page for every tab; this tab has no form of its own to open (Change salary opens the Employment tab's form).
  focus: _focus,
  companyName,
}: {
  employeeId: string;
  canSeeComp: boolean;
  isSelf: boolean;
  canSeeSettlement: boolean;
  employmentStatus: string;
  countryCode: string;
  hireDate: string;
  terminationDate: string | null;
  focus?: ProfileFocus;
  companyName?: string;
}) {
  return (
    <div className="space-y-6">
      {canSeeComp ? (
        <Card>
          <CardHeader>
            <CardTitle>Compensation</CardTitle>
          </CardHeader>
          <CardContent>
            <CompensationSection employeeId={employeeId} canEdit={!isSelf && canSeeComp} isSelf={isSelf} active={employmentStatus !== "terminated"} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeComp ? <CompensationHistory employeeId={employeeId} companyName={companyName ?? ""} countryCode={countryCode} hireDate={hireDate} isSelf={isSelf} /> : null}

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
