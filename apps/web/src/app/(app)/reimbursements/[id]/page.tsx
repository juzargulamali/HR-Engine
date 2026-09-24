import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AddLineForm } from "./add-line-form";
import { DeleteLineButton } from "./delete-line-button";
import { ClaimActions } from "./claim-actions";
import { EmptyState } from "@/components/ui/empty-state";

export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: claim } = await supabase
    .from("reimbursement_claims")
    .select("id, employee_id, claim_date, currency, total_amount, status")
    .eq("id", id)
    .maybeSingle();
  if (!claim) notFound();

  const { data: lines } = await supabase
    .from("reimbursement_claim_lines")
    .select("id, line_no, expense_date, category, amount, description, receipt_file_path")
    .eq("claim_id", id)
    .order("line_no");

  const linesWithReceiptUrl = await Promise.all(
    (lines ?? []).map(async (line) => {
      if (!line.receipt_file_path) return { ...line, receiptUrl: null as string | null };
      const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(line.receipt_file_path, 300);
      return { ...line, receiptUrl: signed?.signedUrl ?? null };
    }),
  );

  const isOwner = claim.employee_id === session.employeeId;
  const isDraft = claim.status === "draft";
  const isCancellable = claim.status === "submitted" || claim.status === "pending_approval";

  return (
    <div className="space-y-6">
      <Link href="/reimbursements" className="text-sm text-muted-foreground hover:underline">
        ← Back to reimbursements
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Claim — {claim.currency} {claim.total_amount}
          </h1>
          <p className="text-muted-foreground">{claim.claim_date}</p>
        </div>
        <Badge>{claim.status.replace(/_/g, " ")}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Expense lines</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {linesWithReceiptUrl.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.expense_date}</TableCell>
                  <TableCell className="capitalize">{line.category}</TableCell>
                  <TableCell>{line.amount}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{line.description ?? "—"}</TableCell>
                  <TableCell>
                    {line.receiptUrl ? (
                      <a href={line.receiptUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        View
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{isOwner && isDraft ? <DeleteLineButton lineId={line.id} claimId={claim.id} /> : null}</TableCell>
                </TableRow>
              ))}
              {linesWithReceiptUrl.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState dense title="No expense lines yet." />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isOwner && isDraft ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Add an expense line</CardTitle>
          </CardHeader>
          <CardContent>
            <AddLineForm claimId={claim.id} />
          </CardContent>
        </Card>
      ) : null}

      {isOwner && (isDraft || isCancellable) ? <ClaimActions claimId={claim.id} isDraft={isDraft} isCancellable={isCancellable} /> : null}
    </div>
  );
}
