"use client";

import { useActionState } from "react";
import { addLoan } from "@/lib/actions/employees";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AddLoanForm({ employeeId, defaultCurrency }: { employeeId: string; defaultCurrency: string }) {
  const [state, formAction, pending] = useActionState(addLoan, initialState);

  return (
    <form action={formAction} className="space-y-3 border-t border-border pt-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <p className="text-sm font-medium">Add a loan or cash advance</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="loanType">Type</Label>
          <Select id="loanType" name="loanType" defaultValue="loan">
            <option value="loan">Loan</option>
            <option value="cash_advance">Cash advance</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="issuedDate">Date issued</Label>
          <Input id="issuedDate" name="issuedDate" type="date" required />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="amount">Amount</Label>
          <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" maxLength={3} defaultValue={defaultCurrency} required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="note">Note (optional)</Label>
        <Input id="note" name="note" placeholder="Reason / terms" />
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Add record"}
      </Button>
    </form>
  );
}
