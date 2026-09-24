import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RecordCareerEventForm } from "./record-career-event-form";
import { EmptyState } from "@/components/ui/empty-state";

const EVENT_LABEL: Record<string, string> = {
  promotion: "Promotion",
  title_change: "Title change",
  salary_change: "Salary change",
};

const EVENT_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  promotion: "default",
  title_change: "secondary",
  salary_change: "outline",
};

export async function CareerHistorySection({
  employeeId,
  canView,
  canRecord,
}: {
  employeeId: string;
  canView: boolean;
  canRecord: boolean;
}) {
  if (!canView) return null;

  const supabase = await createClient();
  const [{ data: events }, { data: employee }, { data: currentComp }] = await Promise.all([
    supabase
      .from("employee_career_events")
      .select(
        "id, event_type, effective_date, previous_job_title, new_job_title, previous_base_salary, new_base_salary, currency, note",
      )
      .eq("employee_id", employeeId)
      .order("effective_date", { ascending: false }),
    supabase.from("employees").select("job_title").eq("id", employeeId).single(),
    supabase.from("compensation_details").select("base_salary, allowances").eq("employee_id", employeeId).eq("is_current", true).maybeSingle(),
  ]);

  const currentOther = typeof currentComp?.allowances?.other === "number" ? currentComp.allowances.other : 0;

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Salary</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(events ?? []).map((e) => (
            <TableRow key={e.id}>
              <TableCell>{e.effective_date}</TableCell>
              <TableCell>
                <Badge variant={EVENT_VARIANT[e.event_type] ?? "outline"}>{EVENT_LABEL[e.event_type] ?? e.event_type}</Badge>
              </TableCell>
              <TableCell className="text-sm">
                {e.new_job_title ? (
                  <>
                    {e.previous_job_title ?? "—"} → <span className="font-medium">{e.new_job_title}</span>
                  </>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-sm">
                {e.new_base_salary != null ? (
                  <>
                    {e.previous_base_salary ?? "—"} → <span className="font-medium">{e.new_base_salary}</span> {e.currency}
                  </>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{e.note ?? "—"}</TableCell>
            </TableRow>
          ))}
          {(events ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={5}>
                <EmptyState dense title="No promotions, title changes, or salary changes recorded yet." />
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {canRecord ? (
        <RecordCareerEventForm
          employeeId={employeeId}
          currentJobTitle={employee?.job_title ?? null}
          currentBasicSalary={currentComp ? Number(currentComp.base_salary) : null}
          currentOtherAllowance={currentOther}
        />
      ) : null}
    </div>
  );
}
