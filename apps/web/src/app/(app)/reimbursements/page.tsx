import { LoadError } from "@/components/workspace/states";
import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewClaimForm } from "./new-claim-form";
import { DeleteDraftClaimButton } from "./delete-draft-claim-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, statusNextAction } from "@/components/ui/status-badge";
import { ClickableRow } from "@/components/workspace/clickable-row";
import { RememberList } from "@/components/workspace/list-memory";

export const metadata = { title: "Reimbursements" };

export default async function ReimbursementsPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  // A failed role / employee read is not "no employee record": say it could not load.
  if (session.loadFailed) return <LoadError what="your account" />;

  if (!session.employeeId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Reimbursements</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          No employee record is linked to your account yet — nothing to show here.
        </CardContent>
      </Card>
    );
  }

  const supabase = await createClient();
  const [{ data: claims, error: claimsError }, { data: employee, error: employeeError }] = await Promise.all([
    supabase
      .from("reimbursement_claims")
      .select("id, claim_date, currency, total_amount, status")
      .eq("employee_id", session.employeeId)
      .order("claim_date", { ascending: false }),
    supabase.from("employees").select("company_id").eq("id", session.employeeId).single(),
  ]);

  // The currency comes from the company; when it cannot be read the form is not shown with a made-up "AED".
  let defaultCurrency: string | null = "AED";
  let currencyFailed = !!employeeError;
  if (employee) {
    const { data: company, error: companyError } = await supabase.from("companies").select("default_currency").eq("id", employee.company_id).single();
    if (companyError) currencyFailed = true;
    else if (company) defaultCurrency = company.default_currency;
  }
  if (currencyFailed) defaultCurrency = null;

  return (
    <div className="space-y-6">
      <RememberList section="reimbursements" />
      <div>
        <h1 className="text-2xl font-semibold">My Reimbursements</h1>
        <p className="text-muted-foreground">Submit an expense claim and track its approval.</p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Start a new claim</CardTitle>
        </CardHeader>
        <CardContent>
          {defaultCurrency === null ? <LoadError what="your company's currency" retryHref="/reimbursements" note="This is a problem loading the information, so the form is not shown with a guessed currency." /> : <NewClaimForm defaultCurrency={defaultCurrency} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My claims</CardTitle>
        </CardHeader>
        <CardContent>
          {claimsError ? <LoadError what="your claims" retryHref="/reimbursements" note="This is a problem loading the information, not an empty list. Do not start a duplicate claim until it loads." /> : (
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(claims ?? []).map((c) => (
                <ClickableRow key={c.id} href={`/reimbursements/${c.id}`}>
                  <TableCell>{c.claim_date}</TableCell>
                  <TableCell>
                    <Link href={`/reimbursements/${c.id}`} className="hover:underline">
                      {c.currency} {c.total_amount}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <StatusBadge status={c.status} />
                      <p className="text-sm text-muted-foreground">{statusNextAction(c.status)}</p>
                    </div>
                  </TableCell>
                  <TableCell>{c.status === "draft" ? <DeleteDraftClaimButton claimId={c.id} /> : null}</TableCell>
                </ClickableRow>
              ))}
              {(claims ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <EmptyState dense title="No claims yet." />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
