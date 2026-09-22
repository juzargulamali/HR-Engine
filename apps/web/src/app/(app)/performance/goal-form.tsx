"use client";

import { useActionState, useRef } from "react";
import { createGoal } from "@/lib/actions/performance";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function GoalForm({ cycles }: { cycles: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createGoal, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  if (cycles.length === 0) {
    return <p className="text-sm text-muted-foreground">No open performance cycle yet — ask HR to start one.</p>;
  }

  return (
    <form
      ref={formRef}
      action={(formData) => {
        formAction(formData);
        formRef.current?.reset();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cycleId">Cycle</Label>
          <Select id="cycleId" name="cycleId" defaultValue={cycles[0]?.id}>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="title">Goal title</Label>
          <Input id="title" name="title" required />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Input id="description" name="description" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="weightPercent">Weight % (optional)</Label>
          <Input id="weightPercent" name="weightPercent" type="number" step="1" min="0" max="100" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="targetDate">Target date (optional)</Label>
          <Input id="targetDate" name="targetDate" type="date" />
        </div>
      </div>

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add goal"}
      </Button>
    </form>
  );
}
