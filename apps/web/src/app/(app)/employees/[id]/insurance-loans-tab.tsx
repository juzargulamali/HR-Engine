import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InsuranceSection } from "./insurance-section";
import { LoansSection } from "./loans-section";

/** Groups insurance + loans under one tab — components unchanged. */
export function InsuranceLoansTab({
  employeeId,
  canSeeInsurance,
  canEditInsurance,
  canSeeLoans,
  canEditLoans,
  defaultCurrency,
}: {
  employeeId: string;
  canSeeInsurance: boolean;
  canEditInsurance: boolean;
  canSeeLoans: boolean;
  canEditLoans: boolean;
  defaultCurrency: string;
}) {
  return (
    <div className="space-y-6">
      {canSeeInsurance ? (
        <Card>
          <CardHeader>
            <CardTitle>Insurance</CardTitle>
          </CardHeader>
          <CardContent>
            <InsuranceSection employeeId={employeeId} canEdit={canEditInsurance} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeLoans ? (
        <Card>
          <CardHeader>
            <CardTitle>Loans & cash advances</CardTitle>
          </CardHeader>
          <CardContent>
            <LoansSection employeeId={employeeId} canEdit={canEditLoans} defaultCurrency={defaultCurrency} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
