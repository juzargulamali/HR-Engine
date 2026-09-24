"use client";

import { useActionState } from "react";
import { setTerminationSettlementRate } from "@/lib/actions/employees";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

/** HR/Finance-only (enforced by termination_settlement_inputs_write RLS) input for the statutory leave-encashment wage basis — see final-settlement-section.tsx. */
export function SettlementRateForm({ employeeId }: { employeeId: string }) {
  const [state, formAction, pending] = useActionState(setTerminationSettlementRate, initialState);

  return (
    <form action={formAction} className="max-w-sm space-y-3 rounded-md border border-border p-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="space-y-1.5">
        <Label htmlFor="leaveEncashmentDailyRate">Statutory leave-encashment daily rate</Label>
        <Input id="leaveEncashmentDailyRate" name="leaveEncashmentDailyRate" type="number" step="0.01" min="0.01" required />
        <p className="text-xs text-muted-foreground">
          The per-day figure required by local law for this settlement (not necessarily basic salary ÷ 30).
        </p>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save rate"}
      </Button>
    </form>
  );
}
