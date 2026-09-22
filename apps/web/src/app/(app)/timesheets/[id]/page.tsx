import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AddEntryForm } from "./add-entry-form";
import { DeleteEntryButton } from "./delete-entry-button";
import { TimesheetActions } from "./timesheet-actions";

export default async function TimesheetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: timesheet } = await supabase
    .from("timesheets")
    .select("id, employee_id, period_start, period_end, status")
    .eq("id", id)
    .maybeSingle();
  if (!timesheet) notFound();

  const [{ data: entries }, { data: employee }] = await Promise.all([
    supabase
      .from("timesheet_entries")
      .select("id, work_date, project_id, task_description, hours, is_billable")
      .eq("timesheet_id", id)
      .order("work_date"),
    supabase.from("employees").select("company_id").eq("id", timesheet.employee_id).single(),
  ]);

  const projectIds = [...new Set((entries ?? []).map((e) => e.project_id).filter(Boolean))] as string[];
  const [{ data: projects }, { data: availableProjects }] = await Promise.all([
    projectIds.length > 0 ? supabase.from("projects").select("id, name").in("id", projectIds) : Promise.resolve({ data: [] as never[] }),
    employee
      ? supabase.from("projects").select("id, name").eq("company_id", employee.company_id).eq("is_active", true).order("name")
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const totalHours = (entries ?? []).reduce((sum, e) => sum + Number(e.hours), 0);

  const isOwner = timesheet.employee_id === session.employeeId;
  const isDraft = timesheet.status === "draft";
  const isCancellable = timesheet.status === "submitted" || timesheet.status === "pending_approval";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Timesheet — {timesheet.period_start} to {timesheet.period_end}
          </h1>
          <p className="text-muted-foreground">{totalHours} hours logged</p>
        </div>
        <Badge>{timesheet.status.replace(/_/g, " ")}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Billable</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(entries ?? []).map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.work_date}</TableCell>
                  <TableCell>{entry.project_id ? (projectName.get(entry.project_id) ?? "—") : "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{entry.task_description ?? "—"}</TableCell>
                  <TableCell>{entry.hours}</TableCell>
                  <TableCell>{entry.is_billable ? "Yes" : "No"}</TableCell>
                  <TableCell>{isOwner && isDraft ? <DeleteEntryButton entryId={entry.id} timesheetId={timesheet.id} /> : null}</TableCell>
                </TableRow>
              ))}
              {(entries ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No entries yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isOwner && isDraft ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Add an entry</CardTitle>
          </CardHeader>
          <CardContent>
            <AddEntryForm timesheetId={timesheet.id} projects={availableProjects ?? []} />
          </CardContent>
        </Card>
      ) : null}

      {isOwner && (isDraft || isCancellable) ? (
        <TimesheetActions timesheetId={timesheet.id} isDraft={isDraft} isCancellable={isCancellable} />
      ) : null}
    </div>
  );
}
