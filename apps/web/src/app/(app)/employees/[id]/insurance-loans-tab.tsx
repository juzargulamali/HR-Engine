import { getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
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
  employeeName,
  companyName,
  countryCode,
}: {
  employeeId: string;
  canSeeInsurance: boolean;
  canEditInsurance: boolean;
  canSeeLoans: boolean;
  canEditLoans: boolean;
  defaultCurrency: string;
  /** Carried into the add forms so the employee and company stay visible while editing. */
  employeeName: string;
  companyName: string;
  /** Sets the calendar day expiry is measured against (the employee's own country). */
  countryCode: string;
}) {
  const today = getBusinessDateString(resolveCountryTimeZone(countryCode));
  return (
    <div className="space-y-6">
      {canSeeInsurance ? (
        <Card>
          <CardHeader>
            <CardTitle>Insurance</CardTitle>
          </CardHeader>
          <CardContent>
            <InsuranceSection employeeId={employeeId} canEdit={canEditInsurance} employeeName={employeeName} companyName={companyName} today={today} />
          </CardContent>
        </Card>
      ) : null}

      {canSeeLoans ? (
        <Card>
          <CardHeader>
            <CardTitle>Loans & cash advances</CardTitle>
          </CardHeader>
          <CardContent>
            <LoansSection employeeId={employeeId} canEdit={canEditLoans} defaultCurrency={defaultCurrency} employeeName={employeeName} companyName={companyName} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
