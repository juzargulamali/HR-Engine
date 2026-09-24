import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewClaimForm } from "./new-claim-form";
import { DeleteDraftClaimButton } from "./delete-draft-claim-button";
import { EmptyState } from "@/components/ui/empty-state";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  submitted: "secondary",
  pending_approval: "secondary",
  approved: "default",
  rejected: "destructive",
  cancelled: "outline",
};

export default async function ReimbursementsPage() {
  const session = await getCurrentSession();
  if (!session) return null;

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
  const [{ data: claims }, { data: employee }] = await Promise.all([
    supabase
      .from("reimbursement_claims")
      .select("id, claim_date, currency, total_amount, status")
      .eq("employee_id", session.employeeId)
      .order("claim_date", { ascending: false }),
    supabase.from("employees").select("company_id").eq("id", session.employeeId).single(),
  ]);

  let defaultCurrency = "AED";
  if (employee) {
    const { data: company } = await supabase.from("companies").select("default_currency").eq("id", employee.company_id).single();
    if (company) defaultCurrency = company.default_currency;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My Reimbursements</h1>
        <p className="text-muted-foreground">Submit an expense claim and track its approval.</p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Start a new claim</CardTitle>
        </CardHeader>
        <CardContent>
          <NewClaimForm defaultCurrency={defaultCurrency} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My claims</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
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
                <TableRow key={c.id}>
                  <TableCell>{c.claim_date}</TableCell>
                  <TableCell>
                    <Link href={`/reimbursements/${c.id}`} className="hover:underline">
                      {c.currency} {c.total_amount}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status] ?? "outline"}>{c.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell>{c.status === "draft" ? <DeleteDraftClaimButton claimId={c.id} /> : null}</TableCell>
                </TableRow>
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
        </CardContent>
      </Card>
    </div>
  );
}
