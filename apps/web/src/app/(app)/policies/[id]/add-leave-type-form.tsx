"use client";

import { useActionState } from "react";
import { addPolicyLeaveType } from "@/lib/actions/policies";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AddLeaveTypeForm({ policyVersionId }: { policyVersionId: string }) {
  const [state, formAction, pending] = useActionState(addPolicyLeaveType, initialState);

  return (
    <form action={formAction} className="space-y-3 border-t border-border pt-4">
      <input type="hidden" name="policyVersionId" value={policyVersionId} />
      <p className="text-sm font-medium">Add a leave type</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="leaveTypeCode">Code</Label>
          <Input id="leaveTypeCode" name="leaveTypeCode" placeholder="annual" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" placeholder="Annual leave" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="accrualMethod">Accrual method</Label>
          <Select id="accrualMethod" name="accrualMethod" defaultValue="monthly_accrual">
            <option value="monthly_accrual">Monthly accrual</option>
            <option value="annual_grant">Annual grant</option>
            <option value="per_service_year">Per service year</option>
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="accrualRatePerPeriod">Rate/period</Label>
          <Input id="accrualRatePerPeriod" name="accrualRatePerPeriod" type="number" step="0.001" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxBalanceDays">Max balance</Label>
          <Input id="maxBalanceDays" name="maxBalanceDays" type="number" step="0.5" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="carryoverMaxDays">Carryover max</Label>
          <Input id="carryoverMaxDays" name="carryoverMaxDays" type="number" step="0.5" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="carryoverExpiryMonths">Carryover expires (months)</Label>
          <Input id="carryoverExpiryMonths" name="carryoverExpiryMonths" type="number" />
        </div>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Add leave type"}
      </Button>
    </form>
  );
}
