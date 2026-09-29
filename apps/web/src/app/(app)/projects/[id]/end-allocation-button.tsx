"use client";

import { useState, useTransition } from "react";
import { endProjectAllocation } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";

export function EndAllocationButton({ allocationId, projectId }: { allocationId: string; projectId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("End this allocation as of today? This stops it from routing this employee's Recovery Leave to this project's manager.")) return;
          startTransition(async () => {
            const result = await endProjectAllocation(allocationId, projectId);
            setError(result.error);
          });
        }}
      >
        {pending ? "Ending…" : "End"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
