"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { attachIdentityFile, prepareIdentityFileUpload } from "@/lib/actions/employeeDocuments";
import { uploadChosenFile } from "@/lib/hr-upload-client";
import { UPLOAD_ACCEPT, UPLOAD_LIMIT_TEXT } from "@/lib/upload-rules";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * "Attach file" on an identity document that was saved without a scan. It adds the file to THAT SAME document: the number and dates are not touched, and only a document that
 * still has no file can receive one. The file goes straight to private storage and is checked there before it is linked (see lib/actions/employeeDocuments.ts); a retry after
 * an error reuses one id, so it can never attach twice. Shown only to an HR Admin of the employee's company.
 */
export function AttachIdentityFile({ documentId, label }: { documentId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"uploading" | "saving" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const inputId = `attach-file-${documentId}`;

  if (!open) {
    return <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid={`attach-file-open-${documentId}`}>Attach file</Button>;
  }

  async function attach() {
    const file = fileRef.current?.files?.[0] ?? null;
    if (!file) { setError("Choose the file to attach."); return; }
    setError(null);
    setBusy("uploading");
    const problem = await uploadChosenFile(file, (declared) => prepareIdentityFileUpload({ documentId, submissionId, ...declared }));
    if (problem) { setBusy(null); setError(problem); return; }
    setBusy("saving");
    try {
      const result = await attachIdentityFile({ documentId, submissionId, name: file.name, size: file.size, type: file.type });
      setBusy(null);
      if (result.error) { setError(result.error); return; }
      setOpen(false);
      setSubmissionId(crypto.randomUUID());
      router.refresh();
    } catch {
      setBusy(null);
      setError("Something went wrong while attaching the file. Try again.");
    }
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-border p-3" data-testid={`attach-file-form-${documentId}`}>
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>File for this {label}</Label>
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="block min-h-11 w-full text-sm file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
          aria-invalid={error !== null}
          onChange={() => setError(null)}
          data-testid={`attach-file-input-${documentId}`}
        />
        <p className="text-sm text-muted-foreground">{UPLOAD_LIMIT_TEXT} The number and dates stay as they are.</p>
      </div>
      {error ? <Alert variant="destructive" role="alert" data-testid={`attach-file-error-${documentId}`}>{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy !== null} onClick={attach} data-testid={`attach-file-submit-${documentId}`}>
          {busy === "uploading" ? "Uploading file…" : busy === "saving" ? "Attaching…" : "Attach file"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
      </div>
    </div>
  );
}
