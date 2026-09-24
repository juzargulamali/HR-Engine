import Link from "next/link";
import { canViewHrAlerts } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";

const HORIZON_DAYS = 30;

function daysUntil(dateStr: string, today: Date): number {
  const target = new Date(`${dateStr}T00:00:00Z`);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function UrgencyBadge({ days }: { days: number }) {
  if (days < 0) return <Badge variant="destructive">{Math.abs(days)}d overdue</Badge>;
  if (days === 0) return <Badge variant="destructive">Due today</Badge>;
  return <Badge variant="secondary">{days}d left</Badge>;
}

export default async function AlertsPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  if (!canViewHrAlerts(session.grants)) {
    return <Alert variant="destructive">Alerts are restricted to HR Admin, CEO, and CTO.</Alert>;
  }

  const supabase = await createClient();
  const today = new Date();
  const horizon = new Date(today.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  // No explicit company filter on any of these — like employees/page.tsx,
  // RLS alone decides what's visible (every company an HR Admin/CEO/CTO
  // grant covers), never re-derived here.
  const [{ data: employees }, { data: contracts }, { data: employeeDocs }, { data: identityDocs }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name").is("deleted_at", null),
    supabase
      .from("employment_contracts")
      .select("id, employee_id, contract_type, end_date, probation_end_date")
      .eq("is_current", true)
      .or(`end_date.lte.${horizon},probation_end_date.lte.${horizon}`),
    supabase
      .from("employee_documents")
      .select("id, employee_id, document_type, expiry_date, status")
      .in("status", ["expiring_soon", "expired"]),
    supabase
      .from("identity_documents")
      .select("id, employee_id, document_type, document_number, expiry_date")
      .not("expiry_date", "is", null)
      .lte("expiry_date", horizon),
  ]);

  const employeeName = new Map((employees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));

  const contractsEnding = (contracts ?? [])
    .filter((c) => c.end_date)
    .map((c) => ({ ...c, days: daysUntil(c.end_date!, today) }))
    .sort((a, b) => a.days - b.days);

  const probationEnding = (contracts ?? [])
    .filter((c) => c.probation_end_date)
    .map((c) => ({ ...c, days: daysUntil(c.probation_end_date!, today) }))
    .sort((a, b) => a.days - b.days);

  const docsFlagged = (employeeDocs ?? [])
    .map((d) => ({ ...d, days: d.expiry_date ? daysUntil(d.expiry_date, today) : null }))
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  const identityFlagged = (identityDocs ?? [])
    .map((d) => ({ ...d, days: daysUntil(d.expiry_date!, today) }))
    .sort((a, b) => a.days - b.days);

  const nothingFlagged =
    contractsEnding.length === 0 && probationEnding.length === 0 && docsFlagged.length === 0 && identityFlagged.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <p className="text-muted-foreground">
          Contracts, probation reviews, and documents due for attention in the next {HORIZON_DAYS} days, or already
          overdue. As of {todayStr}.
        </p>
      </div>

      {nothingFlagged ? (
        <Card>
          <CardContent>
            <EmptyState dense title="Nothing needs attention right now." description="No contracts, documents, or probation periods are due within the next 30 days." />
          </CardContent>
        </Card>
      ) : null}

      {contractsEnding.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Contracts ending</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Contract type</TableHead>
                  <TableHead>End date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contractsEnding.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/employees/${c.employee_id}`} className="hover:underline">
                        {employeeName.get(c.employee_id) ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{c.contract_type.replace(/_/g, " ")}</TableCell>
                    <TableCell>{c.end_date}</TableCell>
                    <TableCell>
                      <UrgencyBadge days={c.days} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {probationEnding.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Probation reviews due</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Probation end date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {probationEnding.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/employees/${c.employee_id}`} className="hover:underline">
                        {employeeName.get(c.employee_id) ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell>{c.probation_end_date}</TableCell>
                    <TableCell>
                      <UrgencyBadge days={c.days} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {docsFlagged.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Documents expiring or expired</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {docsFlagged.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/employees/${d.employee_id}`} className="hover:underline">
                        {employeeName.get(d.employee_id) ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{d.document_type.replace(/_/g, " ")}</TableCell>
                    <TableCell>{d.expiry_date ?? "—"}</TableCell>
                    <TableCell>{d.days !== null ? <UrgencyBadge days={d.days} /> : <Badge variant="outline">No date</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {identityFlagged.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Identity documents expiring soon</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {identityFlagged.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/employees/${d.employee_id}`} className="hover:underline">
                        {employeeName.get(d.employee_id) ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{d.document_type.replace(/_/g, " ")}</TableCell>
                    <TableCell className="font-mono text-xs">{d.document_number}</TableCell>
                    <TableCell>{d.expiry_date}</TableCell>
                    <TableCell>
                      <UrgencyBadge days={d.days} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
