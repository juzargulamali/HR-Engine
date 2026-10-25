"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { SummaryRow } from "@/lib/inventory/stock-movements";
import type { useMovementFlow } from "./use-movement-flow";

type Flow = ReturnType<typeof useMovementFlow>;

/**
 * The step between "Review" and "Confirm": what will be recorded, in words, and nothing changes until the Confirm button here is pressed.
 * After an uncertain failure it offers "Check whether it went through" and locks the entry as it is.
 */
export function ReviewPanel({ flow, rows, confirmLabel, onConfirm }: { flow: Flow; rows: readonly SummaryRow[]; confirmLabel: string; onConfirm: () => void }) {
  const uid = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const sending = flow.phase === "sending";
  return (
    <section className="space-y-4" aria-labelledby={`${uid}-review`} data-step="review">
      <div>
        <h3 id={`${uid}-review`} ref={heading} tabIndex={-1} style={{ outline: "none" }} className="font-heading text-base font-semibold">Check before you confirm</h3>
        <p className="text-sm text-muted-foreground">This is what will be recorded. Nothing has changed yet.</p>
      </div>
      <dl className="divide-y divide-border rounded-md border border-border text-sm">
        {rows.map((r) => (
          <div key={r.label} className="grid gap-1 px-3 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-[13px] font-medium text-muted-foreground">{r.label}</dt>
            <dd className="whitespace-pre-line break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
      {flow.error ? <Alert variant="destructive" role="alert">{flow.error}</Alert> : null}
      {flow.uncertain ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm">We do not know whether this was recorded. Check before sending it again. The same entry cannot be recorded twice, but a changed one could be.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void flow.runCheck()} disabled={flow.checking}>{flow.checking ? "Checking…" : "Check whether it went through"}</Button>
            {flow.check?.state === "not_recorded" ? <Button type="button" variant="ghost" onClick={flow.startNew}>Start a new entry (keeps what you typed)</Button> : null}
          </div>
          {flow.check ? <p role="status" className={`text-sm ${flow.check.state === "error" ? "text-destructive" : ""}`}>{flow.check.text}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={flow.toEdit} disabled={sending || flow.uncertain}>Back to edit</Button>
        <Button type="button" onClick={onConfirm} disabled={sending}>{sending ? "Recording…" : flow.uncertain ? "Try again with the same entry" : confirmLabel}</Button>
      </div>
    </section>
  );
}

/** Shown only after the database said it was recorded. */
export function DonePanel({ flow, onAnother, onClose }: { flow: Flow; onAnother: () => void; onClose?: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <div className="space-y-4" data-step="done">
      <Alert variant="success" role="status">
        <h3 ref={heading} tabIndex={-1} style={{ outline: "none" }} className="font-semibold">Recorded</h3>
        <p className="mt-1">{flow.outcome?.message ?? "Recorded."}</p>
      </Alert>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onAnother}>Record another</Button>
        <Link href="/inventory/movements" className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">See it in Movements</Link>
        {onClose ? <Button type="button" onClick={onClose}>Done</Button> : null}
      </div>
    </div>
  );
}
