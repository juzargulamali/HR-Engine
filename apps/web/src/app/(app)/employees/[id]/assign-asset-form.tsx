"use client";

import { useActionState } from "react";
import { assignAsset } from "@/lib/actions/assets";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AssignAssetForm({
  employeeId,
  availableAssets,
}: {
  employeeId: string;
  availableAssets: { id: string; asset_tag: string; category: string }[];
}) {
  const [state, formAction, pending] = useActionState(assignAsset, initialState);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-3 border-t border-border pt-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <p className="text-sm font-medium">Assign an asset</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="assetId">Asset</Label>
          <Select id="assetId" name="assetId" defaultValue="" required>
            <option value="" disabled>
              Select…
            </option>
            {availableAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.asset_tag} — {a.category}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="issuedDate">Issued date</Label>
          <Input id="issuedDate" name="issuedDate" type="date" defaultValue={today} required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="conditionOnIssue">Condition on issue (optional)</Label>
        <Input id="conditionOnIssue" name="conditionOnIssue" placeholder="New" />
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Assigning…" : "Assign"}
      </Button>
    </form>
  );
}
