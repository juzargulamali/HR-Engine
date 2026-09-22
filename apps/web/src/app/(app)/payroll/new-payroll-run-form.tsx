"use client";

import { useActionState } from "react";
import { createPayrollRun } from "@/lib/actions/payroll";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function NewPayrollRunForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState(createPayrollRun, initialState);
  const now = new Date();

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="periodMonth">Month</Label>
          <Input id="periodMonth" name="periodMonth" type="number" min={1} max={12} defaultValue={now.getMonth() + 1} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="periodYear">Year</Label>
          <Input id="periodYear" name="periodYear" type="number" min={2020} max={2100} defaultValue={now.getFullYear()} required />
        </div>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Generating…" : "Generate lines"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Aggregates approved reimbursements and leave encashments for the period. You&apos;ll review the lines before
        submitting for approval.
      </p>
    </form>
  );
}
