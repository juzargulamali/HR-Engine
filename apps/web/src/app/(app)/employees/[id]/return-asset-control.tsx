"use client";

import { useActionState, useState } from "react";
import { returnAsset } from "@/lib/actions/assets";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function ReturnAssetControl({
  assignmentId,
  assetId,
  employeeId,
}: {
  assignmentId: string;
  assetId: string;
  employeeId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(returnAsset, initialState);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Return
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-md border border-border p-3">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="assetId" value={assetId} />
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="space-y-1.5">
        <Label htmlFor={`conditionOnReturn-${assignmentId}`}>Condition on return</Label>
        <Input id={`conditionOnReturn-${assignmentId}`} name="conditionOnReturn" placeholder="Good" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`newStatus-${assignmentId}`}>Puts the asset back as</Label>
        <Select id={`newStatus-${assignmentId}`} name="newStatus" defaultValue="in_stock">
          <option value="in_stock">In stock</option>
          <option value="under_repair">Under repair</option>
          <option value="retired">Retired</option>
        </Select>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Confirm return"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
