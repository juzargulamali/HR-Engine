"use client";

import { startTransition, useActionState } from "react";
import { inviteAndLinkEmployee, type OnboardingActionState } from "@/lib/actions/onboarding";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const initialState: OnboardingActionState = { error: null };

/** One button for the invitation step: it links an account that already exists, or (System Administrator) sends the invitation and links the new account. A repeat never sends a second invitation. */
export function InviteForm({ employeeId, label }: { employeeId: string; label: string }) {
  const [state, formAction, pending] = useActionState(inviteAndLinkEmployee, initialState);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("employeeId", employeeId);
        startTransition(() => formAction(fd));
      }}
    >
      <Button type="submit" variant="outline" className="min-h-11" disabled={pending} data-testid="invite-and-link">{pending ? "Working..." : label}</Button>
      {state.error ? <Alert variant="destructive" data-testid="invite-error">{state.error}</Alert> : null}
      {state.notice && !state.error ? <Alert variant="success" data-testid="invite-notice">{state.notice}</Alert> : null}
    </form>
  );
}
