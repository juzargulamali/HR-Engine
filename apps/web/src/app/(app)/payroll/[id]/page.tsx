import { notFound } from "next/navigation";
import { canManagePayrollExport } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RunActions } from "./run-actions";

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: run } = await supabase
    .from("payroll_export_runs")
    .select("id, company_id, period_month, period_year, status, authorized_by, authorized_at, sent_at")
    .eq("id", id)
    .maybeSingle();
  if (!run) notFound();

  const [{ data: lines }, { data: employees }] = await Promise.all([
    supabase.from("payroll_export_lines").select("id, employee_id, component_code, amount, currency").eq("run_id", id),
    supabase.from("employees").select("id, first_name, last_name"),
  ]);
  const employeeName = new Map((employees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));

  const canManage = canManagePayrollExport(session.grants, run.company_id);
  const total = (lines ?? []).reduce((sum, l) => sum + Number(l.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Payroll export — {run.period_month}/{run.period_year}
          </h1>
          <p className="text-muted-foreground">
            {run.authorized_at ? `Authorized ${new Date(run.authorized_at).toLocaleString()}` : "Awaiting authorization"}
          </p>
        </div>
        <Badge>{run.status.replace(/_/g, " ")}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lines ({(lines ?? []).length}) — total {total.toFixed(2)}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Component</TableHead>
                <TableHead>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(lines ?? []).map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{employeeName.get(l.employee_id) ?? "—"}</TableCell>
                  <TableCell className="capitalize">{l.component_code.replace(/_/g, " ")}</TableCell>
                  <TableCell>
                    {l.currency} {l.amount}
                  </TableCell>
                </TableRow>
              ))}
              {(lines ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No lines yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canManage ? (
        <RunActions runId={run.id} companyId={run.company_id} status={run.status} sentAt={run.sent_at} />
      ) : null}
    </div>
  );
}
