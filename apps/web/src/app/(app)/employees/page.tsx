import Link from "next/link";
import { hasRoleAnyScope, isCLevel, isFinance, isSysAdmin } from "@enginious-hr/domain";
import type { EmploymentStatus } from "@/types/database.types";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";

const PAGE_SIZE = 20;
const STATUS_VALUES: EmploymentStatus[] = ["active", "on_leave", "suspended", "terminated"];

interface EmployeesSearchParams {
  deleted?: string;
  q?: string;
  company?: string;
  status?: string;
  page?: string;
}

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<EmployeesSearchParams> }) {
  const params = await searchParams;
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
  const showDeleted = canManageAnyCompany && params.deleted === "1";

  const supabase = await createClient();
  const { data: companies } = await supabase.from("companies").select("id, legal_name");
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.legal_name]));

  // Every filter is validated/clamped server-side before it ever reaches a
  // query — an invalid company id, status, or page number falls back to
  // "no filter"/page 1 rather than erroring or reaching Supabase unchecked.
  const company = params.company && companyName.has(params.company) ? params.company : "";
  const status = params.status && (STATUS_VALUES as string[]).includes(params.status) ? (params.status as EmploymentStatus) : "";
  const q = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("employees")
    .select("id, first_name, last_name, job_title, employment_status, company_id, deleted_at", { count: "exact" })
    .order("first_name")
    .order("id"); // stable tie-breaker so paging never skips/repeats a row when names collide
  if (!showDeleted) query = query.is("deleted_at", null);
  if (company) query = query.eq("company_id", company);
  if (status) query = query.eq("employment_status", status);
  if (q) {
    // Two ilike columns via .or() — the search text itself is stripped of
    // the characters PostgREST's filter mini-language treats specially
    // (`,()`) first, so a name containing one can never be read as filter
    // syntax instead of a literal value.
    const safeQ = q.replace(/[,()]/g, "");
    query = query.or(`first_name.ilike.%${safeQ}%,last_name.ilike.%${safeQ}%,personal_email.ilike.%${safeQ}%`);
  }
  query = query.range(offset, offset + PAGE_SIZE - 1);

  const { data: employees, count } = await query;
  const totalPages = count ? Math.max(1, Math.ceil(count / PAGE_SIZE)) : 1;

  function pageHref(overrides: Partial<EmployeesSearchParams>) {
    const merged: EmployeesSearchParams = { deleted: params.deleted, q, company, status, page: String(page), ...overrides };
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `/employees?${qs}` : "/employees";
  }

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
            <Link href={pageHref({ deleted: showDeleted ? undefined : "1", page: "1" })} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
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
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {showDeleted ? <input type="hidden" name="deleted" value="1" /> : null}
            <div className="space-y-1.5">
              <Label htmlFor="q">Search</Label>
              <Input id="q" name="q" placeholder="Name or email" defaultValue={q} />
            </div>
            {companies && companies.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="company">Company</Label>
                <Select id="company" name="company" defaultValue={company}>
                  <option value="">All</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.legal_name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={status}>
                <option value="">All</option>
                {STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
                Apply filters
              </button>
              <Link href={pageHref({ q: undefined, company: undefined, status: undefined, page: "1" })} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Reset filters
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {showDeleted ? "All employees (including deleted)" : "Active employees"}
            {count != null ? ` (${count} total)` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
                  <TableCell colSpan={4}>
                    <EmptyState
                      dense
                      title="No employees match these filters."
                      description={q || company || status ? "Try clearing a filter." : "No employees to show."}
                    />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Link
                href={pageHref({ page: String(Math.max(1, page - 1)) })}
                aria-disabled={page <= 1}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "pointer-events-none opacity-50")}
              >
                Previous
              </Link>
              <Link
                href={pageHref({ page: String(Math.min(totalPages, page + 1)) })}
                aria-disabled={page >= totalPages}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= totalPages && "pointer-events-none opacity-50")}
              >
                Next
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
