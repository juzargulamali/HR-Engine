"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOutreachPriority } from "@/lib/actions/events";
import { PRIORITIES, priorityLabel } from "@/lib/crm/clients-agencies/directory";
import { Select } from "@/components/ui/select";

/**
 * The ONE shared outreach priority of an account (1 to 5, 5 highest, Unrated). It is the team's rating of who to approach, not a review score, and the same for every
 * company. Saved the moment it is chosen (one tap on a phone); any Sales grant may set it, and the database repeats the check.
 */
export function PriorityControl({ orgId, value, label = "Outreach priority", compact = false }: { orgId: string; value: number | null; label?: string; compact?: boolean }) {
  const id = useId();
  const router = useRouter();
  const [current, setCurrent] = useState<number | null>(value);
  const [status, setStatus] = useState<{ kind: "idle" | "saved" | "error"; text: string }>({ kind: "idle", text: "" });
  const [pending, start] = useTransition();
  function choose(raw: string) {
    const next = raw === "" ? null : Number(raw);
    const before = current;
    setCurrent(next);
    setStatus({ kind: "idle", text: "" });
    start(async () => {
      const r = await setOutreachPriority(orgId, next);
      if (r.error) { setCurrent(before); setStatus({ kind: "error", text: r.error }); return; }
      setStatus({ kind: "saved", text: next === null ? "Priority cleared." : `Priority set to ${priorityLabel(next)}.` });
      router.refresh();
    });
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={compact ? "sr-only" : "text-sm font-medium leading-none"}>{label}</label>
      <Select id={id} value={current === null ? "" : String(current)} disabled={pending} onChange={(e) => choose(e.target.value)} className={compact ? "min-h-10 w-auto" : "max-w-xs"}>
        <option value="">Unrated</option>
        {PRIORITIES.map((p) => <option key={p} value={p}>{p === 5 ? "5 (highest)" : p === 1 ? "1 (lowest)" : String(p)}</option>)}
      </Select>
      {status.text ? <p className={status.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"} role={status.kind === "error" ? "alert" : "status"}>{status.text}</p> : null}
    </div>
  );
}
