"use client";

import { useState, useTransition } from "react";
import { deleteClaimLine } from "@/lib/actions/reimbursements";
import { Button } from "@/components/ui/button";

export function DeleteLineButton({ lineId, claimId }: { lineId: string; claimId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Remove this expense line? Its receipt (if any) is removed too.")) return;
          startTransition(async () => {
            const result = await deleteClaimLine(lineId, claimId);
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
