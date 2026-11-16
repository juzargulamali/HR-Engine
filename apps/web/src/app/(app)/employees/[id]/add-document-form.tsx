"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { addDocument, prepareDocumentUpload, type AddDocumentState } from "@/lib/actions/employeeDocuments";
import { uploadChosenFile } from "@/lib/hr-upload-client";
import { UPLOAD_ACCEPT, UPLOAD_LIMIT_TEXT } from "@/lib/upload-rules";
import { DOCUMENT_TYPES, missingForType, ruleForKey, typeKey, typesForCountry, type DocumentTypeRule } from "@/lib/hr/document-types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const initialState: AddDocumentState = { error: null };
const fileClass = "block min-h-11 w-full text-sm file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm";

/** The words under a label: always "Required" or "Optional", never a bare asterisk. */
const need = (required: boolean) => (required ? "Required" : "Optional");

export interface AddDocumentFormProps {
  employeeId: string;
  employeeName: string;
  companyName: string;
  countryCode: string | null;
  /** Types this viewer may add (the form never offers a table the viewer cannot write). */
  allowedStores: readonly ("identity" | "employee")[];
  /** A type key chosen by the link that opened the form (`identity:passport`). */
  initialTypeKey?: string | null;
  /** Renewal: the type is locked, the earlier document is named and kept. */
  renew?: boolean;
  renewsDocumentId?: string | null;
  previousNumber?: string | null;
  /** True when a link asked for the form to be open (a renewal, a setup step, an expiry action). */
  defaultOpen?: boolean;
  /** Where "Close" returns to: the Documents tab without the add parameters. */
  closeHref: string;
}

/**
 * The one Add document form. The type is chosen first (the types usual for the employee's country first); then only the fields that type requires appear, each labelled
 * Required or Optional, with the effect of saving beside the button. The employee and company are shown at the top and are never typed. The same rule runs on the server.
 */
export function AddDocumentForm(p: AddDocumentFormProps) {
  const [state, formAction, pending] = useActionState(addDocument, initialState);
  const [open, setOpen] = useState(p.defaultOpen === true);
  const [key, setKey] = useState(p.initialTypeKey ?? "");
  // One id per submission: a retry of the same form sends the same id (so it can never add a second row); finishing starts a new one.
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [number, setNumber] = useState(p.previousNumber ?? "");
  const [expiry, setExpiry] = useState("");
  const [hasFile, setHasFile] = useState(false);
  const [localError, setLocalError] = useState<{ field: "number" | "file" | "expiry"; text: string } | null>(null);
  // True from the moment Save is pressed until the file is safely in private storage (the save itself is `pending`).
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const locked = p.renew === true && ruleForKey(p.initialTypeKey) !== null;
  const rule: DocumentTypeRule | null = ruleForKey(key);
  const offered = useMemo(() => DOCUMENT_TYPES.filter((t) => p.allowedStores.includes(t.store)), [p.allowedStores]);
  const groups = useMemo(() => {
    const { suggested } = typesForCountry(p.countryCode);
    const usual = new Set(suggested.map((t) => typeKey(t.store, t.code)));
    return { usual: offered.filter((t) => usual.has(typeKey(t.store, t.code))), rest: offered.filter((t) => !usual.has(typeKey(t.store, t.code))) };
  }, [offered, p.countryCode]);

  const saved = state.saved;
  const busy = uploading || pending;
  useEffect(() => { if (open && !saved) rootRef.current?.querySelector<HTMLElement>("select, input:not([type=hidden])")?.focus({ preventScroll: false }); }, [open, saved]);

  if (offered.length === 0) return null;

  if (!open) {
    return (
      <div>
        <Button type="button" size="sm" onClick={() => setOpen(true)} data-testid="add-document-open">Add document</Button>
      </div>
    );
  }

  const country = p.countryCode ? p.countryCode.toUpperCase() : null;
  const effect = rule
    ? `Adds a ${rule.label} to ${p.employeeName}'s file${rule.expiry === "none" ? "; it does not expire." : rule.tracking === "job" ? "; the expiry date is tracked and flagged before it runs out." : rule.expiry === "optional" ? "; add an expiry date to have it tracked." : "; the expiry date is tracked and flagged before it runs out."}`
    : "Choose a type to see what saving does.";

  /** Closing a form that a link opened also clears its address, so a refresh does not open it again. */
  function close() { setOpen(false); if (p.defaultOpen) router.replace(p.closeHref); }

  return (
    <div
      ref={rootRef}
      className="space-y-4 rounded-md border border-border p-4"
      data-testid="add-document-form"
      onKeyDown={(e) => { if (e.key === "Escape" && !busy) close(); }}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold">{p.renew ? "Renew document" : "Add document"}</p>
        <p className="text-sm text-muted-foreground" data-testid="add-document-context">
          for <span className="font-medium text-foreground">{p.employeeName}</span> · {p.companyName}
        </p>
        {p.renew ? <p className="text-sm text-muted-foreground">This adds a new document; the earlier one stays in the history.</p> : null}
      </div>

      {saved ? (
        <div className="space-y-3" data-testid="add-document-saved">
          <Alert variant="success" role="status">{saved.existing ? `That ${saved.label} was already saved: nothing was added twice.` : `${saved.label} added to ${p.employeeName}'s file.`}</Alert>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => { setSubmissionId(crypto.randomUUID()); setKey(""); setNumber(""); setExpiry(""); setHasFile(false); setLocalError(null); setOpen(false); router.replace(p.closeHref); router.refresh(); }}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!rule || busy) return;
            const m = missingForType(rule, { number, expiry, hasFile });
            if (m) {
              setLocalError({ field: rule.numberRequired && !number.trim() ? "number" : rule.fileRequired && !hasFile ? "file" : "expiry", text: m });
              return;
            }
            setLocalError(null);
            // The file never goes through the server action: it is sent straight to private storage first, and the action only receives its name, type and size.
            const data = new FormData(e.currentTarget);
            data.delete("file");
            const file = fileRef.current?.files?.[0] ?? null;
            if (file) {
              setUploading(true);
              const problem = await uploadChosenFile(file, (declared) => prepareDocumentUpload({ employeeId: p.employeeId, typeKey: key, submissionId, ...declared }));
              setUploading(false);
              if (problem) { setLocalError({ field: "file", text: problem }); return; }
              data.set("fileName", file.name);
              data.set("fileType", file.type);
              data.set("fileSize", String(file.size));
            }
            startTransition(() => formAction(data));
          }}
        >
          <input type="hidden" name="employeeId" value={p.employeeId} />
          <input type="hidden" name="submissionId" value={submissionId} />
          <input type="hidden" name="typeKey" value={key} />
          {p.renewsDocumentId ? <input type="hidden" name="renewsDocumentId" value={p.renewsDocumentId} /> : null}

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="documentTypeKey">Type</Label>
              <InfoHint label="Document types" testId="add-document-types-hint">
                <p>The type decides where the document is kept and what it needs. Identity documents (passport, national ID, residence ID) keep a number and an optional scan and are readable only by the person and their HR Admin. Visas, labor cards and certificates need a file; their expiry date is tracked and flagged before it runs out.</p>
              </InfoHint>
            </div>
            {locked && rule ? (
              <p className="text-sm font-medium" data-testid="add-document-type-locked">{rule.label}</p>
            ) : (
              <Select id="documentTypeKey" value={key} data-testid="add-document-type" onChange={(e) => { setKey(e.target.value); setLocalError(null); }}>
                <option value="">Choose a type</option>
                {groups.usual.length ? (
                  <optgroup label={`Usual for ${country ?? "this country"}`}>
                    {groups.usual.map((t) => <option key={typeKey(t.store, t.code)} value={typeKey(t.store, t.code)}>{t.label}</option>)}
                  </optgroup>
                ) : null}
                <optgroup label={groups.usual.length ? "Other types" : "Types"}>
                  {groups.rest.map((t) => <option key={typeKey(t.store, t.code)} value={typeKey(t.store, t.code)}>{t.label}</option>)}
                </optgroup>
              </Select>
            )}
          </div>

          {rule ? (
            <div className="space-y-4">
              {rule.numberRequired ? (
                <div className="space-y-1.5">
                  <Label htmlFor="docNumber">{rule.label} number <span className="font-normal text-muted-foreground">({need(true)})</span></Label>
                  <Input id="docNumber" name="number" value={number} onChange={(e) => { setNumber(e.target.value); setLocalError(null); }} autoComplete="off" aria-invalid={localError?.field === "number"} data-testid="add-document-number" />
                  {p.renew && p.previousNumber ? <p className="text-sm text-muted-foreground">Filled in from the earlier document; change it if the number is new.</p> : null}
                  {localError?.field === "number" ? <p className="text-sm text-destructive" role="alert">{localError.text}</p> : null}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="docFile">{rule.fileRequired ? "File" : "Scan"} <span className="font-normal text-muted-foreground">({need(rule.fileRequired)})</span></Label>
                <input ref={fileRef} id="docFile" name="file" type="file" accept={UPLOAD_ACCEPT} className={fileClass} onChange={(e) => { setHasFile((e.target.files?.length ?? 0) > 0); setLocalError(null); }} aria-invalid={localError?.field === "file"} data-testid="add-document-file" />
                <p className="text-sm text-muted-foreground">{UPLOAD_LIMIT_TEXT}</p>
                {localError?.field === "file" ? <p className="text-sm text-destructive" role="alert">{localError.text}</p> : null}
              </div>

              {rule.expiry === "none" ? (
                <p className="text-sm text-muted-foreground" data-testid="add-document-no-expiry">{rule.label} does not expire, so no expiry date is asked for.</p>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="docExpiry">Expiry date <span className="font-normal text-muted-foreground">({need(rule.expiry === "required")})</span></Label>
                  <Input id="docExpiry" name="expiryDate" type="date" value={expiry} onChange={(e) => { setExpiry(e.target.value); setLocalError(null); }} aria-invalid={localError?.field === "expiry"} data-testid="add-document-expiry" />
                  {localError?.field === "expiry" ? <p className="text-sm text-destructive" role="alert">{localError.text}</p> : null}
                </div>
              )}
            </div>
          ) : null}

          {state.error ? <Alert variant="destructive" role="alert" data-testid="add-document-error">{state.error}</Alert> : null}

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground" data-testid="add-document-effect">{effect}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy || !rule} data-testid="add-document-submit">{uploading ? "Uploading file…" : pending ? "Saving…" : p.renew ? "Save renewed document" : "Add document"}</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
