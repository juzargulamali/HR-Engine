"use client";

import { useState, useTransition } from "react";
import { activateRecoveryWindowsPolicy } from "@/lib/actions/recoveryWindows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

/**
 * Controlled activation of a window-based Recovery Leave policy. There is no
 * plain "Activate" for this kind of policy: HR chooses the effective date,
 * which must be AFTER today in the country's own time zone so no history is
 * recalculated. The version currently in force ends the day before; sessions
 * already open at that point keep the rules they started under.
 */
export function ActivateRecoveryWindowsForm({
  policyVersionId,
  minDate,
  supersedesLabel,
  countryName,
}: {
  policyVersionId: string;
  minDate: string;
  supersedesLabel: string | null;
  countryName: string;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(minDate);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !window.confirm(
            `Activate this Recovery Leave version for ${countryName} from ${effectiveFrom}? ${
              supersedesLabel ? `${supersedesLabel} will end on the day before. ` : ""
            }Clock-ins that start on or after ${effectiveFrom} use the new window rules; sessions already open before then finish under the old rules.`,
          )
        ) {
          return;
        }
        startTransition(async () => {
          const result = await activateRecoveryWindowsPolicy({ policyVersionId, effectiveFrom });
          setError(result.error);
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="effectiveFrom">Effective from ({countryName} local date)</Label>
          <Input id="effectiveFrom" type="date" min={minDate} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Activating…" : "Activate from this date"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The earliest date allowed is {minDate} (tomorrow in {countryName}). Nothing already calculated is changed.
      </p>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </form>
  );
}
