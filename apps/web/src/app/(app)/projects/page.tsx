import Link from "next/link";
import { hasRoleAnyScope, isSysAdmin } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateProjectForm } from "./create-project-form";

/**
 * projects_select itself is broad (any authenticated user can read active
 * projects — every employee needs to pick one for a timesheet line), but
 * this MANAGEMENT page (create, assign a Project Manager) is HR-Admin/
 * Sys-Admin-only, same gating as /admin/companies and /employees/new —
 * projects_write is the real enforcement either way.
 */
export default async function ProjectsPage() {
  const session = await getCurrentSession();
  if (!session) return null;
  if (!hasRoleAnyScope(session.grants, "hr_admin") && !isSysAdmin(session.grants)) {
    return <EmptyState title="Not available" description="Only HR Admin manages projects." />;
  }

  const supabase = await createClient();
  const [{ data: projects }, { data: companies }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, code, name, client_name, is_active, company_id, manager_id")
      .is("deleted_at", null)
      .order("name"),
    supabase.from("companies").select("id, legal_name").order("legal_name"),
  ]);

  const managerIds = [...new Set((projects ?? []).map((p) => p.manager_id).filter(Boolean))] as string[];
  const { data: managers } =
    managerIds.length > 0
      ? await supabase.from("employees").select("id, first_name, last_name").in("id", managerIds)
      : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const managerName = new Map((managers ?? []).map((m) => [m.id, `${m.first_name} ${m.last_name}`]));
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.legal_name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-muted-foreground">
          Each project needs an assigned Project Manager — used to route Recovery Leave requests for employees
          allocated to it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a project</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateProjectForm companies={companies ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All projects</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Project Manager</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(projects ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <Link href={`/projects/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>{p.code}</TableCell>
                  <TableCell>{companyName.get(p.company_id) ?? "—"}</TableCell>
                  <TableCell>{p.client_name ?? "—"}</TableCell>
                  <TableCell>
                    {p.manager_id ? (
                      (managerName.get(p.manager_id) ?? "—")
                    ) : (
                      <Badge variant="warning">Unassigned</Badge>
                    )}
                  </TableCell>
                  <TableCell>{p.is_active ? "Active" : "Inactive"}</TableCell>
                </TableRow>
              ))}
              {(projects ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState title="No projects yet" description="Add one above." />
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
