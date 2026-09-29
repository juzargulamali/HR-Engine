import { notFound } from "next/navigation";
import { hasRoleAnyScope, isSysAdmin } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { EditProjectForm } from "./edit-project-form";
import { AddAllocationForm } from "./add-allocation-form";
import { EndAllocationButton } from "./end-allocation-button";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) return null;
  if (!hasRoleAnyScope(session.grants, "hr_admin") && !isSysAdmin(session.grants)) {
    return <EmptyState title="Not available" description="Only HR Admin manages projects." />;
  }

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name, client_name, is_billable, is_active, company_id, manager_id")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: employees }, { data: allocations }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name").eq("company_id", project.company_id).is("deleted_at", null).order("first_name"),
    supabase
      .from("project_allocations")
      .select("id, employee_id, allocation_percent, start_date, end_date")
      .eq("project_id", project.id)
      .order("start_date", { ascending: false }),
  ]);

  const employeeName = new Map((employees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <p className="text-muted-foreground">Code: {project.code}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditProjectForm project={project} employees={employees ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assigned employees</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            An employee needs an active allocation here before Recovery Leave requests for them can route to this
            project&apos;s manager.
          </p>
          <AddAllocationForm projectId={project.id} employees={employees ?? []} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Allocation %</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(allocations ?? []).map((a) => {
                const isActive = a.start_date <= today && (!a.end_date || a.end_date >= today);
                return (
                  <TableRow key={a.id}>
                    <TableCell>{employeeName.get(a.employee_id) ?? "—"}</TableCell>
                    <TableCell>{a.allocation_percent}%</TableCell>
                    <TableCell>{a.start_date}</TableCell>
                    <TableCell>{a.end_date ?? "—"}</TableCell>
                    <TableCell>{isActive && !a.end_date ? <EndAllocationButton allocationId={a.id} projectId={project.id} /> : null}</TableCell>
                  </TableRow>
                );
              })}
              {(allocations ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState title="No one assigned yet" description="Add an employee above." />
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
