"use client";

import { useState, useTransition } from "react";
import { confirmPolandTerminationLeaveManuallyReconciled } from "@/lib/actions/employees";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/**
 * The escape hatch for when the automatic Poland Annual Leave termination
 * true-up couldn't run (see the blocked reason above this button) — HR
 * Admin has already been told to post the correct amount manually via a
 * leave-ledger adjustment. This confirms that's been done, so Final
 * Settlement can be prepared; it does NOT post any ledger amount itself.
 * Only rendered on the blocked Poland Final Settlement screen when there is
 * no pending excess to acknowledge instead (final-settlement-section.tsx).
 */
export function ConfirmPolandManualReconciliationButton({ employeeId }: { employeeId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Only confirm this after you have verified — or manually posted, via a leave-ledger adjustment — the correct Annual
        Leave true-up for this employee&apos;s exact termination date. Confirming does not post any leave amount itself.
      </p>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await confirmPolandTerminationLeaveManuallyReconciled(employeeId);
            setError(result.error);
          })
        }
      >
        {pending ? "Confirming…" : "Confirm Annual Leave was manually reconciled"}
      </Button>
    </div>
  );
}
