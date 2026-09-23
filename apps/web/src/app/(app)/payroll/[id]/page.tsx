import Link from "next/link";
import { notFound } from "next/navigation";
import { canManagePayrollExport } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RunActions } from "./run-actions";
import { EditPayrollLineForm } from "./edit-payroll-line-form";
import { DeletePayrollLineButton } from "./delete-payroll-line-button";
import { AddManualPayrollLineForm } from "./add-manual-payroll-line-form";

const COMPONENT_LABELS: Record<string, string> = {
  basic_salary: "Basic salary",
  other_allowance: "Other allowance",
  reimbursement: "Reimbursement",
  leave_encashment: "Leave encashment",
  bonus: "Bonus",
  deduction: "Deduction",
};

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

  const [{ data: lines }, { data: employees }, { data: company }] = await Promise.all([
    supabase
      .from("payroll_export_lines")
      .select("id, employee_id, component_code, amount, currency, label, is_manual")
      .eq("run_id", id),
    supabase.from("employees").select("id, first_name, last_name").eq("company_id", run.company_id).is("deleted_at", null).order("first_name"),
    supabase.from("companies").select("default_currency").eq("id", run.company_id).single(),
  ]);

  const employeeName = new Map((employees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const canManage = canManagePayrollExport(session.grants, run.company_id);
  const isDraft = run.status === "draft";

  type PayrollLine = NonNullable<typeof lines>[number];
  const linesByEmployee = new Map<string, PayrollLine[]>();
  for (const line of lines ?? []) {
    const bucket = linesByEmployee.get(line.employee_id);
    if (bucket) bucket.push(line);
    else linesByEmployee.set(line.employee_id, [line]);
  }
  // Employees with at least one line, ordered by name.
  const employeeIds = [...linesByEmployee.keys()].sort((a, b) =>
    (employeeName.get(a) ?? "").localeCompare(employeeName.get(b) ?? ""),
  );
  const grandTotal = (lines ?? []).reduce((sum, l) => sum + Number(l.amount), 0);

  return (
    <div className="space-y-6">
      <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
        ← Back to payroll
      </Link>
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
          <CardTitle>
            Payroll table ({employeeIds.length} employee{employeeIds.length === 1 ? "" : "s"}) — net total {grandTotal.toFixed(2)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {employeeIds.length === 0 ? <p className="text-center text-sm text-muted-foreground">No lines yet.</p> : null}
          {employeeIds.map((employeeId) => {
            const empLines = linesByEmployee.get(employeeId) ?? [];
            const subtotal = empLines.reduce((sum, l) => sum + Number(l.amount), 0);
            return (
              <div key={employeeId} className="space-y-2 rounded-md border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{employeeName.get(employeeId) ?? "—"}</h3>
                  <span className="text-sm font-medium">
                    Subtotal: {empLines[0]?.currency} {subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {empLines.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-1.5 first:border-0 first:pt-0">
                      <div className="min-w-0">
                        <span className="capitalize">{COMPONENT_LABELS[l.component_code] ?? l.component_code.replace(/_/g, " ")}</span>
                        {l.label ? <span className="ml-2 text-sm text-muted-foreground">— {l.label}</span> : null}
                        {l.is_manual ? (
                          <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            manual
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3">
                        {isDraft && canManage ? (
                          <>
                            <EditPayrollLineForm lineId={l.id} runId={run.id} currentAmount={Number(l.amount)} />
                            <DeletePayrollLineButton lineId={l.id} runId={run.id} />
                          </>
                        ) : (
                          <span>
                            {l.currency} {l.amount}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="flex justify-end border-t border-border pt-3">
            <span className="text-base font-semibold">Grand total: {grandTotal.toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      {canManage && isDraft ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Add manual line</CardTitle>
          </CardHeader>
          <CardContent>
            <AddManualPayrollLineForm
              runId={run.id}
              employees={(employees ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))}
              defaultCurrency={company?.default_currency ?? ""}
            />
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <RunActions runId={run.id} companyId={run.company_id} status={run.status} sentAt={run.sent_at} />
      ) : null}
    </div>
  );
}
