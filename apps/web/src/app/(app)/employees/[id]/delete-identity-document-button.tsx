"use client";

import { useState, useTransition } from "react";
import { deleteIdentityDocument } from "@/lib/actions/employees";
import { Button } from "@/components/ui/button";

export function DeleteIdentityDocumentButton({ documentId, employeeId }: { documentId: string; employeeId: string }) {
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
          if (!window.confirm("Delete this identity document? This can't be undone.")) return;
          startTransition(async () => {
            const result = await deleteIdentityDocument(documentId, employeeId);
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
