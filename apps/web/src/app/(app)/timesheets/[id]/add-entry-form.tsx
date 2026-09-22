"use client";

import { useActionState, useRef } from "react";
import { addTimesheetEntry } from "@/lib/actions/timesheets";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AddEntryForm({ timesheetId, projects }: { timesheetId: string; projects: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(addTimesheetEntry, initialState);
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
      <input type="hidden" name="timesheetId" value={timesheetId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="workDate">Date</Label>
          <Input id="workDate" name="workDate" type="date" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hours">Hours</Label>
          <Input id="hours" name="hours" type="number" step="0.25" min="0.25" max="24" required />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="projectId">Project (optional)</Label>
          <Select id="projectId" name="projectId" defaultValue="">
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="isBillable">Billable</Label>
          <Select id="isBillable" name="isBillable" defaultValue="true">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="taskDescription">Task (optional)</Label>
        <Input id="taskDescription" name="taskDescription" />
      </div>

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add entry"}
      </Button>
    </form>
  );
}
