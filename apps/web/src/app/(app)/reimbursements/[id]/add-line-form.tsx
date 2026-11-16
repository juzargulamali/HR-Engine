"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { addClaimLine, prepareReceiptUpload } from "@/lib/actions/reimbursements";
import { uploadChosenFile } from "@/lib/hr-upload-client";
import { UPLOAD_ACCEPT, UPLOAD_LIMIT_TEXT } from "@/lib/upload-rules";
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
  // One id per submission: a retry of the same line sends the same id, so a receipt that was already saved can never number a second line; a saved line starts a new one.
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [uploading, setUploading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const busy = uploading || pending;
  // A saved line starts a new submission (adjusted while rendering, as React recommends, instead of in an effect).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (!state.error) { setSubmissionId(crypto.randomUUID()); setReceiptError(null); }
  }

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
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setReceiptError(null);
        // The receipt never goes through the server action: it is sent straight to private storage first, and the action only receives its name, type and size.
        const formData = new FormData(event.currentTarget);
        formData.delete("receipt");
        const file = (event.currentTarget.elements.namedItem("receipt") as HTMLInputElement | null)?.files?.[0] ?? null;
        if (file) {
          setUploading(true);
          const problem = await uploadChosenFile(file, (declared) => prepareReceiptUpload({ claimId, submissionId, ...declared }));
          setUploading(false);
          if (problem) { setReceiptError(problem); return; }
          formData.set("receiptName", file.name);
          formData.set("receiptType", file.type);
          formData.set("receiptSize", String(file.size));
        }
        startTransition(() => formAction(formData));
      }}
      className="space-y-4"
    >
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="submissionId" value={submissionId} />

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
          <Input id="receipt" name="receipt" type="file" accept={UPLOAD_ACCEPT} aria-invalid={receiptError !== null} />
          <p className="text-sm text-muted-foreground">{UPLOAD_LIMIT_TEXT}</p>
          {receiptError ? <p className="text-sm text-destructive" role="alert" data-testid="receipt-error">{receiptError}</p> : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Input id="description" name="description" />
      </div>

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={busy}>
        {uploading ? "Uploading receipt…" : pending ? "Adding…" : "Add line"}
      </Button>
    </form>
  );
}
