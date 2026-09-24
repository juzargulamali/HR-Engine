import Link from "next/link";
import { hasRoleAnyScope, isCLevel, isFinance, isSysAdmin } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { deleted } = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;

  // hasRoleAnyScope, not a bare isHrAdmin(grants) — hr_admin is always
  // company-scoped (a real grant's companyId is never null), so an unscoped
  // isHrAdmin() check can never match a real HR Admin at all; this page
  // spans however many companies the admin holds hr_admin on, so "in some
  // company" (not a specific one) is the right question here, same as
  // nav-groups.ts's own showInsightsLinks check.
  const isHrAdminSomewhere = hasRoleAnyScope(session.grants, "hr_admin");
  const canManageAnyCompany = isHrAdminSomewhere || isSysAdmin(session.grants);
  // Finance/CEO/CTO see every employee in every company they hold that role
  // on too (employees_select has no manager-chain restriction for them),
  // but unlike HR Admin/Sys Admin they can't manage the roster — a distinct
  // caption from both "you administer this" and "your reports only".
  const isCompanyWideViewer = !canManageAnyCompany && (isFinance(session.grants) || isCLevel(session.grants));
  const showDeleted = canManageAnyCompany && deleted === "1";

  const supabase = await createClient();
  let query = supabase
    .from("employees")
    .select("id, first_name, last_name, job_title, employment_status, company_id, deleted_at")
    .order("first_name");
  if (!showDeleted) {
    query = query.is("deleted_at", null);
  }
  const [{ data: employees }, { data: companies }] = await Promise.all([
    query,
    supabase.from("companies").select("id, legal_name"),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.legal_name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Employees</h1>
          <p className="text-muted-foreground">
            {canManageAnyCompany
              ? "Everyone you administer."
              : isCompanyWideViewer
                ? "Everyone in your company."
                : "You and the people who report to you."}
          </p>
        </div>
        <div className="flex gap-2">
          {canManageAnyCompany ? (
            <Link
              href={showDeleted ? "/employees" : "/employees?deleted=1"}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {showDeleted ? "Hide deleted" : "Show deleted"}
            </Link>
          ) : null}
          {canManageAnyCompany ? (
            <a href="/api/reports/headcount" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Download CSV
            </a>
          ) : null}
          {isHrAdminSomewhere ? (
            <Link href="/employees/new" className={cn(buttonVariants({ size: "sm" }))}>
              New employee
            </Link>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{showDeleted ? "All employees (including deleted)" : "Active employees"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Job title</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(employees ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <Link href={`/employees/${e.id}`} className="hover:underline">
                      {e.first_name} {e.last_name}
                    </Link>
                    {e.deleted_at ? (
                      <Badge variant="destructive" className="ml-2 text-[10px]">
                        deleted
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{e.job_title ?? "—"}</TableCell>
                  <TableCell>{companyName.get(e.company_id) ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{e.employment_status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(employees ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No employees to show.
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
