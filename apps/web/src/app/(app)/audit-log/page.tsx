import { canViewAuditLog, isSysAdmin } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";

export default async function AuditLogPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  if (!canViewAuditLog(session.grants)) {
    return <Alert variant="destructive">The audit log is restricted to HR Admin and System Administrator.</Alert>;
  }

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, table_name, record_id, action, actor_id, actor_role, company_id, occurred_at, is_ai_generated")
    .order("occurred_at", { ascending: false })
    .limit(200);

  const scopeLabel = isSysAdmin(session.grants) ? "System-scoped entries (companies, user roles) across the platform." : "HR-content entries for your own company.";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-muted-foreground">{scopeLabel} Most recent 200 entries.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor role</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.occurred_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{r.table_name}</TableCell>
                  <TableCell className="capitalize">{r.action}</TableCell>
                  <TableCell>{r.actor_role ?? "—"}</TableCell>
                  <TableCell>{r.is_ai_generated ? <Badge variant="secondary">AI</Badge> : <Badge variant="outline">Human</Badge>}</TableCell>
                </TableRow>
              ))}
              {(rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No activity recorded yet.
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
