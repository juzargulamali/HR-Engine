"use client";

import { useActionState } from "react";
import { createDraftClaim } from "@/lib/actions/reimbursements";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function NewClaimForm({ defaultCurrency }: { defaultCurrency: string }) {
  const [state, formAction, pending] = useActionState(createDraftClaim, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="currency">Currency</Label>
        <Input id="currency" name="currency" defaultValue={defaultCurrency} maxLength={3} required />
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Start claim"}
      </Button>
      <p className="text-xs text-muted-foreground">You&apos;ll add expense lines and a receipt on the next screen.</p>
    </form>
  );
}
