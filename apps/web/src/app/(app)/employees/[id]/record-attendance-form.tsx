"use client";

import { useActionState, useRef } from "react";
import { recordAttendance } from "@/lib/actions/attendance";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function RecordAttendanceForm({ employeeId }: { employeeId: string }) {
  const [state, formAction, pending] = useActionState(recordAttendance, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        formAction(formData);
        formRef.current?.reset();
      }}
      className="space-y-4"
    >
      <input type="hidden" name="employeeId" value={employeeId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="workDate">Date</Label>
          <Input id="workDate" name="workDate" type="date" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue="present">
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="leave">Leave</option>
            <option value="holiday">Holiday</option>
            <option value="weekend">Weekend</option>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="clockIn">Clock in (optional)</Label>
          <Input id="clockIn" name="clockIn" type="time" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clockOut">Clock out (optional)</Label>
          <Input id="clockOut" name="clockOut" type="time" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hoursWorked">Hours worked (optional)</Label>
          <Input id="hoursWorked" name="hoursWorked" type="number" step="0.25" min="0" max="24" />
        </div>
      </div>

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <p className="text-xs text-muted-foreground">Re-entering a date already on record corrects it in place.</p>
    </form>
  );
}
