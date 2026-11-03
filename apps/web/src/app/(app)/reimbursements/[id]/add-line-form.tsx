"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { addClaimLine } from "@/lib/actions/reimbursements";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AddLineForm({ claimId }: { claimId: string }) {
  const [state, formAction, pending] = useActionState(addClaimLine, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  // The form is cleared only after the line was saved. On an error the typed values stay so nothing has to be retyped.
  // (React clears an uncontrolled form after a form action on its own, so the submit is handled here instead.)
  useEffect(() => {
    if (pending) wasPending.current = true;
    else if (wasPending.current) {
      wasPending.current = false;
      if (!state.error) formRef.current?.reset();
    }
  }, [pending, state.error]);

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className="space-y-4"
    >
      <input type="hidden" name="claimId" value={claimId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="expenseDate">Expense date</Label>
          <Input id="expenseDate" name="expenseDate" type="date" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <Input id="category" name="category" placeholder="e.g. travel, meals" required />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="amount">Amount</Label>
          <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="receipt">Receipt (optional)</Label>
          <Input id="receipt" name="receipt" type="file" accept="image/*,application/pdf" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Input id="description" name="description" />
      </div>

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add line"}
      </Button>
    </form>
  );
}
