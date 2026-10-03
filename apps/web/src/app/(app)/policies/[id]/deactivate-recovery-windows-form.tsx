"use client";

import { useState, useTransition } from "react";
import { deactivateRecoveryWindowsPolicy } from "@/lib/actions/recoveryWindows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

/**
 * The controlled "disable" switch for a window-based Recovery Leave policy. It only ends the version on a FUTURE date:
 * nothing is deleted or recalculated, working periods already running (including one that a restart within 8 hours
 * continues past the end date) finish under the rules they started with, and the 5-minute processor must keep running
 * until they are finalized.
 */
export function DeactivateRecoveryWindowsForm({ policyVersionId, minDate, countryName }: { policyVersionId: string; minDate: string; countryName: string }) {
  const [lastDate, setLastDate] = useState(minDate);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !window.confirm(
            `Stop using the window rules for new working periods in ${countryName} after ${lastDate}? Nothing is deleted. Periods already running finish under these rules, and the 5-minute processor must stay enabled until they are finalized.`,
          )
        ) {
          return;
        }
        startTransition(async () => {
          const result = await deactivateRecoveryWindowsPolicy({ policyVersionId, lastEffectiveDate: lastDate });
          setError(result.error);
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="lastEffectiveDate">Last day the window rules apply ({countryName} local date)</Label>
          <Input id="lastEffectiveDate" type="date" min={minDate} value={lastDate} onChange={(e) => setLastDate(e.target.value)} required />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Working…" : "Stop after this date"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The earliest date allowed is {minDate} (tomorrow in {countryName}). Keep the background processor running until the alerts page shows no work remaining.
      </p>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </form>
  );
}
