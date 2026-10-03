"use client";

import { useState, useTransition } from "react";
import { acknowledgeRecoveryAlert } from "@/lib/actions/recoveryWindows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** HR acknowledges an alert once they have looked into it. Acknowledging never stops anything or changes any hours. */
export function AcknowledgeAlertForm({ alertId }: { alertId: string }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await acknowledgeRecoveryAlert({ alertId, note });
          setError(result.error);
        });
      }}
    >
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-8 text-xs" aria-label="Acknowledgement note" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Acknowledge"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}
