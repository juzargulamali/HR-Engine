"use client";

import { useActionState } from "react";
import { addCompensationVersion } from "@/lib/actions/employees";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AddCompensationForm({
  employeeId,
  currentCompensationId,
}: {
  employeeId: string;
  currentCompensationId: string | null;
}) {
  const [state, formAction, pending] = useActionState(addCompensationVersion, initialState);

  return (
    <form action={formAction} className="space-y-3 border-t border-border pt-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="currentCompensationId" value={currentCompensationId ?? ""} />
      <p className="text-sm font-medium">Record a new compensation version</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="effectiveFrom">Effective from</Label>
          <Input id="effectiveFrom" name="effectiveFrom" type="date" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="baseSalary">Base salary</Label>
          <Input id="baseSalary" name="baseSalary" type="number" step="0.01" min="0" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" maxLength={3} placeholder="AED" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bankIban">Bank IBAN (optional)</Label>
        <Input id="bankIban" name="bankIban" />
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save new version"}
      </Button>
    </form>
  );
}
