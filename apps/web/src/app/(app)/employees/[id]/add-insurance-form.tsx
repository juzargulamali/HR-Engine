"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { addInsurancePolicy, prepareInsuranceUpload } from "@/lib/actions/employees";
import { uploadChosenFile } from "@/lib/hr-upload-client";
import { UPLOAD_ACCEPT, UPLOAD_LIMIT_TEXT } from "@/lib/upload-rules";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AddInsuranceForm({ employeeId, employeeName, companyName }: { employeeId: string; employeeName?: string; companyName?: string }) {
  const [state, formAction, pending] = useActionState(addInsurancePolicy, initialState);
  // One id per submission: a retry of the same form sends the same id (so it can never add a second policy); a saved policy starts a new one.
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const busy = uploading || pending;
  // A saved policy starts a new submission (adjusted while rendering, as React recommends, instead of in an effect).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (!state.error) { setSubmissionId(crypto.randomUUID()); setFileError(null); }
  }

  // The form is cleared only after the policy was saved. On an error the typed values stay so nothing has to be retyped.
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
        setFileError(null);
        // The document never goes through the server action: it is sent straight to private storage first, and the action only receives its name, type and size.
        const data = new FormData(event.currentTarget);
        data.delete("file");
        const file = (event.currentTarget.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0] ?? null;
        if (file) {
          setUploading(true);
          const problem = await uploadChosenFile(file, (declared) => prepareInsuranceUpload({ employeeId, submissionId, ...declared }));
          setUploading(false);
          if (problem) { setFileError(problem); return; }
          data.set("fileName", file.name);
          data.set("fileType", file.type);
          data.set("fileSize", String(file.size));
        }
        startTransition(() => formAction(data));
      }}
      className="space-y-3 border-t border-border pt-4"
    >
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <p className="text-sm font-medium">Add an insurance policy</p>
      {employeeName ? <p className="text-sm text-muted-foreground" data-testid="form-context">For <span className="font-medium text-foreground">{employeeName}</span>{companyName ? ` · ${companyName}` : ""}</p> : null}
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
          accept={UPLOAD_ACCEPT}
          aria-invalid={fileError !== null}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
        />
        <p className="text-sm text-muted-foreground">{UPLOAD_LIMIT_TEXT}</p>
        {fileError ? <p className="text-sm text-destructive" role="alert" data-testid="insurance-file-error">{fileError}</p> : null}
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={busy}>
        {uploading ? "Uploading file…" : pending ? "Saving…" : "Add policy"}
      </Button>
    </form>
  );
}
