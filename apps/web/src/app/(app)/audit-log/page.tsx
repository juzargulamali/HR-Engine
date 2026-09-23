import Link from "next/link";
import { ROLE_LABELS, canViewAuditLog, isSysAdmin } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

// Mirrors audit_log_select_hr / audit_log_select_sysadmin in schema.sql
// exactly — this only shapes which options the filter dropdown offers;
// RLS (not this list) is what actually restricts what a query can return.
const HR_CONTENT_TABLES = [
  "employees",
  "compensation_details",
  "employment_contracts",
  "leave_requests",
  "leave_ledger",
  "comp_day_ledger",
  "approvals",
  "reimbursement_claims",
  "timesheets",
  "payroll_export_runs",
  "generated_letters",
];
const SYSTEM_TABLES = ["companies", "user_roles"];

interface AuditLogSearchParams {
  page?: string;
  table?: string;
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<AuditLogSearchParams> }) {
  const params = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;

  if (!canViewAuditLog(session.grants)) {
    return <Alert variant="destructive">The audit log is restricted to HR Admin and System Administrator.</Alert>;
  }

  const supabase = await createClient();
  const sysAdmin = isSysAdmin(session.grants);
  const availableTables = sysAdmin ? SYSTEM_TABLES : HR_CONTENT_TABLES;

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Actor is a free-text name/email search rather than a dropdown — the
  // audit log spans every user who's ever acted, so resolving it via a
  // small profiles lookup (only when a filter is actually typed) stays a
  // lot lighter than loading every profile into a picker up front.
  let actorIds: string[] | null = null;
  if (params.actor) {
    // Two separate parameterized ilike() calls rather than one .or() with
    // the search text interpolated into the filter string — PostgREST's
    // .or() syntax treats commas/parens/dots in that string as its own
    // mini-language, so building it from unescaped user input is a filter-
    // injection risk even though it's HR-Admin/Sys-Admin-only.
    const pattern = `%${params.actor}%`;
    const [{ data: byEmail }, { data: byName }] = await Promise.all([
      supabase.from("profiles").select("id").ilike("email", pattern),
      supabase.from("profiles").select("id").ilike("full_name", pattern),
    ]);
    actorIds = [...new Set([...(byEmail ?? []), ...(byName ?? [])].map((m) => m.id))];
    if (actorIds.length === 0) actorIds = ["00000000-0000-0000-0000-000000000000"];
  }

  let query = supabase
    .from("audit_log")
    .select("id, table_name, record_id, action, actor_id, actor_role, actor_roles, company_id, occurred_at, is_ai_generated", {
      count: "exact",
    })
    .order("occurred_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (params.table) query = query.eq("table_name", params.table);
  if (params.action) query = query.eq("action", params.action);
  if (actorIds) query = query.in("actor_id", actorIds);
  if (params.from) query = query.gte("occurred_at", params.from);
  if (params.to) query = query.lte("occurred_at", `${params.to}T23:59:59.999Z`);

  const { data: rows, count } = await query;

  const actorIdsOnPage = [...new Set((rows ?? []).map((r) => r.actor_id).filter((id): id is string => !!id))];
  const { data: actorProfiles } = actorIdsOnPage.length
    ? await supabase.from("profiles").select("id, email, full_name").in("id", actorIdsOnPage)
    : { data: [] as { id: string; email: string; full_name: string | null }[] };
  const actorLabel = new Map((actorProfiles ?? []).map((p) => [p.id, p.full_name ?? p.email]));

  const totalPages = count ? Math.max(1, Math.ceil(count / PAGE_SIZE)) : 1;

  function pageHref(overrides: Partial<AuditLogSearchParams>) {
    const merged: AuditLogSearchParams = { ...params, ...overrides };
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `/audit-log?${qs}` : "/audit-log";
  }

  const scopeLabel = sysAdmin
    ? "System-scoped entries (companies, user roles) across the platform."
    : "HR-content entries for your own company.";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-muted-foreground">{scopeLabel}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="table">Table</Label>
              <Select id="table" name="table" defaultValue={params.table ?? ""}>
                <option value="">All</option>
                {availableTables.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="action">Action</Label>
              <Select id="action" name="action" defaultValue={params.action ?? ""}>
                <option value="">All</option>
                <option value="insert">Insert</option>
                <option value="update">Update</option>
                <option value="delete">Delete</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="actor">Actor (name or email)</Label>
              <Input id="actor" name="actor" defaultValue={params.actor ?? ""} placeholder="jane@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={params.from ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={params.to ?? ""} />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
              <Button type="submit" size="sm">
                Apply filters
              </Button>
              <Link href="/audit-log" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Clear
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity{count != null ? ` (${count} total)` : ""}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Entity ID</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Actor role(s)</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.occurred_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{r.table_name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.record_id ? `${r.record_id.slice(0, 8)}…` : "—"}</TableCell>
                  <TableCell className="capitalize">{r.action}</TableCell>
                  <TableCell>{r.actor_id ? (actorLabel.get(r.actor_id) ?? r.actor_id) : "System"}</TableCell>
                  <TableCell>
                    {r.actor_roles && r.actor_roles.length > 0
                      ? r.actor_roles.map((role) => ROLE_LABELS[role]).join(", ")
                      : r.actor_role
                        ? ROLE_LABELS[r.actor_role]
                        : "—"}
                  </TableCell>
                  <TableCell>
                    {r.is_ai_generated ? <Badge variant="secondary">AI</Badge> : <Badge variant="outline">Human</Badge>}
                  </TableCell>
                </TableRow>
              ))}
              {(rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No activity matches these filters.
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
