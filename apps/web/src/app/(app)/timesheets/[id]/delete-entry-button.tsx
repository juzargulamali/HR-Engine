"use client";

import { useState, useTransition } from "react";
import { deleteTimesheetEntry } from "@/lib/actions/timesheets";
import { Button } from "@/components/ui/button";

export function DeleteEntryButton({ entryId, timesheetId }: { entryId: string; timesheetId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Remove this entry?")) return;
          startTransition(async () => {
            const result = await deleteTimesheetEntry(entryId, timesheetId);
            setError(result.error);
          });
        }}
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
