import Link from "next/link";
import { canManagePayrollExport, canViewPayrollExport } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { NewPayrollRunForm } from "./new-payroll-run-form";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  submitted: "secondary",
  pending_approval: "secondary",
  approved: "default",
  rejected: "destructive",
  cancelled: "outline",
};

export default async function PayrollPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: employee } = session.employeeId
    ? await supabase.from("employees").select("company_id").eq("id", session.employeeId).single()
    : { data: null };

  const canManage = employee ? canManagePayrollExport(session.grants, employee.company_id) : false;
  const canView = employee ? canViewPayrollExport(session.grants, employee.company_id) : false;

  if (!canView) {
    return <Alert variant="destructive">Payroll export is restricted to HR Admin, Finance, CEO, and CTO.</Alert>;
  }

  const { data: runs } = await supabase
    .from("payroll_export_runs")
    .select("id, period_month, period_year, status, sent_at")
    .eq("company_id", employee!.company_id)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Payroll-variable export</h1>
        <p className="text-muted-foreground">
          Every export requires both Finance review and CEO sign-off before it can be downloaded — no exceptions,
          regardless of amount.
        </p>
      </div>

      {canManage ? (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Start a new export</CardTitle>
          </CardHeader>
          <CardContent>
            <NewPayrollRunForm companyId={employee!.company_id} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Export runs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runs ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/payroll/${r.id}`} className="hover:underline">
                      {r.period_month}/{r.period_year}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell>{r.sent_at ? new Date(r.sent_at).toLocaleDateString() : "—"}</TableCell>
                </TableRow>
              ))}
              {(runs ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No export runs yet.
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
