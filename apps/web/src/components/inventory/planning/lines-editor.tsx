"use client";

import { useEffect, useState } from "react";
import { cancelRequestLine, decideSubstitution, proposeSubstitution, releaseReservation, reserveLine, setShortageAction, unitsForReserve, updateRequestLine, type FreeUnitOption } from "@/lib/actions/inventoryPlanning";
import { formatInZone, formatQtyPlain, shortageLabel, type ReservationLite } from "@/lib/inventory/planning";
import type { LineModel } from "@/lib/inventory/planning-data";
import { formatQty } from "@/lib/inventory/words";
import { listTable } from "@/components/workspace/list-table";
import { MoreMenu, type MoreItem } from "@/components/workspace/more-menu";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Field, InvForm } from "./inv-form";
import { SubstitutionBadge } from "./substitution";

export interface EditorRequest {
  id: string; status: string; kind: "project" | "employee"; projectId: string | null; timezone: string; neededFrom: string | null; neededUntil: string | null; pickupLocationId: string | null;
}
export interface EditorCan {
  /** May change the request (the database makes the real decision). */
  edit: boolean;
  /** May accept or decline a proposed substitute: the project manager or whoever is accountable, never the warehouse alone. */
  decide: boolean;
  /** Warehouse people: reserve and release. */
  warehouse: boolean;
  /** The locations this person may reserve from. */
  operableLocationIds: string[];
}
export interface LocationOption { id: string; name: string }

type Dialog = "edit" | "cancel" | "substitute" | "decide" | "shortage" | "reserve" | null;

const LIVE = new Set(["submitted", "in_progress"]);

/** The lines of one request, with progress in numbers and every line action that is allowed. A cancelled line stays visible, with what is still out. */
export function LinesEditor({ request, lines, can, locations }: { request: EditorRequest; lines: LineModel[]; can: EditorCan; locations: LocationOption[] }) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No lines yet. Add an item, or add everything a technology needs from its template.</p>;
  const operable = locations.filter((l) => can.operableLocationIds.includes(l.id));
  return (
    <Table className={`min-w-[46rem] ${listTable}`}>
      <caption className="sr-only">Equipment lines of this request</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Item</TableHead>
          <TableHead scope="col" className="text-right">Needed</TableHead>
          <TableHead scope="col" className="text-right">Reserved</TableHead>
          <TableHead scope="col" className="text-right">Dispatched</TableHead>
          <TableHead scope="col" className="text-right">Returned</TableHead>
          <TableHead scope="col" className="text-right">Outstanding</TableHead>
          <TableHead scope="col">If short</TableHead>
          <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l) => <LineRow key={l.id} line={l} request={request} can={can} locations={operable} />)}
      </TableBody>
    </Table>
  );
}

const num = "whitespace-nowrap text-right tabular-nums";

function LineRow({ line: l, request, can, locations }: { line: LineModel; request: EditorRequest; can: EditorCan; locations: LocationOption[] }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const editable = request.status === "draft" || LIVE.has(request.status);
  const open = l.status === "open";
  const live = LIVE.has(request.status);
  const q = (n: number) => formatQty(n, l.unit);
  const hasActive = l.reservations.some((r) => r.status === "active");
  const items: MoreItem[] = [];
  if (can.edit && editable && open) {
    items.push({ key: "edit", label: "Change quantity or note", onSelect: () => setDialog("edit") });
    if (l.substituteOptions.length > 0) items.push({ key: "substitute", label: "Propose a substitute", disabled: hasActive, hint: hasActive ? "Release this line's reservations first" : "Only alternatives listed in the template", onSelect: () => setDialog("substitute") });
    if (live && (l.progress.shortage > 0 || l.shortageAction !== "none")) items.push({ key: "shortage", label: "Need to buy or rent", onSelect: () => setDialog("shortage") });
    items.push({ key: "cancel", label: "Cancel this line", danger: true, separatorBefore: true, onSelect: () => setDialog("cancel") });
  }
  const showReserve = can.warehouse && live && open && l.progress.toReserve > 0 && locations.length > 0;
  const showDecide = can.decide && l.substitution.state === "proposed" && open && editable;
  return (
    <>
      <TableRow className={`align-top ${l.status === "cancelled" ? "text-muted-foreground" : ""}`}>
        <TableCell className="min-w-[12rem]">
          <div className="break-words font-medium">{l.itemName}{l.status === "cancelled" ? <span className="font-normal"> (cancelled)</span> : null}</div>
          {l.itemModel ? <div className="text-sm text-muted-foreground">{l.itemModel}</div> : null}
          <div className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
            {l.technologyName ? <span>From {l.technologyName}</span> : null}
            {l.isOptional ? <span>Optional</span> : null}
          </div>
          {l.note ? <div className="text-sm text-muted-foreground">Note: {l.note}</div> : null}
          <div className="mt-1"><SubstitutionBadge status={l.substitution.state} originalItemName={l.originalItemName} itemName={l.itemName} note={l.substitutionNote} /></div>
        </TableCell>
        <TableCell data-label="Needed" className={num}>{q(l.qty)}</TableCell>
        <TableCell data-label="Reserved" className={num}>
          {q(l.progress.reserved)}
          {l.progress.shortage > 0 ? <span className="block text-sm font-medium text-amber-800 dark:text-amber-300">short by {q(l.progress.shortage)}</span> : null}
        </TableCell>
        <TableCell data-label="Dispatched" className={num}>{q(l.progress.dispatched)}</TableCell>
        <TableCell data-label="Returned" className={num}>{q(l.progress.returned)}</TableCell>
        <TableCell data-label="Outstanding" className={`${num} ${l.progress.outstanding > 0 ? "font-semibold" : ""}`}>{q(l.progress.outstanding)}</TableCell>
        <TableCell data-label="If short" className="min-w-[8rem]">
          {l.shortageAction === "none" ? <span className="text-muted-foreground">{l.progress.shortage > 0 ? "Not decided yet" : "—"}</span> : (
            <span className="break-words">{shortageLabel(l.shortageAction)}{l.rentalReference ? <span className="block text-sm text-muted-foreground">Ref {l.rentalReference}</span> : null}{l.shortageNote ? <span className="block text-sm text-muted-foreground">{l.shortageNote}</span> : null}</span>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap max-md:text-left">
          <div className="flex flex-wrap items-center justify-end gap-2 max-md:justify-start">
            {showReserve ? <Button type="button" size="sm" onClick={() => setDialog("reserve")}>Reserve</Button> : null}
            {showDecide ? <Button type="button" size="sm" variant="outline" onClick={() => setDialog("decide")}>Accept or decline</Button> : null}
            <MoreMenu items={items} />
          </div>
          {dialog === "edit" ? <EditDialog line={l} request={request} onClose={close} /> : null}
          {dialog === "cancel" ? <CancelLineDialog line={l} request={request} onClose={close} /> : null}
          {dialog === "substitute" ? <SubstituteDialog line={l} request={request} onClose={close} /> : null}
          {dialog === "decide" ? <DecideDialog line={l} request={request} onClose={close} /> : null}
          {dialog === "shortage" ? <ShortageDialog line={l} request={request} onClose={close} /> : null}
          {dialog === "reserve" ? <ReserveDialog line={l} request={request} locations={locations} onClose={close} /> : null}
        </TableCell>
      </TableRow>
      {l.reservations.length > 0 ? (
        <TableRow className="border-b-0 max-md:block">
          <TableCell colSpan={8} className="pt-0 max-md:block max-md:text-left">
            <ReservationList line={l} request={request} canRelease={can.edit || can.warehouse} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

const hidden = (request: EditorRequest) => request.projectId ? <input type="hidden" name="projectId" value={request.projectId} /> : null;

function ReservationList({ line, request, canRelease }: { line: LineModel; request: EditorRequest; canRelease: boolean }) {
  const [releasing, setReleasing] = useState<ReservationLite | null>(null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">Reservations ({line.reservations.filter((r) => r.status !== "released").length}{line.reservations.some((r) => r.status === "released") ? `, ${line.reservations.filter((r) => r.status === "released").length} released` : ""})</summary>
      <ul className="mt-2 space-y-1.5">
        {line.reservations.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md border border-border px-3 py-1.5">
            <span className="min-w-0 break-words">
              <span className="font-medium">{r.unit_code ?? (r.unit_id ? "One unit" : `${formatQtyPlain(Number(r.qty))} counted stock`)}</span>
              {r.serial_number ? <span className="text-muted-foreground"> · serial {r.serial_number}</span> : null}
              <span className="text-muted-foreground"> · {formatInZone(r.from ?? null, request.timezone)} to {formatInZone(r.until ?? null, request.timezone)}</span>
            </span>
            <span className="text-muted-foreground">
              {r.status === "released" ? `Released${r.released_reason ? `: ${r.released_reason}` : ""}` : `${r.status === "completed" ? "Completed" : "Active"} · dispatched ${formatQtyPlain(Number(r.dispatched_qty))}, returned ${formatQtyPlain(Number(r.returned_qty))}`}
              {canRelease && r.status === "active" && Number(r.dispatched_qty) < Number(r.qty) ? <> · <button type="button" className="font-medium underline underline-offset-2 hover:text-foreground" onClick={() => setReleasing(r)}>Release</button></> : null}
            </span>
          </li>
        ))}
      </ul>
      {releasing ? (
        <Modal open onClose={() => setReleasing(null)} title="Release this reservation" description="The equipment becomes free for other requests. Anything already dispatched stays reserved and outstanding until it is returned.">
          <InvForm action={releaseReservation} submitLabel="Release" pendingLabel="Releasing…" variant="destructive" onDone={() => setReleasing(null)}>
            <input type="hidden" name="reservationId" value={releasing.id} />
            {hidden(request)}
            <Field label="Why (optional)" htmlFor={`rel-${releasing.id}`}><Input id={`rel-${releasing.id}`} name="reason" maxLength={200} /></Field>
          </InvForm>
        </Modal>
      ) : null}
    </details>
  );
}

function EditDialog({ line, request, onClose }: { line: LineModel; request: EditorRequest; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Change ${line.itemName}`} description={line.progress.reserved > 0 ? `${formatQty(line.progress.reserved, line.unit)} is already reserved: ask for less only after releasing some.` : undefined}>
      <InvForm action={updateRequestLine} submitLabel="Save" onDone={onClose}>
        <input type="hidden" name="lineId" value={line.id} />
        {line.version !== undefined ? <input type="hidden" name="expectedVersion" value={line.version} /> : null}
        {hidden(request)}
        <Field label="Quantity needed" htmlFor={`q-${line.id}`}><Input id={`q-${line.id}`} name="qty" type="number" inputMode="decimal" min="0" step="any" defaultValue={line.qty} required /></Field>
        <Field label="Note" htmlFor={`n-${line.id}`}><Input id={`n-${line.id}`} name="note" defaultValue={line.note ?? ""} maxLength={300} /></Field>
        {line.technologyName ? <p className="text-sm text-muted-foreground">This line came from a template, as a snapshot. Changing the quantity here does not change the template.</p> : null}
      </InvForm>
    </Modal>
  );
}

function CancelLineDialog({ line, request, onClose }: { line: LineModel; request: EditorRequest; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Cancel ${line.itemName}`} description="Reservations that were not used are released. Equipment that has already been dispatched stays outstanding until it is returned: cancelling does not bring it back.">
      <InvForm action={cancelRequestLine} submitLabel="Cancel this line" variant="destructive" onDone={onClose}>
        <input type="hidden" name="lineId" value={line.id} />
        {hidden(request)}
        <Field label="Why (optional)" htmlFor={`c-${line.id}`}><Input id={`c-${line.id}`} name="reason" maxLength={200} /></Field>
        {line.progress.outstanding > 0 ? <Alert variant="warning" role="status">{formatQty(line.progress.outstanding, line.unit)} is already out and stays outstanding until it is returned.</Alert> : null}
      </InvForm>
    </Modal>
  );
}

function SubstituteDialog({ line, request, onClose }: { line: LineModel; request: EditorRequest; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Propose a substitute for ${line.itemName}`} description="Only alternatives written into the technology template can be offered. Different models are never assumed to be interchangeable.">
      <InvForm action={proposeSubstitution} submitLabel="Propose" onDone={onClose}>
        <input type="hidden" name="lineId" value={line.id} />
        {line.version !== undefined ? <input type="hidden" name="expectedVersion" value={line.version} /> : null}
        {hidden(request)}
        <Field label="Alternative" htmlFor={`s-${line.id}`}>
          <Select id={`s-${line.id}`} name="itemId" required defaultValue="">
            <option value="" disabled>Choose an alternative</option>
            {line.substituteOptions.map((o) => <option key={o.itemId} value={o.itemId}>{o.qty === null ? `${o.name} (the template's standard item)` : o.name}</option>)}
          </Select>
        </Field>
        <Field label="Note (optional)" htmlFor={`sn-${line.id}`}><Input id={`sn-${line.id}`} name="note" maxLength={300} /></Field>
        <Alert role="status">A proposed substitute is marked <strong>Substitute — not yet accepted</strong>. Until the project manager accepts it, the warehouse keeps preparing {line.originalItemName ?? line.itemName}.</Alert>
      </InvForm>
    </Modal>
  );
}

function DecideDialog({ line, request, onClose }: { line: LineModel; request: EditorRequest; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Accept or decline the substitute" description={`${line.itemName} is proposed instead of ${line.originalItemName ?? "the standard item"}.`}>
      <InvForm action={decideSubstitution} submitLabel="Save my decision" onDone={onClose}>
        <input type="hidden" name="lineId" value={line.id} />
        {hidden(request)}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Your decision</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="accept" value="yes" required /> Accept {line.itemName}. Anything reserved of the original is released.</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="accept" value="no" required /> Decline. {line.originalItemName ?? "The original"} stays on the line.</label>
        </fieldset>
        <Field label="Note (optional)" htmlFor={`d-${line.id}`}><Input id={`d-${line.id}`} name="note" maxLength={300} /></Field>
      </InvForm>
    </Modal>
  );
}

function ShortageDialog({ line, request, onClose }: { line: LineModel; request: EditorRequest; onClose: () => void }) {
  const [action, setAction] = useState(line.shortageAction);
  return (
    <Modal open onClose={onClose} title={`If ${line.itemName} is short`} description="Say what happens to the part stock cannot cover. This only records the decision: nothing is bought or rented from here.">
      <InvForm action={setShortageAction} submitLabel="Save" onDone={onClose}>
        <input type="hidden" name="lineId" value={line.id} />
        {hidden(request)}
        <Field label="What happens to the shortage" htmlFor={`sa-${line.id}`}>
          <Select id={`sa-${line.id}`} name="action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="none">Nothing decided yet</option>
            <option value="need_to_buy">Need to buy</option>
            <option value="need_to_rent">Need to rent</option>
          </Select>
        </Field>
        {action === "need_to_rent" ? (
          <Field label="External reference of the rental" htmlFor={`sr-${line.id}`} hint="The supplier's quote or order number.">
            <Input id={`sr-${line.id}`} name="rentalReference" defaultValue={line.rentalReference ?? ""} maxLength={160} required />
          </Field>
        ) : null}
        {action !== "none" ? <Field label="Note (optional)" htmlFor={`sm-${line.id}`}><Textarea id={`sm-${line.id}`} name="note" rows={2} defaultValue={line.shortageNote ?? ""} maxLength={300} /></Field> : null}
      </InvForm>
    </Modal>
  );
}

/** Warehouse: reserve from one location. Free ones are picked automatically, or named units are chosen. A partial result is accepted and explained. */
function ReserveDialog({ line, request, locations, onClose }: { line: LineModel; request: EditorRequest; locations: LocationOption[]; onClose: () => void }) {
  const individual = line.tracking === "individual" || line.tracking === "kit";
  const [locationId, setLocationId] = useState(locations.find((l) => l.id === request.pickupLocationId)?.id ?? locations[0]?.id ?? "");
  const [mode, setMode] = useState<"auto" | "units">("auto");
  const [short, setShort] = useState("");
  const key = `${line.id}:${locationId}`;
  const [answer, setAnswer] = useState<{ key: string; error: string | null; list: FreeUnitOption[]; free: number | null } | null>(null);
  useEffect(() => {
    if (!individual || !locationId) return;
    let cancelled = false;
    unitsForReserve(line.id, locationId)
      .then((r) => { if (!cancelled) setAnswer({ key, error: r.error, list: r.units, free: r.free }); })
      .catch(() => { if (!cancelled) setAnswer({ key, error: "Could not load the units. Try again.", list: [], free: null }); });
    return () => { cancelled = true; };
  }, [individual, line.id, locationId, key]);
  // The answer belongs to one line and one location; while another is being loaded the old list is not shown.
  const current = answer && answer.key === key ? answer : null;
  const units = { loading: individual && !!locationId && current === null, error: current?.error ?? null, list: current?.list ?? [], free: current?.free ?? null };
  return (
    <Modal open onClose={onClose} size="wide" title={`Reserve ${line.itemName}`} description={`${formatQty(line.progress.toReserve, line.unit)} still to reserve for ${request.neededFrom ? `${formatInZone(request.neededFrom, request.timezone)} to ${formatInZone(request.neededUntil, request.timezone)} (${request.timezone})` : "the request dates"}.`}>
      <InvForm action={reserveLine} submitLabel="Reserve" pendingLabel="Reserving…" onDone={onClose}>
        <input type="hidden" name="lineId" value={line.id} />
        {hidden(request)}
        <Field label="Reserve from" htmlFor={`rl-${line.id}`}>
          <Select id={`rl-${line.id}`} name="locationId" value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        {individual ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Which ones</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="auto" checked={mode === "auto"} onChange={() => setMode("auto")} /> Pick free ones for me{units.free !== null ? ` (${units.free} free for these dates)` : ""}</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="units" checked={mode === "units"} onChange={() => setMode("units")} /> Choose named units</label>
          </fieldset>
        ) : <input type="hidden" name="mode" value="auto" />}
        {mode === "auto" ? (
          <Field label={individual ? "How many" : `Quantity${line.unit !== "each" ? ` (${line.unit})` : ""}`} htmlFor={`rq-${line.id}`} hint="What is free is reserved; the rest is reported, never forced.">
            <Input id={`rq-${line.id}`} name="qty" type="number" inputMode="decimal" min="0" step="any" defaultValue={line.progress.toReserve} required />
          </Field>
        ) : (
          <div className="space-y-1">
            {units.loading ? <p className="text-sm text-muted-foreground" role="status">Loading units…</p> : null}
            {units.error ? <Alert variant="destructive">{units.error}</Alert> : null}
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {units.list.map((u) => (
                <li key={u.id} className="flex items-start gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                  <input id={`u-${u.id}`} type="checkbox" name="unitIds" value={u.id} disabled={!u.free} className="mt-1" />
                  <label htmlFor={`u-${u.id}`} className={u.free ? "" : "text-muted-foreground"}>
                    <span className="font-medium">{u.code}</span>{u.serial ? ` · serial ${u.serial}` : ""}
                    {u.free ? <Badge variant="outline" className="ml-2 border-emerald-500/40 text-emerald-800 dark:text-emerald-300">Free for these dates</Badge> : <span className="block text-sm">{u.reason ?? "Not available for these dates"}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field label="If not everything can be reserved, mark the rest as" htmlFor={`rs-${line.id}`}>
          <Select id={`rs-${line.id}`} name="shortageAction" value={short} onChange={(e) => setShort(e.target.value)}>
            <option value="">Leave as it is</option>
            <option value="need_to_buy">Need to buy</option>
            <option value="need_to_rent">Need to rent</option>
            <option value="none">Nothing to buy or rent</option>
          </Select>
        </Field>
        {short === "need_to_rent" ? <Field label="External reference of the rental" htmlFor={`rr-${line.id}`}><Input id={`rr-${line.id}`} name="rentalReference" maxLength={160} /></Field> : null}
      </InvForm>
    </Modal>
  );
}

