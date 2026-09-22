"use client";

import { useState, useTransition } from "react";
import { bulkRecordAttendance } from "@/lib/actions/attendance";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

interface Row {
  employeeId: string;
  name: string;
  status: string;
  hoursWorked: string | null;
}

export function BulkAttendanceForm({ workDate, rows, isRecoveryDay }: { workDate: string; rows: Row[]; isRecoveryDay: boolean }) {
  const [edits, setEdits] = useState(() => new Map(rows.map((r) => [r.employeeId, { status: r.status, hoursWorked: r.hoursWorked ?? "" }])));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null; creditedCount: number } | null>(null);

  function updateRow(employeeId: string, patch: Partial<{ status: string; hoursWorked: string }>) {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(employeeId, { ...next.get(employeeId)!, ...patch });
      return next;
    });
  }

  function handleSave() {
    startTransition(async () => {
      const outcome = await bulkRecordAttendance({
        workDate,
        rows: rows.map((r) => {
          const edit = edits.get(r.employeeId)!;
          return {
            employeeId: r.employeeId,
            status: edit.status,
            hoursWorked: edit.hoursWorked === "" ? undefined : Number(edit.hoursWorked),
            isRecoveryEligible: isRecoveryDay && edit.status === "present",
          };
        }),
      });
      setResult(outcome);
    });
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Hours</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const edit = edits.get(r.employeeId)!;
            const earnsRecoveryDay = isRecoveryDay && edit.status === "present";
            return (
              <TableRow key={r.employeeId}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>
                  <Select
                    value={edit.status}
                    onChange={(e) => updateRow(r.employeeId, { status: e.target.value })}
                    className="h-8 w-36 text-xs"
                  >
                    <option value="present">Present</option>
                    <option value="absent">Absent</option>
                    <option value="leave">Leave</option>
                    <option value="holiday">Holiday</option>
                    <option value="weekend">Weekend</option>
                  </Select>
                </TableCell>
                <TableCell>
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
                <TableCell>{earnsRecoveryDay ? <Badge variant="secondary">+1 comp day</Badge> : null}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {result?.error ? <Alert variant="destructive">{result.error}</Alert> : null}
      {result && !result.error ? (
        <Alert variant="success">
          Saved.{result.creditedCount > 0 ? ` ${result.creditedCount} comp day(s) credited.` : ""}
        </Alert>
      ) : null}

      <Button type="button" onClick={handleSave} disabled={pending}>
        {pending ? "Saving…" : "Save all"}
      </Button>
    </div>
  );
}
