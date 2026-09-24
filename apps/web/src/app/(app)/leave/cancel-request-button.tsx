"use client";

import { useState, useTransition } from "react";
import { cancelLeaveRequest } from "@/lib/actions/leave";
import { Button } from "@/components/ui/button";

export function CancelRequestButton({ requestId, restoresBalance = false }: { requestId: string; restoresBalance?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          const confirmMessage = restoresBalance
            ? "Cancel this approved leave request? Any leave balance it deducted will be restored."
            : "Cancel this leave request?";
          if (!window.confirm(confirmMessage)) return;
          startTransition(async () => {
            const result = await cancelLeaveRequest(requestId);
            setError(result.error);
          });
        }}
      >
        {pending ? "Cancelling…" : "Cancel"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
