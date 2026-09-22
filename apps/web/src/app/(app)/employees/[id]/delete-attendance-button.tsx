"use client";

import { useState, useTransition } from "react";
import { deleteAttendanceRecord } from "@/lib/actions/attendance";
import { Button } from "@/components/ui/button";

export function DeleteAttendanceButton({ recordId, employeeId }: { recordId: string; employeeId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteAttendanceRecord(recordId, employeeId);
            setError(result.error);
          })
        }
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
