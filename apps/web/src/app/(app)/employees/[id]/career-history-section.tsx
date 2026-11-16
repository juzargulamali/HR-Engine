import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { isHeld, type CareerEventRow } from "@/lib/hr/changes";
import { CancelChangeButton } from "./cancel-change-button";

const EVENT_LABEL: Record<string, string> = { promotion: "Promotion", title_change: "Title change", salary_change: "Salary change" };
const EVENT_VARIANT: Record<string, "default" | "secondary" | "outline"> = { promotion: "default", title_change: "secondary", salary_change: "outline" };
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function what(e: CareerEventRow) {
  const parts: string[] = [];
  if (e.new_job_title) parts.push(`Job title: ${e.previous_job_title ?? "none"} → ${e.new_job_title}`);
  if (e.new_base_salary != null) parts.push(`Basic salary: ${e.previous_base_salary ?? "none"} → ${e.new_base_salary}${e.currency ? ` ${e.currency}` : ""}`);
  return parts;
}

/**
 * Changes recorded for a later date: saved, but NOT in force yet. Each says when it will take effect. One the daily job held back (pay changed after it was scheduled) says so, with the reason,
 * and stays here for HR to review; an HR Admin can cancel any of them (`employeeId` is given only to someone who may).
 */
export function ScheduledChanges({ events, employeeId }: { events: CareerEventRow[]; employeeId?: string }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground" data-testid="scheduled-empty">No changes are scheduled.</p>;
  return (
    <ul className="divide-y divide-border" data-testid="scheduled-changes">
      {events.map((e) => (
        <li key={e.id} className="space-y-1 py-3 first:pt-0 last:pb-0" data-testid={`scheduled-${e.id}`}>
          <p className="font-medium">Takes effect on {longDate(e.effective_date)} <Badge variant="outline" className="ml-1 align-middle">Not in force yet</Badge>{isHeld(e) ? <Badge variant="destructive" className="ml-1 align-middle">Held for review</Badge> : null}</p>
          {what(e).map((line) => <p key={line} className="text-sm">{line}</p>)}
          {e.note ? <p className="text-sm text-muted-foreground">{e.note}</p> : null}
          {isHeld(e) ? (
            <p className="text-sm text-destructive" data-testid={`held-${e.id}`}>
              Held for review: {e.conflict_reason} Nothing was changed. Cancel it and record the change again from today&apos;s pay if it is still wanted.
            </p>
          ) : null}
          {employeeId ? <CancelChangeButton employeeId={employeeId} eventId={e.id} held={isHeld(e)} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Changes already in force, newest first. Existing records from before scheduling existed all read as applied. */
export function ChangeHistory({ events }: { events: CareerEventRow[] }) {
  return (
    <Table stack>
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
        {events.map((e) => (
          <TableRow key={e.id}>
            <TableCell>{e.effective_date}</TableCell>
            <TableCell>
              {/* One group, so on a phone the badges wrap onto their own line instead of widening the stacked row past its card. */}
              <span className="flex min-w-0 flex-wrap items-center justify-end gap-1 md:justify-start">
                <Badge variant={EVENT_VARIANT[e.event_type] ?? "outline"}>{EVENT_LABEL[e.event_type] ?? e.event_type}</Badge>
                {e.dismissed_at ? <Badge variant="outline">Cancelled, never applied</Badge> : null}
              </span>
            </TableCell>
            <TableCell className="text-sm">{e.new_job_title ? <>{e.previous_job_title ?? "—"} → <span className="font-medium">{e.new_job_title}</span></> : "—"}</TableCell>
            <TableCell className="text-sm">{e.new_base_salary != null ? <>{e.previous_base_salary ?? "—"} → <span className="font-medium">{e.new_base_salary}</span> {e.currency}</> : "—"}</TableCell>
            <TableCell className="text-muted-foreground">{e.note ?? "—"}</TableCell>
          </TableRow>
        ))}
        {events.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5}><EmptyState dense title="No promotions, title changes, or salary changes recorded yet." /></TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
