"use client";

import { useState, useTransition } from "react";
import { restoreCompany, softDeleteCompany } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";

export function DeactivateOrRestoreCompanyButton({ companyId, deactivated }: { companyId: string; deactivated: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (deactivated) {
    return (
      <div className="space-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => setError((await restoreCompany(companyId)).error))}
        >
          {pending ? "Restoring…" : "Restore"}
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Deactivate this company? It disappears from every picker/list app-wide until restored.")) return;
          startTransition(async () => setError((await softDeleteCompany(companyId)).error));
        }}
      >
        {pending ? "Deactivating…" : "Deactivate"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
