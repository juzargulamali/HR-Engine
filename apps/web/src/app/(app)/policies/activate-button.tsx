"use client";

import { useState, useTransition } from "react";
import { activatePolicy } from "@/lib/actions/policies";
import { Button } from "@/components/ui/button";

export function ActivateButton({ policyVersionId }: { policyVersionId: string }) {
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
            const result = await activatePolicy(policyVersionId);
            setError(result.error);
          })
        }
      >
        {pending ? "Activating…" : "Activate"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
