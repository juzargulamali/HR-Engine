import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AddLoanForm } from "./add-loan-form";
import { DeleteLoanButton } from "./delete-loan-button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/workspace/states";

export async function LoansSection({
  employeeId,
  canEdit,
  defaultCurrency,
  employeeName,
  companyName,
}: {
  employeeId: string;
  canEdit: boolean;
  defaultCurrency: string;
  employeeName?: string;
  companyName?: string;
}) {
  const supabase = await createClient();
  const { data: loans, error } = await supabase
    .from("employee_loans")
    .select("id, loan_type, amount, currency, issued_date, note")
    .eq("employee_id", employeeId)
    .order("issued_date", { ascending: false });

  if (error) {
    // A failed read is not "No loans or cash advances on record". Adding one does not depend on the list, so that form stays.
    return (
      <div className="space-y-4">
        <LoadError what="the loans and cash advances" retryHref={`/employees/${employeeId}?tab=insurance-loans`} />
        {canEdit ? <AddLoanForm employeeId={employeeId} defaultCurrency={defaultCurrency} employeeName={employeeName} companyName={companyName} /> : null}
      </div>
    );
  }

  // What the records support: how many are on record and the total per currency. There is no repayment schedule or due date in these records, so none is shown.
  const totals = new Map<string, number>();
  for (const l of loans ?? []) totals.set(l.currency, (totals.get(l.currency) ?? 0) + Number(l.amount));
  const summary = (loans ?? []).length > 0 ? `${(loans ?? []).length} on record: ${[...totals].map(([c, t]) => `${t} ${c}`).join(", ")} issued in total.` : null;

  return (
    <div className="space-y-4">
      {summary ? <p className="text-sm text-muted-foreground" data-testid="loans-summary">{summary}</p> : null}
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Date issued</TableHead>
            <TableHead>Note</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(loans ?? []).map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                <Badge variant={l.loan_type === "loan" ? "secondary" : "outline"}>
                  {l.loan_type === "loan" ? "Loan" : "Cash advance"}
                </Badge>
              </TableCell>
              <TableCell>
                {l.amount} {l.currency}
              </TableCell>
              <TableCell>{l.issued_date}</TableCell>
              <TableCell className="text-muted-foreground">{l.note ?? "—"}</TableCell>
              <TableCell>{canEdit ? <DeleteLoanButton loanId={l.id} employeeId={employeeId} /> : null}</TableCell>
            </TableRow>
          ))}
          {(loans ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={5}>
                <EmptyState dense title="No loans or cash advances on record." />
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {canEdit ? <AddLoanForm employeeId={employeeId} defaultCurrency={defaultCurrency} employeeName={employeeName} companyName={companyName} /> : null}
    </div>
  );
}
