"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { resolvePolicyVersionAsOf, type PolicyVersionLike } from "@enginious-hr/domain";
import { submitLeaveRequest } from "@/lib/actions/leave";
import type { ActionState } from "@/lib/actions/companies";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

interface LeaveRequestFormProps {
  versions: (PolicyVersionLike & { id: string })[];
  leaveTypesByVersion: Record<string, { code: string; name: string }[]>;
  today: string;
}

// Which leave types are offered depends on the leave's chosen start_date,
// not today — the same rule submitLeaveRequest() and
// guard_leave_request_type() apply authoritatively server-side and at the
// database layer. Recomputing this client-side as the start date changes
// (rather than resolving once at page load) is what keeps the three in
// sync: a request starting after a newer policy takes effect sees that
// policy's leave types here too, instead of whatever's active today.
export function LeaveRequestForm({ versions, leaveTypesByVersion, today }: LeaveRequestFormProps) {
  const [state, formAction, pending] = useActionState(submitLeaveRequest, initialState);
  const [startDate, setStartDate] = useState("");

  const activeVersion = useMemo(() => resolvePolicyVersionAsOf(versions, startDate || today), [versions, startDate, today]);
  const leaveTypes = activeVersion ? (leaveTypesByVersion[activeVersion.id] ?? []) : [];

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" name="endDate" type="date" required />
        </div>
      </div>

      {leaveTypes.length === 0 ? (
        <Alert variant="destructive">
          {startDate
            ? "No active leave policy covers this start date for your country yet — pick a different date or ask HR Admin to activate one."
            : "Your country's active leave policy doesn't define any leave types yet. Ask HR Admin to add at least one before you can request leave."}
        </Alert>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="leaveTypeCode">Leave type</Label>
          <Select id="leaveTypeCode" name="leaveTypeCode" defaultValue={leaveTypes[0]?.code} key={activeVersion?.id}>
            {leaveTypes.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
      )}

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
        <Button type="submit" disabled={pending || leaveTypes.length === 0}>
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
