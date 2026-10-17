"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { requestApproval, requestAvailability } from "@/lib/actions/crm";
import { getCrmFileUrl, removeCrmFile } from "@/lib/actions/crmFiles";
import type { ActionState } from "@/lib/actions/companies";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/sales/modal";

/** Runs a one-click server action and keeps its error in words next to the button. */
function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else onOk?.();
    });
  };
  return { pending, error, run };
}

const ErrorLine = ({ error }: { error: string | null }) => (error ? <Alert variant="destructive" className="mt-2">{error}</Alert> : null);

export function RequestAvailabilityButton({ opportunityId, recheck }: { opportunityId: string; recheck: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <div>
      <Button type="button" size="sm" variant={recheck ? "default" : "outline"} disabled={pending} onClick={() => run(() => requestAvailability(opportunityId))}>
        {pending ? "Requesting…" : recheck ? "Request a new availability check" : "Request availability check"}
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}

export function RequestApprovalButton({ opportunityId, proposalId, again }: { opportunityId: string; proposalId?: string; again?: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <div>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => requestApproval(opportunityId, proposalId))}>
        {pending ? "Requesting…" : again ? "Request approval again" : "Request approval from a founder"}
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}

/** Asks the server for a short-lived signed link, then opens it. The link is never stored or shown. */
export function OpenFileButton({ fileId, name }: { fileId: string; name: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        type="button" size="sm" variant="outline" disabled={pending} aria-label={`Open ${name}`}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await getCrmFileUrl(fileId);
            if (r.error || !r.url) { setError(r.error ?? "The file could not be opened."); return; }
            const a = document.createElement("a");
            a.href = r.url;
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            a.remove();
          });
        }}
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden /> {pending ? "Opening…" : "Open"}
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}

export function RemoveFileButton({ fileId, name, isLink }: { fileId: string; name: string; isLink: boolean }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useRun();
  return (
    <>
      <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${name}`} onClick={() => setOpen(true)}>Remove</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={isLink ? "Remove link" : "Remove file"} description={name}>
        <div className="space-y-4">
          <p className="text-sm">{isLink ? "The link is removed from this opportunity." : "The file is deleted from storage and removed from this opportunity."} The history keeps the entry that it was added.</p>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Keep it</Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={() => run(() => removeCrmFile(fileId), () => setOpen(false))}>{pending ? "Removing…" : "Remove"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
