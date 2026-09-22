import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewTimesheetForm } from "./new-timesheet-form";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  submitted: "secondary",
  pending_approval: "secondary",
  approved: "default",
  rejected: "destructive",
  cancelled: "outline",
};

export default async function TimesheetsPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  if (!session.employeeId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Timesheets</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          No employee record is linked to your account yet — nothing to show here.
        </CardContent>
      </Card>
    );
  }

  const supabase = await createClient();
  const { data: timesheets } = await supabase
    .from("timesheets")
    .select("id, period_start, period_end, status")
    .eq("employee_id", session.employeeId)
    .order("period_start", { ascending: false });

  const timesheetIds = (timesheets ?? []).map((t) => t.id);
  const { data: entries } =
    timesheetIds.length > 0 ? await supabase.from("timesheet_entries").select("timesheet_id, hours").in("timesheet_id", timesheetIds) : { data: [] as never[] };
  const hoursByTimesheet = new Map<string, number>();
  for (const e of entries ?? []) {
    hoursByTimesheet.set(e.timesheet_id, (hoursByTimesheet.get(e.timesheet_id) ?? 0) + Number(e.hours));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My Timesheets</h1>
        <p className="text-muted-foreground">Log hours for a period and submit them for approval.</p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Start a new timesheet</CardTitle>
        </CardHeader>
        <CardContent>
          <NewTimesheetForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My timesheets</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(timesheets ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/timesheets/${t.id}`} className="hover:underline">
                      {t.period_start} – {t.period_end}
                    </Link>
                  </TableCell>
                  <TableCell>{hoursByTimesheet.get(t.id) ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>{t.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(timesheets ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No timesheets yet.
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
