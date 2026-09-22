"use client";

import { useActionState } from "react";
import { addEmployeeDocument } from "@/lib/actions/employees";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AddEmployeeDocumentForm({ employeeId, companyId }: { employeeId: string; companyId: string }) {
  const [state, formAction, pending] = useActionState(addEmployeeDocument, initialState);

  return (
    <form action={formAction} className="space-y-3 border-t border-border pt-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="companyId" value={companyId} />
      <p className="text-sm font-medium">Add a document</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="documentType">Type</Label>
          <Select id="documentType" name="documentType" defaultValue="visa">
            <option value="visa">Visa</option>
            <option value="labor_card">Labor card</option>
            <option value="emirates_id">Emirates ID</option>
            <option value="passport">Passport</option>
            <option value="certificate">Certificate</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expiryDate">Expiry date (optional)</Label>
          <Input id="expiryDate" name="expiryDate" type="date" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="file">File</Label>
        <input
          id="file"
          name="file"
          type="file"
          accept="application/pdf,image/*"
          required
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
        />
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Uploading…" : "Add document"}
      </Button>
    </form>
  );
}
