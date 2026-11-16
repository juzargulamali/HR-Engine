"use client";

import { useState, useTransition } from "react";
import { acknowledgeQueueItem } from "@/lib/actions/hrQueue";
import type { QueueKind } from "@/lib/hr/queue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * "Mark as seen". It records that HR looked at the item and nothing else: the issue is not resolved by it, and the item stays in the queue (as Acknowledged, with the same link) until the
 * record itself is fixed. The sentence under the button says so, so nobody mistakes it for a resolution.
 */
export function AcknowledgeItemForm({ kind, sourceId, sourceDate, employeeId }: { kind: Exclude<QueueKind, "ai_suggestion">; sourceId: string; sourceDate: string; employeeId: string | null }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex w-full flex-col gap-1.5 sm:w-auto sm:min-w-[14rem]"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await acknowledgeQueueItem({ kind, sourceId, sourceDate, employeeId: employeeId ?? undefined, note });
          setError(result.error);
        });
      }}
    >
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={500} className="h-9 text-sm" aria-label="Note for this acknowledgement" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Mark as seen"}
      </Button>
      <p className="text-[13px] text-muted-foreground">Only records that you saw it. It stays listed until the record is fixed.</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
