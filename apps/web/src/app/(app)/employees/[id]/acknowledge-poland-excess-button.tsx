"use client";

import { useState, useTransition } from "react";
import { acknowledgePolandTerminationLeaveExcess } from "@/lib/actions/employees";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/**
 * The one, explicit, audited HR action that clears a pending Poland
 * termination Annual Leave excess so Final Settlement can be prepared — see
 * poland_termination_leave_reconciliations' own migration header comment
 * for why this is never automatic. Only rendered when
 * checkPolandTerminationSettlementReadiness reports a positive,
 * unacknowledged excessRequiringReview (final-settlement-section.tsx).
 */
export function AcknowledgePolandExcessButton({ employeeId }: { employeeId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acknowledgePolandTerminationLeaveExcess(employeeId);
            setError(result.error);
          })
        }
      >
        {pending ? "Acknowledging…" : "Acknowledge excess and allow settlement preparation"}
      </Button>
    </div>
  );
}
