"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import type { ActionState } from "@/lib/actions/companies";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useUnsavedChanges } from "@/components/workspace/unsaved";

type Action = (prev: ActionState & { id?: string }, formData: FormData) => Promise<ActionState & { id?: string }>;
type S = ActionState & { id?: string };

/**
 * A form wired to a server action: shows the action's error in words, disables the button while saving, and calls
 * `onDone` (e.g. close a dialog) after a success. Hidden inputs (opportunity id, version…) are passed as `children`.
 */
export function ActionForm({
  action, children, submitLabel, pendingLabel = "Saving…", onDone, resetOnSuccess = false, className, secondary, variant = "default",
}: {
  action: Action;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  onDone?: (state: S) => void;
  resetOnSuccess?: boolean;
  className?: string;
  secondary?: React.ReactNode;
  variant?: "default" | "destructive" | "outline" | "secondary";
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // Edits that are not saved yet are registered, so closing the side panel or opening another record asks first.
  const [edited, setEdited] = useState(false);
  // A quiet confirmation for a form that stays on screen after saving (a form that closes its dialog needs none).
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);
  useUnsavedChanges(useId(), edited);
  // onDone / reset run inside the action wrapper, not in an effect: a successful save often changes what the page
  // shows (revalidation can unmount this very form, e.g. the last item leaves a picker), and an effect would then never
  // run, leaving a dialog open after the work was done.
  const onDoneRef = useRef(onDone);
  const resetRef = useRef(resetOnSuccess);
  useEffect(() => {
    onDoneRef.current = onDone;
    resetRef.current = resetOnSuccess;
  });
  const wrapped = async (prev: S, formData: FormData): Promise<S> => {
    const result = await action(prev, formData);
    if (result.error === null) {
      setEdited(false);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 4000);
      if (resetRef.current) formRef.current?.reset();
      onDoneRef.current?.(result);
    }
    return result;
  };
  const [state, formAction, pending] = useActionState(wrapped, { error: null } as S);
  return (
    <form
      ref={formRef}
      onInput={() => setEdited(true)}
      onChange={() => setEdited(true)}
      // Submitting through onSubmit (not <form action>) stops React 19 resetting the fields after a REFUSED save, so a
      // person never loses what they typed; a successful save resets or closes it explicitly (resetOnSuccess / onDone).
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className={className ?? "space-y-4"}>
      {children}
      {state.error ? <Alert variant="destructive" role="alert">{state.error}</Alert> : null}
      {state.warning ? <Alert role="status">{state.warning}</Alert> : null}
      {saved && !state.error && !state.warning ? <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--os-green))]"><span className="os-dot" data-tone="green" aria-hidden />Saved</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {secondary}
        <Button type="submit" variant={variant} disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
      </div>
    </form>
  );
}

export function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className ?? "space-y-1.5"}>
      <label htmlFor={htmlFor} className="text-sm font-medium leading-none">{label}</label>
      {children}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
