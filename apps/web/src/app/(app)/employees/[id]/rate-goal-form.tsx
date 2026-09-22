"use client";

import { useActionState } from "react";
import { rateGoal } from "@/lib/actions/performance";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const initialState: ActionState = { error: null };

export function RateGoalForm({ goalId, managerRating }: { goalId: string; managerRating: number | null }) {
  const [state, formAction, pending] = useActionState(rateGoal, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="goalId" value={goalId} />
      <Select name="managerRating" defaultValue={managerRating?.toString() ?? ""} className="h-8 w-20 text-xs">
        <option value="" disabled>
          Rate
        </option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
