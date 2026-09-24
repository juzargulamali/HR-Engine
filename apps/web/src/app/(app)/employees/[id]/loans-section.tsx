import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AddLoanForm } from "./add-loan-form";
import { DeleteLoanButton } from "./delete-loan-button";
import { EmptyState } from "@/components/ui/empty-state";

export async function LoansSection({
  employeeId,
  canEdit,
  defaultCurrency,
}: {
  employeeId: string;
  canEdit: boolean;
  defaultCurrency: string;
}) {
  const supabase = await createClient();
  const { data: loans } = await supabase
    .from("employee_loans")
    .select("id, loan_type, amount, currency, issued_date, note")
    .eq("employee_id", employeeId)
    .order("issued_date", { ascending: false });

  return (
    <div className="space-y-4">
      <Table>
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

      {canEdit ? <AddLoanForm employeeId={employeeId} defaultCurrency={defaultCurrency} /> : null}
    </div>
  );
}
