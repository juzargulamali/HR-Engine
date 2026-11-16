"use client";

import { useActionState, useState } from "react";
import { cancelScheduledChange } from "@/lib/actions/employmentChanges";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

/** Cancels one scheduled change (HR Admin). Two steps so a stray tap cannot cancel a raise: the first tap asks, the second cancels. The employee and the change stay named on the row above. */
export function CancelChangeButton({ employeeId, eventId, held }: { employeeId: string; eventId: string; held: boolean }) {
  const [state, formAction, pending] = useActionState(cancelScheduledChange, initialState);
  const [asking, setAsking] = useState(false);
  return (
    <form action={formAction} className="mt-2 space-y-2" data-testid={`cancel-form-${eventId}`}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="employeeId" value={employeeId} />
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      {asking ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>{pending ? "Cancelling…" : "Yes, cancel this change"}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAsking(false)} disabled={pending}>Keep it</Button>
          <span className="text-xs text-muted-foreground">It stays in the history as cancelled and is never applied.</span>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAsking(true)}>{held ? "Cancel this held change" : "Cancel this change"}</Button>
      )}
    </form>
  );
}
