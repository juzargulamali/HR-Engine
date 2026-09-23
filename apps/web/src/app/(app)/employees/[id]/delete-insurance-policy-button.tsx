"use client";

import { useState, useTransition } from "react";
import { deleteInsurancePolicy } from "@/lib/actions/employees";
import { Button } from "@/components/ui/button";

export function DeleteInsurancePolicyButton({ policyId, employeeId }: { policyId: string; employeeId: string }) {
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
          if (!window.confirm("Delete this insurance policy? This can't be undone.")) return;
          startTransition(async () => {
            const result = await deleteInsurancePolicy(policyId, employeeId);
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
