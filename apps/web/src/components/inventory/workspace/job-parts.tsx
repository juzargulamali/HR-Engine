"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { formatQty } from "@/lib/inventory/words";
import type { Flag } from "@/lib/inventory/workspace";
import { cn } from "@/lib/utils";
import type { useMovementFlow } from "../stock/use-movement-flow";

/** Small parts shared by the Pick, Send and Receive steps of one equipment job. */

/**
 * The four quantities of one item on a request, always in the same order and always with their words (never colour alone):
 * Requested (what the Project Manager asked for), Reserved (held for the request's dates), Picked (taken off the shelf, sent or not), Sent (left the warehouse).
 */
export function QtyStrip({ asked, reserved, picked, sent, uom, pickKnown = true }: { asked: number; reserved: number; picked: number; sent: number; uom: string; pickKnown?: boolean }) {
  const cell = (label: string, value: number, strong = false) => (
    <div className="min-w-0 rounded-md bg-secondary/50 px-2 py-1.5 text-center" data-qty={label.toLowerCase()}>
      <dt className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("text-base tabular-nums", strong ? "font-semibold" : "font-medium")}>{formatQty(value)}</dd>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5">
      <dl className={cn("grid flex-1 gap-1.5", pickKnown ? "grid-cols-4" : "grid-cols-3")} aria-label={`Quantities${uom && uom !== "each" ? ` in ${uom}` : ""}`}>
        {cell("Requested", asked)}
        {cell("Reserved", reserved, reserved < asked)}
        {pickKnown ? cell("Picked", picked) : null}
        {cell("Sent", sent)}
      </dl>
      <InfoHint label="the four quantities">
        Requested is what the Project Manager asked for. Reserved is held for this request&apos;s dates. Picked has been taken off the shelf for this job. Sent has left the warehouse.
        When Reserved is less than Requested the line is short: the rest has to be reserved, bought or rented, and is not counted as done.
      </InfoHint>
    </div>
  );
}

export function FlagList({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;
  return (
    <ul aria-label="Check these first" className="space-y-1.5">
      {flags.map((f) => (
        <li key={f.text} role={f.level === "block" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", f.level === "block" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10")}>
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden /><span>{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * After a save whose result is not known (time ran out, the connection dropped): the list is kept exactly as it is, and the person first asks whether it was
 * recorded. Only when the answer is "not recorded" is sending it again offered. The same entry can never be recorded twice.
 */
export function UncertainSave({ flow, what, onRetry }: { flow: ReturnType<typeof useMovementFlow>; what: string; onRetry?: () => void }) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-uncertain>
      <p className="text-sm">We do not know whether this {what} was recorded. Your list is kept as it is. Check before sending it again.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => void flow.runCheck()} disabled={flow.checking} className="h-11 sm:h-9">{flow.checking ? "Checking…" : "Check whether it went through"}</Button>
        {flow.check?.state === "not_recorded" && onRetry ? <Button type="button" onClick={onRetry} className="h-11 sm:h-9">Send it again</Button> : null}
      </div>
      {flow.check ? <p role="status" className={cn("text-sm", flow.check.state === "error" && "text-destructive")}>{flow.check.text}</p> : null}
    </div>
  );
}
