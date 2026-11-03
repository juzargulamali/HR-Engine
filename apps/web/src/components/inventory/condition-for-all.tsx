"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { CONDITION_WORDS } from "@/lib/inventory/words";

/**
 * "Set the condition for all ticked lines": one choice, applied on request to the lines the person already ticked (or put on the list). It starts empty
 * every time (never "Good"), does nothing until a condition is chosen and at least one line is ticked, and each line can still be changed afterwards.
 */
export function ConditionForAll({ count, noun = "ticked", onApply, disabled }: { count: number; noun?: string; onApply: (value: string) => string; disabled?: boolean }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 px-3 py-2.5" role="group" aria-label={`Set the condition for all ${noun} lines`}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">Set the condition for all {noun} lines</label>
        <Select id={id} value={value} onChange={(e) => { setValue(e.target.value); setDone(null); }} disabled={disabled || count === 0} className="h-9 w-auto min-w-44">
          <option value="">Choose condition</option>
          {Object.entries(CONDITION_WORDS).map(([v, w]) => <option key={v} value={v}>{w}</option>)}
        </Select>
        <Button type="button" size="sm" variant="outline" disabled={disabled || value === "" || count === 0} onClick={() => { setDone(onApply(value)); setValue(""); }}>
          Apply to {count} {noun} {count === 1 ? "line" : "lines"}
        </Button>
      </div>
      {count === 0 ? <p className="text-xs text-muted-foreground">Nothing is ticked yet. This only changes lines you have ticked.</p> : null}
      {done ? <p role="status" className="text-xs text-muted-foreground">{done}</p> : null}
    </div>
  );
}
