"use client";

import { useState, useTransition } from "react";
import { acknowledgeRecoveryReduction, verifyRecoveryWindow } from "@/lib/actions/recoveryWindows";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";

/** HR records what they checked before a window carrying a review condition can be approved. */
export function VerifyWindowForm({ windowId }: { windowId: string }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What did you verify, and with whom? (required)"
        rows={2}
        className="min-h-16 text-xs"
        aria-label="Verification note"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || note.trim().length === 0}
        onClick={() =>
          startTransition(async () => {
            const result = await verifyRecoveryWindow({ windowId, note });
            setError(result.error);
          })
        }
      >
        {pending ? "Saving…" : "Mark window as verified"}
      </Button>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}

/** A reduction that touches credit already used must be acknowledged explicitly: it would otherwise leave a negative balance. */
export function AcknowledgeReductionForm({ requestId }: { requestId: string }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="How will the already-used balance be handled? (required)"
        rows={2}
        className="min-h-16 text-xs"
        aria-label="Acknowledgement note"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || note.trim().length === 0}
        onClick={() =>
          startTransition(async () => {
            const result = await acknowledgeRecoveryReduction({ requestId, note });
            setError(result.error);
          })
        }
      >
        {pending ? "Saving…" : "Acknowledge the reduction"}
      </Button>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}
