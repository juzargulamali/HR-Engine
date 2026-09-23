"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitLeaveRequest } from "@/lib/actions/leave";
import type { ActionState } from "@/lib/actions/companies";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

// The page above only ever renders this form when it already found an
// active leave policy with at least one leave type — never falls back to a
// free-text field, since a raw leaveTypeCode string would bypass the
// server's own allowlist check anyway (submitLeaveRequest() validates
// against policy_leave_types regardless of what this form sends).
export function LeaveRequestForm({ leaveTypes }: { leaveTypes: { code: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(submitLeaveRequest, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="leaveTypeCode">Leave type</Label>
        <Select id="leaveTypeCode" name="leaveTypeCode" defaultValue={leaveTypes[0]?.code}>
          {leaveTypes.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" name="endDate" type="date" required />
        </div>
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="halfDayStart" value="true" className="size-4 rounded border-input" />
          Half-day (start)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="halfDayEnd" value="true" className="size-4 rounded border-input" />
          Half-day (end)
        </label>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason (optional)</Label>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit request"}
        </Button>
        <Link href="/leave" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        Days are counted automatically from your country&apos;s working week and public holidays, then routed to your
        approver.
      </p>
    </form>
  );
}
