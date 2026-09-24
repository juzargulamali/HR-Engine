import { canManagePerformanceCycles, hasRoleAnyScope } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { NewCycleForm } from "./new-cycle-form";
import { CloseCycleButton } from "./close-cycle-button";
import { EmptyState } from "@/components/ui/empty-state";

export default async function PerformanceCyclesPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const canView = hasRoleAnyScope(session.grants, "hr_admin");
  if (!canView) {
    return <Alert variant="destructive">Performance cycles are managed by HR Admin.</Alert>;
  }

  const supabase = await createClient();
  const { data: companies } = await supabase.from("companies").select("id, legal_name");
  const manageableCompanies = (companies ?? []).filter((c) => canManagePerformanceCycles(session.grants, c.id));
  const companyIds = manageableCompanies.map((c) => c.id);

  // performance_cycles_select has no company scoping (any signed-in user
  // can read it), so this view narrows to the companies this HR Admin
  // actually administers itself, same as assets/page.tsx's manageableCompanies.
  const { data: cycles } =
    companyIds.length > 0
      ? await supabase
          .from("performance_cycles")
          .select("id, company_id, name, period_start, period_end, status")
          .in("company_id", companyIds)
          .order("period_start", { ascending: false })
      : { data: [] as never[] };

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.legal_name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Performance cycles</h1>
        <p className="text-muted-foreground">Employees can only add goals to an open cycle.</p>
      </div>

      {manageableCompanies.length > 0 ? (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Start a cycle</CardTitle>
          </CardHeader>
          <CardContent>
            <NewCycleForm companies={manageableCompanies.map((c) => ({ id: c.id, legal_name: c.legal_name }))} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>All cycles</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(cycles ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{companyName.get(c.company_id) ?? "—"}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>
                    {c.period_start} – {c.period_end}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.status === "open" ? "default" : "outline"}>{c.status}</Badge>
                  </TableCell>
                  <TableCell>{c.status === "open" ? <CloseCycleButton cycleId={c.id} /> : null}</TableCell>
                </TableRow>
              ))}
              {(cycles ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState dense title="No cycles yet." />
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
