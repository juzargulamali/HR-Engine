"use client";

import { useActionState } from "react";
import { addManualPayrollLine } from "@/lib/actions/payroll";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

const COMPONENT_OPTIONS: { value: string; label: string }[] = [
  { value: "bonus", label: "Bonus" },
  { value: "deduction", label: "Deduction" },
  { value: "reimbursement", label: "Reimbursement" },
  { value: "basic_salary", label: "Basic salary" },
  { value: "other_allowance", label: "Other allowance" },
];

export function AddManualPayrollLineForm({
  runId,
  employees,
  defaultCurrency,
}: {
  runId: string;
  employees: { id: string; name: string }[];
  defaultCurrency: string;
}) {
  const [state, formAction, pending] = useActionState(addManualPayrollLine, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="runId" value={runId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="employeeId">Employee</Label>
          <Select id="employeeId" name="employeeId" required defaultValue="">
            <option value="" disabled>
              Select an employee
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="componentCode">Type</Label>
          <Select id="componentCode" name="componentCode" required defaultValue="bonus">
            {COMPONENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="label">Description</Label>
        <Input id="label" name="label" placeholder="e.g. Q1 bonus, fine for late badge return" required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="amount">Amount</Label>
          <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
          <p className="text-xs text-muted-foreground">Always enter a positive number — deductions are stored negative automatically.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" maxLength={3} defaultValue={defaultCurrency} required />
        </div>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add manual line"}
      </Button>
    </form>
  );
}
