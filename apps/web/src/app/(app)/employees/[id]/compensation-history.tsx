import { canCorrectPayRecord, canViewPayCorrections } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadError } from "@/components/workspace/states";
import { allowanceLabel, longDate, money, numericAllowances, payTotal, recordInForce, type PayRecord, type PendingPayChange } from "@/lib/hr/payCorrection";
import { CorrectPayRecordButton } from "./correct-pay-record-dialog";

interface CorrectionRow {
  id: string;
  compensation_id: string;
  previous_effective_from: string;
  previous_base_salary: string | number;
  previous_allowances: unknown;
  new_effective_from: string;
  new_base_salary: string | number;
  new_allowances: unknown;
  reason: string;
  corrected_by: string;
  corrected_at: string;
}

const figures = (basic: number, allowances: Record<string, number>, currency: string) =>
  [`basic ${money(basic, currency)}`, ...Object.entries(allowances).filter(([, v]) => v > 0).map(([k, v]) => `${allowanceLabel(k).toLowerCase()} ${money(v, currency)}`)].join(", ");

/**
 * The pay history for staff (HR Admin or Finance of the company): every pay record, newest first, with the one in force TODAY marked, and every corrected entry marked with who corrected it, when and why,
 * and the values it had before. "Correct pay record" is offered on each entry to someone who may change this employee's pay (the database decides again). A person reading their own pay sees only the
 * current pay above, as before: the corrections are staff notes.
 */
export async function CompensationHistory({
  employeeId, companyName, countryCode, hireDate, isSelf,
}: {
  employeeId: string;
  companyName: string;
  countryCode: string;
  hireDate: string;
  /** Viewing one's own record: the history is shown (to staff) but nothing can be corrected from here, as with Update pay. */
  isSelf: boolean;
}) {
  const session = await getCurrentSession();
  if (!session) return null;
  const supabase = await createClient();
  const { data: employee, error: employeeError } = await supabase.from("employees").select("company_id, first_name, last_name").eq("id", employeeId).maybeSingle();
  if (employeeError) return <LoadError what="the pay history" retryHref={`/employees/${employeeId}?tab=compensation`} />;
  if (!employee || !canViewPayCorrections(session.grants, employee.company_id)) return null;
  const canCorrect = !isSelf && canCorrectPayRecord(session.grants, employee.company_id);

  const [recordsRes, correctionsRes, pendingRes, todayRes] = await Promise.all([
    supabase.from("compensation_details").select("id, effective_from, base_salary, allowances, currency, is_current, created_at").eq("employee_id", employeeId).order("effective_from", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("compensation_corrections").select("id, compensation_id, previous_effective_from, previous_base_salary, previous_allowances, new_effective_from, new_base_salary, new_allowances, reason, corrected_by, corrected_at").eq("employee_id", employeeId).order("corrected_at", { ascending: true }),
    supabase.from("employee_career_events").select("effective_date, base_compensation_id").eq("employee_id", employeeId).is("applied_at", null).is("dismissed_at", null).is("conflict_at", null).not("new_base_salary", "is", null),
    supabase.rpc("hr_business_today", { p_country_code: countryCode }),
  ]);
  // The history, the corrections and today's date all feed what is said about "in force today" and about the original values: with any unreadable, no history is shown rather than a partial one.
  if (recordsRes.error || correctionsRes.error || pendingRes.error || todayRes.error || typeof todayRes.data !== "string") {
    return <LoadError what="the pay history" retryHref={`/employees/${employeeId}?tab=compensation`} note="The current pay above is unaffected." />;
  }
  const today = todayRes.data;
  const records: PayRecord[] = (recordsRes.data ?? []).map((r) => ({
    id: r.id, effective_from: r.effective_from, base_salary: Number(r.base_salary), allowances: numericAllowances(r.allowances), currency: r.currency, is_current: r.is_current, created_at: r.created_at,
  }));
  if (records.length === 0) return null;
  const corrections = (correctionsRes.data ?? []) as CorrectionRow[];
  const pending: PendingPayChange[] = (pendingRes.data ?? []).map((p) => ({ effective_date: p.effective_date, basedOnId: p.base_compensation_id }));

  const names = new Map<string, string>();
  const ids = [...new Set(corrections.map((c) => c.corrected_by))];
  if (ids.length > 0) {
    const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of people ?? []) if (p.full_name) names.set(p.id, p.full_name);
  }

  const inForce = recordInForce(records, today);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay history</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3" data-testid="pay-history">
          <p className="text-sm text-muted-foreground">Each pay record is in force from its date until the next one starts. The record in force today is marked.</p>
          <ul className="divide-y divide-border">
            {records.map((r) => {
              const mine = corrections.filter((c) => c.compensation_id === r.id);
              const isInForce = inForce?.id === r.id;
              return (
                <li key={r.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0" data-testid={`pay-record-${r.id}`} data-in-force={isInForce ? "true" : "false"}>
                  <p className="flex flex-wrap items-center gap-1.5 font-medium">
                    <span>From {longDate(r.effective_from)}</span>
                    {isInForce ? <Badge variant="success" data-testid="in-force-badge">In force today</Badge> : r.effective_from > today ? <Badge variant="warning">Not in force yet</Badge> : <Badge variant="outline">Replaced by a later record</Badge>}
                    {mine.length > 0 ? <Badge variant="secondary">Corrected</Badge> : null}
                  </p>
                  <p className="text-sm">
                    {figures(r.base_salary, r.allowances, r.currency)}; <span className="font-medium">total {money(payTotal(r.base_salary, r.allowances), r.currency)}</span>
                  </p>
                  {mine.map((c, i) => (
                    <div key={c.id} className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-testid={`correction-${c.id}`}>
                      <p>
                        Corrected on {longDate(c.corrected_at)} by {names.get(c.corrected_by) ?? "a colleague"}: {c.reason}
                      </p>
                      <p className="text-muted-foreground">
                        {i === 0 ? "Original entry" : "Before this correction"}: from {longDate(c.previous_effective_from)}, {figures(Number(c.previous_base_salary), numericAllowances(c.previous_allowances), r.currency)}.
                      </p>
                    </div>
                  ))}
                  {canCorrect ? (
                    <CorrectPayRecordButton employeeId={employeeId} employeeName={`${employee.first_name} ${employee.last_name}`} companyName={companyName} hireDate={hireDate} today={today} record={r} records={records} pending={pending} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
