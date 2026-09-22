"use client";

import { useState, useTransition } from "react";
import { decideLeaveApproval } from "@/lib/actions/leave";
import { Button } from "@/components/ui/button";

export function DecisionButtons({ approvalId }: { approvalId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "approved" | "rejected") {
    startTransition(async () => {
      const result = await decideLeaveApproval({ approvalId, decision });
      setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => decide("approved")}>
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("rejected")}>
          Reject
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
