"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { InvActionState } from "@/lib/inventory/action-utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useUnsavedChanges } from "@/components/workspace/unsaved";

export type InvAction = (prev: InvActionState, formData: FormData) => Promise<InvActionState>;
export { Field } from "@/components/sales/action-form";

const LOST = "The request did not reach the server, so nobody knows whether it was saved. Reload the page to check before you try again.";

/**
 * A form for an Inventory server action. Like the Sales and Projects forms: the result is shown only after the server answers, a refusal
 * keeps everything typed, and edits that are not saved are registered so closing the panel asks first. One difference that matters
 * for a request that changes stock-affecting records: a second click or Enter while the first is still being answered is ignored
 * (a lock held outside React's render cycle), so a double click sends ONE request, not two.
 *
 * A successful save that has something to say (what was released, what is still outstanding, which lines could not move) shows it,
 * and the dialog closes when the person has read it (the Close button), not before.
 */
export function InvForm({
  action, children, submitLabel, pendingLabel = "Saving…", onDone, resetOnSuccess = false, className, secondary, variant = "default", renderNotice, hideSubmit = false,
}: {
  action: InvAction;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  /** Called after a successful save (after the notice has been read, when there is one). */
  onDone?: (state: InvActionState) => void;
  resetOnSuccess?: boolean;
  className?: string;
  secondary?: React.ReactNode;
  variant?: "default" | "destructive" | "outline" | "secondary";
  renderNotice?: (state: InvActionState) => React.ReactNode;
  hideSubmit?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const [state, setState] = useState<InvActionState | null>(null);
  const [pending, setPending] = useState(false);
  const [edited, setEdited] = useState(false);
  useUnsavedChanges(useId(), edited);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const submit = async (form: HTMLFormElement) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await action({ error: null }, new FormData(form));
      if (!alive.current) return;
      setState(result);
      if (result.error === null) {
        setEdited(false);
        if (resetOnSuccess) formRef.current?.reset();
        if (!result.warning || !onDone) onDone?.(result);
      }
    } catch {
      if (alive.current) setState({ error: LOST });
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  };

  const done = state && state.error === null ? state : null;
  const notice = done?.warning ? (renderNotice ? renderNotice(done) : <Alert role="status">{done.warning}</Alert>) : null;
  return (
    <form
      ref={formRef}
      onInput={() => { setEdited(true); if (done) setState(null); }}
      onChange={() => setEdited(true)}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
      className={className ?? "space-y-4"}
    >
      {children}
      {state?.error ? <Alert variant="destructive" role="alert">{state.error}</Alert> : null}
      {notice}
      {hideSubmit ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {secondary}
          {done?.warning && onDone ? (
            <Button type="button" onClick={() => onDone(done)}>Close</Button>
          ) : (
            <Button type="submit" variant={variant} disabled={pending} aria-disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
          )}
        </div>
      )}
    </form>
  );
}
