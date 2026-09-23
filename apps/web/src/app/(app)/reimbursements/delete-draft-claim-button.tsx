"use client";

import { useState, useTransition } from "react";
import { deleteDraftClaim } from "@/lib/actions/reimbursements";
import { Button } from "@/components/ui/button";

export function DeleteDraftClaimButton({ claimId }: { claimId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Delete this draft claim? This can't be undone.")) return;
          startTransition(async () => {
            const result = await deleteDraftClaim(claimId);
            setError(result.error);
          });
        }}
      >
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
