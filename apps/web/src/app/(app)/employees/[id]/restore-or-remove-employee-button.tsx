"use client";

import { useState, useTransition } from "react";
import { restoreEmployee, softDeleteEmployee } from "@/lib/actions/employees";
import { Button } from "@/components/ui/button";

export function RestoreOrRemoveEmployeeButton({ employeeId, deleted }: { employeeId: string; deleted: boolean }) {
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
          onClick={() => startTransition(async () => setError((await restoreEmployee(employeeId)).error))}
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
