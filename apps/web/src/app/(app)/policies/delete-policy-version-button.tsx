"use client";

import { useState, useTransition } from "react";
import { deletePolicyVersion } from "@/lib/actions/policies";
import { Button } from "@/components/ui/button";

export function DeletePolicyVersionButton({ policyVersionId }: { policyVersionId: string }) {
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
          if (!window.confirm("Delete this draft policy version?")) return;
          startTransition(async () => setError((await deletePolicyVersion(policyVersionId)).error));
        }}
      >
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
