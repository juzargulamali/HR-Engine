"use client";

import { useState, useTransition } from "react";
import { deleteHoliday } from "@/lib/actions/policies";
import { Button } from "@/components/ui/button";

export function DeleteHolidayButton({ holidayId }: { holidayId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Remove this holiday from the calendar?")) return;
          startTransition(async () => setError((await deleteHoliday(holidayId)).error));
        }}
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
