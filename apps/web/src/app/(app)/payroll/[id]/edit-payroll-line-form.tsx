"use client";

import { useState, useTransition } from "react";
import { updatePayrollLineAmount } from "@/lib/actions/payroll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Inline per-line amount correction. The user always types the positive
 * magnitude — updatePayrollLineAmount() re-applies the sign convention
 * server-side from the line's own component_code, and marks the line
 * is_manual so a future "re-check for new lines" never overwrites it.
 */
export function EditPayrollLineForm({ lineId, runId, currentAmount }: { lineId: string; runId: string; currentAmount: number }) {
  const [value, setValue] = useState(Math.abs(currentAmount).toString());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setError("Enter a positive amount.");
          return;
        }
        startTransition(async () => {
          const result = await updatePayrollLineAmount(lineId, runId, parsed);
          setError(result.error);
        });
      }}
    >
      <Input
        type="number"
        step="0.01"
        min="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 w-28 text-xs"
        aria-label="Amount"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}
