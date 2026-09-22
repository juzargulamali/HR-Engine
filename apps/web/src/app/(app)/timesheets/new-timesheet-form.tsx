"use client";

import { useActionState } from "react";
import { createDraftTimesheet } from "@/lib/actions/timesheets";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Defaults to the current Monday–Sunday week — just a convenient starting point, freely editable. */
function currentWeek(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: toISODate(monday), end: toISODate(sunday) };
}

export function NewTimesheetForm() {
  const [state, formAction, pending] = useActionState(createDraftTimesheet, initialState);
  const { start, end } = currentWeek();

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="periodStart">Period start</Label>
          <Input id="periodStart" name="periodStart" type="date" defaultValue={start} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="periodEnd">Period end</Label>
          <Input id="periodEnd" name="periodEnd" type="date" defaultValue={end} required />
        </div>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Start timesheet"}
      </Button>
      <p className="text-xs text-muted-foreground">You&apos;ll add daily entries and submit for approval on the next screen.</p>
    </form>
  );
}
