"use client";

import { useState } from "react";
import { recordOpportunityCheck, requestOpportunityCheck } from "@/lib/actions/inventoryPlanning";
import type { SalesCheckView } from "@/lib/inventory/planning";
import { formatDateTime } from "@/components/sales/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Field, InvForm } from "./inv-form";
import { TONE_BADGE, TONE_TEXT } from "./status";

export interface SalesCardLocation { id: string; name: string }

/**
 * What Sales sees of the warehouse check on one enquiry: the latest recorded result in words, who checked and when, whether it is out of
 * date, and a summary per technology. A technology without a complete template reads "Warehouse check required" and is never green.
 * It says plainly that checking does not reserve anything. No costs, no custody, no unrelated projects.
 */
export function AvailabilityCardView({ view, opportunityId, locations, canAsk, canRecord, defaultLocationId }: {
  view: SalesCheckView; opportunityId: string; locations: SalesCardLocation[]; canAsk: boolean; canRecord: boolean; defaultLocationId?: string | null;
}) {
  const [dialog, setDialog] = useState<null | "ask" | "record">(null);
  const close = () => setDialog(null);
  return (
    <section aria-label="Equipment availability" className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Equipment availability</h3>
        <Badge variant="outline" className={cn("whitespace-nowrap", TONE_BADGE[view.tone])} data-tone={view.tone}>{view.headline}</Badge>
      </div>

      {view.state === "none" ? (
        <p className="mt-2 text-sm">Nobody has checked the warehouse for this enquiry yet. <strong>Warehouse check required.</strong></p>
      ) : null}
      {view.state === "pending" ? (
        <p className="mt-2 text-sm">Waiting for the warehouse{view.pendingBy ? `: asked by ${view.pendingBy}` : ""}{view.pendingAt ? ` on ${formatDateTime(view.pendingAt)}` : ""}.</p>
      ) : null}
      {view.state === "checked" ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Checked{view.checkedBy ? ` by ${view.checkedBy}` : ""}{view.checkedAt ? ` on ${formatDateTime(view.checkedAt)}` : ""}{view.locationName ? ` against ${view.locationName}` : ""}.{view.note ? ` Note: ${view.note}` : ""}
        </p>
      ) : null}

      {view.outOfDate ? (
        <Alert variant="warning" role="status" className="mt-3">Out of date: dates, location, technologies or quantities changed since the check. Ask the warehouse to check again before relying on it.</Alert>
      ) : null}
      {view.state === "checked" && view.warehouseCheckRequired ? (
        <Alert variant="warning" role="status" className="mt-3">Warehouse check required for at least one technology: it has no complete template, so nothing can be said about it from stock.</Alert>
      ) : null}

      {view.rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border text-sm">
          {view.rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0 break-words font-medium">{r.name}{r.qty ? <span className="font-normal text-muted-foreground"> × {r.qty}</span> : null}</span>
                <span className={cn("font-medium", TONE_TEXT[r.tone])}>{r.status}</span>
              </div>
              {r.shortages.map((s) => <p key={s} className="text-muted-foreground">{s}</p>)}
              {r.alternatives.map((a) => <p key={a} className="text-muted-foreground">{a}</p>)}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-sm text-muted-foreground">Checking availability does not reserve anything.</p>

      {canAsk || canRecord ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canAsk ? <Button type="button" size="sm" variant="outline" onClick={() => setDialog("ask")}>{view.state === "pending" ? "Ask again" : "Ask the warehouse to check"}</Button> : null}
          {canRecord ? <Button type="button" size="sm" onClick={() => setDialog("record")}>Record the check now</Button> : null}
        </div>
      ) : null}

      {dialog === "ask" ? (
        <Modal open onClose={close} title="Ask the warehouse to check" description="The warehouse looks at stock for this enquiry's dates and technologies and records the result with a name and a time. Nothing is reserved.">
          <InvForm action={requestOpportunityCheck} submitLabel="Ask the warehouse" pendingLabel="Asking…" onDone={close}>
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <LocationField locations={locations} defaultLocationId={defaultLocationId} optional />
          </InvForm>
        </Modal>
      ) : null}
      {dialog === "record" ? (
        <Modal open onClose={close} title="Record the check now" description="Works out the result from stock today for this enquiry's dates and saves it, with your name and the time. Nothing is reserved.">
          <InvForm action={recordOpportunityCheck} submitLabel="Record the check" pendingLabel="Checking…" onDone={close}>
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <LocationField locations={locations} defaultLocationId={defaultLocationId} />
            <Field label="Note (optional)" htmlFor={`rc-note-${opportunityId}`}><Input id={`rc-note-${opportunityId}`} name="note" maxLength={300} /></Field>
          </InvForm>
        </Modal>
      ) : null}
    </section>
  );
}

function LocationField({ locations, defaultLocationId, optional = false }: { locations: SalesCardLocation[]; defaultLocationId?: string | null; optional?: boolean }) {
  if (locations.length === 0) {
    return optional
      ? <p className="text-sm text-muted-foreground">The warehouse will choose the location.</p>
      : <Alert role="status">There is no active location to check against.</Alert>;
  }
  return (
    <Field label="Location to check against" htmlFor="oc-loc" hint={optional ? "Optional: leave it open and the warehouse chooses." : undefined}>
      <Select id="oc-loc" name="locationId" defaultValue={defaultLocationId ?? (optional ? "" : (locations[0]?.id ?? ""))} required={!optional}>
        {optional ? <option value="">Warehouse decides</option> : null}
        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </Select>
    </Field>
  );
}
