"use client";

import { useActionState } from "react";
import { addProjectAllocation } from "@/lib/actions/projects";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AddAllocationForm({
  projectId,
  employees,
}: {
  projectId: string;
  employees: { id: string; first_name: string; last_name: string }[];
}) {
  const [state, formAction, pending] = useActionState(addProjectAllocation, initialState);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="space-y-1.5">
        <Label htmlFor="employeeId">Employee</Label>
        <Select id="employeeId" name="employeeId" defaultValue={employees[0]?.id ?? ""} required>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.first_name} {e.last_name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="allocationPercent">Allocation %</Label>
        <Input id="allocationPercent" name="allocationPercent" type="number" min="0" max="100" defaultValue="100" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="startDate">Start date</Label>
        <Input id="startDate" name="startDate" type="date" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="endDate">End date (optional)</Label>
        <Input id="endDate" name="endDate" type="date" />
      </div>
      <Button type="submit" size="sm" disabled={pending || employees.length === 0}>
        {pending ? "Adding…" : "Add"}
      </Button>
      {state.error ? (
        <Alert variant="destructive" className="sm:col-span-5">
          {state.error}
        </Alert>
      ) : null}
    </form>
  );
}
