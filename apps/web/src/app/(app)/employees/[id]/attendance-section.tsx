import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RecordAttendanceForm } from "./record-attendance-form";
import { DeleteAttendanceButton } from "./delete-attendance-button";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  present: "default",
  absent: "destructive",
  leave: "secondary",
  holiday: "outline",
  weekend: "outline",
};

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export async function AttendanceSection({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const supabase = await createClient();
  const { data: records } = await supabase
    .from("attendance_records")
    .select("id, work_date, clock_in, clock_out, hours_worked, status, source")
    .eq("employee_id", employeeId)
    .order("work_date", { ascending: false })
    .limit(30);

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Clock in</TableHead>
            <TableHead>Clock out</TableHead>
            <TableHead>Hours</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(records ?? []).map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.work_date}</TableCell>
              <TableCell>{formatTime(r.clock_in)}</TableCell>
              <TableCell>{formatTime(r.clock_out)}</TableCell>
              <TableCell>{r.hours_worked ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge>
              </TableCell>
              <TableCell>{canManage ? <DeleteAttendanceButton recordId={r.id} employeeId={employeeId} /> : null}</TableCell>
            </TableRow>
          ))}
          {(records ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No attendance recorded yet.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {canManage ? (
        <div className="border-t border-border pt-4">
          <RecordAttendanceForm employeeId={employeeId} />
        </div>
      ) : null}
    </div>
  );
}
