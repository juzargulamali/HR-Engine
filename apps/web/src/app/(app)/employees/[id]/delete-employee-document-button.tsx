"use client";

import { useState, useTransition } from "react";
import { deleteEmployeeDocument, restoreEmployeeDocument } from "@/lib/actions/employees";
import { Button } from "@/components/ui/button";

export function DeleteEmployeeDocumentButton({
  documentId,
  employeeId,
  deleted,
}: {
  documentId: string;
  employeeId: string;
  deleted: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (deleted) {
    return (
      <div className="space-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => setError((await restoreEmployeeDocument(documentId, employeeId)).error))}
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
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Remove this document? HR Admin can restore it later, but it stops appearing everywhere else.")) return;
          startTransition(async () => setError((await deleteEmployeeDocument(documentId, employeeId)).error));
        }}
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
