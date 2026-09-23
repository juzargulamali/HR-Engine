"use client";

import { useActionState } from "react";
import { addInsurancePolicy } from "@/lib/actions/employees";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AddInsuranceForm({ employeeId }: { employeeId: string }) {
  const [state, formAction, pending] = useActionState(addInsurancePolicy, initialState);

  return (
    <form action={formAction} className="space-y-3 border-t border-border pt-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <p className="text-sm font-medium">Add an insurance policy</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="insuranceName">Insurance name</Label>
          <Input id="insuranceName" name="insuranceName" placeholder="Provider / plan" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="policyNumber">Policy number</Label>
          <Input id="policyNumber" name="policyNumber" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expiryDate">Expiry date</Label>
          <Input id="expiryDate" name="expiryDate" type="date" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="file">Policy document / contract (optional)</Label>
        <input
          id="file"
          name="file"
          type="file"
          accept="application/pdf,image/*"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
        />
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Add policy"}
      </Button>
    </form>
  );
}
