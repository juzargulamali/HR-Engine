"use client";

import { useActionState } from "react";
import { recordOvernightRecoveryCredit } from "@/lib/actions/attendance";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

/**
 * HR Admin/manager attestation for an exceptional overnight extension —
 * never a browser-supplied eligibility flag. Requires an attendance record
 * for the day to already exist (record it via the daily Attendance page
 * first); server-derives the 0.5/1-day threshold from the hours entered
 * here, and only ever creates a recovery_credit_requests row pending Line
 * Manager then HR Admin approval, never an immediate credit.
 */
export function OvernightRecoveryForm({ employeeId }: { employeeId: string }) {
  const [state, formAction, pending] = useActionState(recordOvernightRecoveryCredit, initialState);

  return (
    <form action={formAction} className="max-w-lg space-y-3 rounded-md border border-border p-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <p className="text-sm font-medium">Record an exceptional overnight extension</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="workDate">Work date</Label>
          <Input id="workDate" name="workDate" type="date" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activeHoursAfterMidnight">Active hours after midnight</Label>
          <Input id="activeHoursAfterMidnight" name="activeHoursAfterMidnight" type="number" step="0.25" min="0" required />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="completedNormalScheduledDay" value="true" defaultChecked className="h-4 w-4" />
            Completed the normal scheduled day first
          </label>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Attendance for this day must already be recorded. Up to and including 4 active hours after midnight credits 0.5
        day; more than 4 credits 1 day — pending Line Manager then HR Admin approval.
      </p>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Submitting…" : "Submit for approval"}
      </Button>
    </form>
  );
}
