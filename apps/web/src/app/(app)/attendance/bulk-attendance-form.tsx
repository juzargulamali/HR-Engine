"use client";

import { useState, useTransition } from "react";
import { bulkRecordAttendance } from "@/lib/actions/attendance";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface Row {
  employeeId: string;
  name: string;
  status: string;
  workMode: string | null;
  hoursWorked: string | null;
  /** True while this employee is still clocked in (self-clock, hours not
   * final yet) for this day — see sync_attendance_presence_for_day() in
   * schema.sql. Shown instead of a blank Hours cell; HR can still type a
   * value here to override it. */
  isClockedIn: boolean;
  /** Set when self-clock activity exists for this day but a manual/import/
   * biometric entry already recorded something else — self-clock never
   * overwrote it, this just surfaces that for HR to review and reconcile
   * (saving this row, as normal, clears it). */
  presenceConflict: string | null;
}

export function BulkAttendanceForm({ workDate, rows, isRecoveryDay }: { workDate: string; rows: Row[]; isRecoveryDay: boolean }) {
  const [edits, setEdits] = useState(
    () => new Map(rows.map((r) => [r.employeeId, { status: r.status, workMode: r.workMode ?? "", hoursWorked: r.hoursWorked ?? "" }])),
  );
  // Which employees the admin actually touched this session — Save All only
  // sends these, never every row in the register. Without this, opening a
  // day and clicking Save without changing anything wrote a 'not_recorded'
  // attendance_records row for every single employee, even ones nobody
  // looked at, contradicting the "not recorded" default's own meaning
  // (no row at all).
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null; creditedCount: number } | null>(null);

  function updateRow(employeeId: string, patch: Partial<{ status: string; workMode: string; hoursWorked: string }>) {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(employeeId, { ...next.get(employeeId)!, ...patch });
      return next;
    });
    setTouched((prev) => new Set(prev).add(employeeId));
  }

  function handleSave() {
    const touchedRows = rows.filter((r) => touched.has(r.employeeId));
    if (touchedRows.length === 0) {
      setResult({ error: "Nothing to save — no rows were changed.", creditedCount: 0 });
      return;
    }

    startTransition(async () => {
      // isRecoveryDay is only ever used here to explain the badge in the
      // table below — record_attendance_and_recovery() re-derives whether
      // today is actually a recovery day (and whether a status of
      // 'present' on it actually earns anything, per policy) itself; this
      // form never asserts either one.
      const outcome = await bulkRecordAttendance({
        workDate,
        rows: touchedRows.map((r) => {
          const edit = edits.get(r.employeeId)!;
          return {
            employeeId: r.employeeId,
            status: edit.status,
            workMode: edit.workMode === "" ? undefined : edit.workMode,
            hoursWorked: edit.hoursWorked === "" ? undefined : Number(edit.hoursWorked),
          };
        }),
      });
      setResult(outcome);
      if (!outcome.error) setTouched(new Set());
    });
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Work mode</TableHead>
            <TableHead>Hours</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const edit = edits.get(r.employeeId)!;
            return (
              <TableRow key={r.employeeId}>
                <TableCell className="font-medium">
                  {r.name}
                  {r.presenceConflict ? (
                    <span
                      title={r.presenceConflict}
                      className="ml-1.5 inline-flex cursor-help items-center text-warning"
                      aria-label={`Presence conflict: ${r.presenceConflict}`}
                    >
                      ⚠
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Select
                    value={edit.status}
                    onChange={(e) => updateRow(r.employeeId, { status: e.target.value })}
                    className="h-8 w-36 text-xs"
                  >
                    <option value="not_recorded">Not recorded</option>
                    <option value="present">Present</option>
                    <option value="absent">Absent</option>
                    <option value="leave">Leave</option>
                    <option value="partial_day">Partial day</option>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={edit.workMode}
                    onChange={(e) => updateRow(r.employeeId, { workMode: e.target.value })}
                    className="h-8 w-36 text-xs"
                  >
                    <option value="">—</option>
                    <option value="office">Office</option>
                    <option value="client_site">Client site</option>
                    <option value="work_from_home">Work from home</option>
                    <option value="field_work">Field work</option>
                    <option value="business_travel">Business travel</option>
                  </Select>
                </TableCell>
                <TableCell>
                  {r.isClockedIn && edit.hoursWorked === "" ? (
                    <Badge variant="success" className="mb-1">
                      Clocked in{r.workMode ? ` — ${r.workMode}` : ""}
                    </Badge>
                  ) : null}
                  <Input
                    type="number"
                    step="0.25"
                    min="0"
                    max="24"
                    value={edit.hoursWorked}
                    onChange={(e) => updateRow(r.employeeId, { hoursWorked: e.target.value })}
                    className="h-8 w-20 text-xs"
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {isRecoveryDay ? (
        <p className="text-xs text-muted-foreground">
          Anyone marked Present today may earn a recovery day, per your country&apos;s policy — the exact credit (or
          whether one applies at all) is decided when you save, not shown here in advance.
        </p>
      ) : null}

      {result?.error ? <Alert variant="destructive">{result.error}</Alert> : null}
      {result && !result.error ? (
        <Alert variant="success">
          Saved.{result.creditedCount > 0 ? ` ${result.creditedCount} recovery credit request(s) submitted for approval.` : ""}
        </Alert>
      ) : null}

      <Button type="button" onClick={handleSave} disabled={pending}>
        {pending ? "Saving…" : "Save all"}
      </Button>
    </div>
  );
}
