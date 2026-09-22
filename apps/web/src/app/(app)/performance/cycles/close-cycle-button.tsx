"use client";

import { useState, useTransition } from "react";
import { closePerformanceCycle } from "@/lib/actions/performance";
import { Button } from "@/components/ui/button";

export function CloseCycleButton({ cycleId }: { cycleId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Close this cycle? No further goals or appraisals can be added once it's closed.")) return;
          startTransition(async () => setError((await closePerformanceCycle(cycleId)).error));
        }}
      >
        {pending ? "Closing…" : "Close cycle"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
