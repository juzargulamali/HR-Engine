"use client";

import { useState, useTransition } from "react";
import { permanentlyDeleteEmployee, restoreEmployee, softDeleteEmployee } from "@/lib/actions/employees";
import { Button } from "@/components/ui/button";

export function RestoreOrRemoveEmployeeButton({
  employeeId,
  employeeName,
  deleted,
}: {
  employeeId: string;
  employeeName: string;
  deleted: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [permanentPending, startPermanentTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (deleted) {
    return (
      <div className="space-y-1 text-right">
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || permanentPending}
            onClick={() => startTransition(async () => setError((await restoreEmployee(employeeId)).error))}
          >
            {pending ? "Restoring…" : "Restore"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending || permanentPending}
            onClick={() => {
              if (
                !window.confirm(
                  `Permanently delete ${employeeName}? This destroys their entire record — contracts, salary history, leave, payroll, documents, everything — forever. This cannot be undone. Restoring afterward will not be possible.`,
                )
              ) {
                return;
              }
              startPermanentTransition(async () => {
                const result = await permanentlyDeleteEmployee(employeeId);
                setError(result.error);
              });
            }}
          >
            {permanentPending ? "Deleting…" : "Permanently delete"}
          </Button>
        </div>
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
          if (!window.confirm("Remove this employee? Their record is kept and can be restored, but they'll disappear from active lists everywhere.")) {
            return;
          }
          startTransition(async () => setError((await softDeleteEmployee(employeeId)).error));
        }}
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
