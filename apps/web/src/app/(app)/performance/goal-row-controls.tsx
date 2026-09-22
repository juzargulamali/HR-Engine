"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { deleteGoal, updateGoal } from "@/lib/actions/performance";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const initialState: ActionState = { error: null };

export function GoalRowControls({
  goalId,
  status,
  selfRating,
}: {
  goalId: string;
  status: string;
  selfRating: number | null;
}) {
  const [state, formAction, pending] = useActionState(updateGoal, initialState);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="goalId" value={goalId} />
        <Select name="status" defaultValue={status} className="h-8 w-32 text-xs">
          <option value="in_progress">In progress</option>
          <option value="achieved">Achieved</option>
          <option value="missed">Missed</option>
        </Select>
        <Select name="selfRating" defaultValue={selfRating?.toString() ?? ""} className="h-8 w-20 text-xs">
          <option value="">Rate</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
      <Button
        size="sm"
        variant="outline"
        disabled={deletePending}
        onClick={() => {
          if (!window.confirm("Remove this goal?")) return;
          startDelete(async () => {
            const result = await deleteGoal(goalId);
            setDeleteError(result.error);
          });
        }}
      >
        {deletePending ? "Removing…" : "Remove"}
      </Button>
      {state.error ? <p className="w-full text-xs text-destructive">{state.error}</p> : null}
      {deleteError ? <p className="w-full text-xs text-destructive">{deleteError}</p> : null}
    </div>
  );
}
