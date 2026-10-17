"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/lib/actions/companies";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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
  const [state, formAction, pending] = useActionState(action, { error: null } as S);
  const formRef = useRef<HTMLFormElement>(null);
  const handled = useRef<S | null>(null);
  useEffect(() => {
    if (state && state !== handled.current && state.error === null && handled.current !== null) {
      if (resetOnSuccess) formRef.current?.reset();
      onDone?.(state);
    }
    handled.current = state;
  }, [state, onDone, resetOnSuccess]);
  return (
    <form
      ref={formRef}
      // Submitting through onSubmit (not <form action>) stops React 19 resetting the fields after a REFUSED save, so a
      // person never loses what they typed; a successful save resets or closes it explicitly (resetOnSuccess / onDone).
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className={className ?? "space-y-4"}>
      {children}
      {state.error ? <Alert variant="destructive" role="alert">{state.error}</Alert> : null}
      {state.warning ? <Alert role="status">{state.warning}</Alert> : null}
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
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
