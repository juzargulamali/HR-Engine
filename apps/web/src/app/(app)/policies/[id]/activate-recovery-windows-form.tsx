"use client";

import { useState, useTransition } from "react";
import { activateRecoveryWindowsPolicy, setRecoveryWindowsDraftDate } from "@/lib/actions/recoveryWindows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

/**
 * Controlled activation of a window-based Recovery Leave policy. Same people as every other policy version: an HR Admin,
 * or the CEO/CTO (who may activate but never change the draft, so they can only use the date HR already set on it);
 * never the person who drafted it. The effective date must be AFTER today in the country's own time zone so no history is
 * recalculated. The version in force ends the day before; a working period keeps the rules it started under, so a restart
 * within 8 hours of an earlier session never switches rules mid-period. The database also refuses until the 5-minute
 * background processor is verified running.
 */
export function ActivateRecoveryWindowsForm({
  policyVersionId,
  minDate,
  plannedDate,
  canChooseDate,
  supersedesLabel,
  countryName,
  scheduler,
}: {
  policyVersionId: string;
  minDate: string;
  /** The effective date currently stored on the draft. */
  plannedDate: string;
  /** HR Admin may choose the date; the CEO/CTO may only use the planned one. */
  canChooseDate: boolean;
  supersedesLabel: string | null;
  countryName: string;
  /** Read for HR Admin only; null = not shown (the database check still applies). */
  scheduler: { ready: boolean; reasons: string[] } | null;
}) {
  const plannedUsable = plannedDate >= minDate;
  const [effectiveFrom, setEffectiveFrom] = useState(plannedUsable ? plannedDate : minDate);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const date = canChooseDate ? effectiveFrom : plannedDate;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !window.confirm(
            `Activate this Recovery Leave version for ${countryName} from ${date}? ${
              supersedesLabel ? `${supersedesLabel} will end on the day before. ` : ""
            }Clock-ins that start on or after ${date} use the new window rules, except a restart less than 8 hours after an earlier session, which stays in that working period under the rules it started with.`,
          )
        ) {
          return;
        }
        startTransition(async () => {
          const result = await activateRecoveryWindowsPolicy({ policyVersionId, effectiveFrom: canChooseDate ? effectiveFrom : null });
          setError(result.error);
        });
      }}
    >
      {scheduler ? (
        scheduler.ready ? (
          <p className="text-sm" data-testid="scheduler-gate">
            <span aria-hidden>● </span>5-minute processor verified running — activation is allowed.
          </p>
        ) : (
          <Alert variant="destructive" data-testid="scheduler-gate">
            The 5-minute processor is not verified, so activation will be refused: {scheduler.reasons.join("; ")}. The owner enables it with
            supabase/manual-sql/recovery_windows_30_enable_scheduler.sql.
          </Alert>
        )
      ) : null}

      {canChooseDate ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="effectiveFrom">Effective from ({countryName} local date)</Label>
            <Input id="effectiveFrom" type="date" min={minDate} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Working…" : "Activate from this date"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setRecoveryWindowsDraftDate({ policyVersionId, plannedDate: effectiveFrom });
                setError(result.error);
                setSaved(!result.error);
              })
            }
          >
            Save as the draft&apos;s planned date
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <p className="text-sm">
            Effective date set by HR on this draft: <strong>{plannedDate}</strong>
            {plannedUsable ? "" : ` — that date has passed or is today (earliest allowed ${minDate}); ask an HR Admin to set a new date.`}
          </p>
          <Button type="submit" disabled={pending || !plannedUsable}>
            {pending ? "Activating…" : `Activate on ${plannedDate}`}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        The earliest date allowed is {minDate} (tomorrow in {countryName}). Nothing already calculated is changed.
        {canChooseDate ? " Saving a planned date lets the CEO/CTO activate on exactly that date; they cannot change it." : ""}
      </p>
      {saved ? <p className="text-sm text-muted-foreground">Planned date saved on the draft.</p> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </form>
  );
}
