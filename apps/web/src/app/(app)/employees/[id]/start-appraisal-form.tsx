"use client";

import { useActionState } from "react";
import { createAppraisal } from "@/lib/actions/performance";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function StartAppraisalForm({ employeeId, cycles }: { employeeId: string; cycles: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createAppraisal, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <Select name="cycleId" defaultValue={cycles[0]?.id} className="h-9 w-48">
        {cycles.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Starting…" : "Start appraisal"}
      </Button>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
    </form>
  );
}
