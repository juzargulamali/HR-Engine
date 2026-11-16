"use client";

import { startTransition, useActionState, useState } from "react";
import { applyOnboardingAccess, type OnboardingActionState } from "@/lib/actions/onboarding";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const initialState: OnboardingActionState = { error: null };
const WORD: Record<string, string> = { applied: "Applied", already: "Already in place", blocked: "Needs someone else", failed: "Could not apply" };

/** The last step: tick that the exact list above was reviewed, then apply what this person is allowed to apply. Each line reports what happened; what is not theirs says who can do it. */
export function ApplyForm({ employeeId, canApply }: { employeeId: string; canApply: boolean }) {
  const [state, formAction, pending] = useActionState(applyOnboardingAccess, initialState);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("employeeId", employeeId);
        if (confirmed) fd.set("confirmReviewed", "on");
        startTransition(() => formAction(fd));
      }}
    >
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="confirm-reviewed" />
        <span>I have reviewed the exact companies, HR roles and module rights above.</span>
      </label>
      <Button type="submit" className="min-h-11" disabled={pending || !canApply} data-testid="apply-access">{pending ? "Applying..." : "Apply what I can"}</Button>
      {!canApply ? <p className="text-sm text-muted-foreground">Nothing in the list can be applied by you yet. Each line says who can.</p> : null}
      {state.error ? <Alert variant="destructive" data-testid="apply-error">{state.error}</Alert> : null}
      {state.notice && !state.error ? <Alert variant="success" data-testid="apply-notice">{state.notice}</Alert> : null}
      {state.results && state.results.length > 0 ? (
        <ul className="space-y-1 text-sm" data-testid="apply-results">
          {state.results.map((r) => <li key={r.key}><span className="font-medium">{WORD[r.outcome]}:</span> {r.label}. {r.message}</li>)}
        </ul>
      ) : null}
    </form>
  );
}
