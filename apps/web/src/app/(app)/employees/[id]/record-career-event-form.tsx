"use client";

import { useActionState, useState } from "react";
import { recordCareerEvent } from "@/lib/actions/employees";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function RecordCareerEventForm({
  employeeId,
  currentJobTitle,
  currentBasicSalary,
  currentOtherAllowance,
}: {
  employeeId: string;
  currentJobTitle: string | null;
  currentBasicSalary: number | null;
  currentOtherAllowance: number;
}) {
  const [state, formAction, pending] = useActionState(recordCareerEvent, initialState);
  const [basicSalary, setBasicSalary] = useState("");
  const [otherAllowance, setOtherAllowance] = useState("");
  const total = (Number(basicSalary) || 0) + (Number(otherAllowance) || 0);

  return (
    <form action={formAction} className="space-y-3 border-t border-border pt-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <p className="text-sm font-medium">Record a promotion, title change, or salary change</p>
      <p className="text-xs text-muted-foreground">
        Fill in whichever applies — a new title alone, a new salary alone, or both together for a promotion. Leave blank
        anything that isn&apos;t changing.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="effectiveDate">Effective date</Label>
        <Input id="effectiveDate" name="effectiveDate" type="date" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="newJobTitle">New job title</Label>
        <Input id="newJobTitle" name="newJobTitle" placeholder={currentJobTitle ?? "e.g. Senior Engineer"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="newBasicSalary">New basic salary</Label>
          <Input
            id="newBasicSalary"
            name="newBasicSalary"
            type="number"
            step="0.01"
            min="0"
            placeholder={currentBasicSalary?.toString() ?? "0"}
            value={basicSalary}
            onChange={(e) => setBasicSalary(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newOtherAllowance">New others</Label>
          <Input
            id="newOtherAllowance"
            name="newOtherAllowance"
            type="number"
            step="0.01"
            min="0"
            placeholder={currentOtherAllowance.toString()}
            value={otherAllowance}
            onChange={(e) => setOtherAllowance(e.target.value)}
          />
        </div>
      </div>
      {basicSalary || otherAllowance ? (
        <p className="text-sm text-muted-foreground">
          New total: <span className="font-medium text-foreground">{total.toFixed(2)}</span>
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="note">Note (optional)</Label>
        <Input id="note" name="note" placeholder="e.g. Annual increment, promoted to team lead" />
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Record event"}
      </Button>
    </form>
  );
}
