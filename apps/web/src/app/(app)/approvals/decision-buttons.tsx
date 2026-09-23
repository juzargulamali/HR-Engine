"use client";

import { useState, useTransition } from "react";
import { decideApproval } from "@/lib/actions/approvals";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function DecisionButtons({ approvalId }: { approvalId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function approve() {
    if (!window.confirm("Approve this request?")) return;
    startTransition(async () => {
      const result = await decideApproval({ approvalId, decision: "approved" });
      setError(result.error);
    });
  }

  function confirmReject() {
    startTransition(async () => {
      const result = await decideApproval({ approvalId, decision: "rejected", comments: reason.trim() || undefined });
      setError(result.error);
      if (!result.error) setRejecting(false);
    });
  }

  if (rejecting) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejecting (shown to the requester)"
          rows={2}
          className="w-64"
        />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" disabled={pending} onClick={confirmReject}>
            Confirm reject
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={approve}>
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
          Reject
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
