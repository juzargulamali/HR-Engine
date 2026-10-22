"use client";

import { startTransition, useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { parseInventoryScan } from "@enginious-hr/domain";
import {
  cancelInventoryCount, checkInventoryTransaction, confirmInventoryCount, lookupCountUnit, saveInventoryCountLine, type CountUnitInfo,
} from "@/lib/actions/inventorySetup";
import type { InvActionState } from "@/lib/inventory/action-utils";
import { newMovementKey } from "@/lib/inventory/idempotency";
import { BALANCE_CONDITION_WORDS, formatQty, LIFECYCLE_WORDS } from "@/lib/inventory/words";
import {
  canConfirmCount, COUNT_KIND_WORDS, countDifference, expectedFor, isUncertainMessage, parseCountedQty, reasonRequired, type CountKind, type ShelfBalance,
} from "@/lib/inventory/setup";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionForm, Field } from "@/components/sales/action-form";
import { formatDateTime } from "@/components/sales/format";
import { SidePanel } from "@/components/workspace/side-panel";
import { QrScanner } from "@/components/inventory/qr-scanner";

export interface CountSheetData {
  id: string; code: string; kind: CountKind; status: "open" | "confirmed" | "cancelled"; note: string | null;
  locationId: string; locationName: string; startedByName: string; startedAt: string; confirmedByName: string | null; confirmedAt: string | null;
}
export interface SheetLineView {
  id: string; unitId: string | null; unitCode: string | null; itemId: string; itemName: string; binId: string | null; binCode: string | null;
  condition: string | null; expected: number | null; counted: number; reason: string | null; note: string | null; scale: number; unitOfMeasure: string;
}
export interface CountableItem { id: string; name: string; scale: number; unitOfMeasure: string }
export interface BinOption { id: string; code: string }
export interface NotCountedUnit { id: string; code: string; itemName: string }

export interface CountSheetProps {
  count: CountSheetData;
  companyId: string;
  /** May add, change and cancel lines (works at this location, or confirms stock). */
  canEdit: boolean;
  /** Holds confirm_stock (or is a founder): the only people who can confirm. */
  canConfirm: boolean;
  lines: readonly SheetLineView[];
  items: readonly CountableItem[];
  bins: readonly BinOption[];
  /** What the system holds on the shelf here today (cycle counts compare against it). */
  balances: readonly ShelfBalance[];
  /** Draft units at this location that are not on the count yet (opening counts). */
  notCounted: readonly NotCountedUnit[];
  onCancelled?: () => void;
}

const CONDITIONS = Object.entries(BALANCE_CONDITION_WORDS) as [string, string][];
const KEEP = "Your entries are kept. Fix the problem and save again.";

function saveLine(fields: Record<string, string | null | undefined>): Promise<InvActionState> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== "") fd.set(k, v);
  return saveInventoryCountLine({ error: null }, fd);
}

// ---------------------------------------------------------------------------------------------------------------
// Counted stock line
// ---------------------------------------------------------------------------------------------------------------
interface StockDraft { itemId: string; binId: string; condition: string; qty: string; reason: string }
const EMPTY_STOCK: StockDraft = { itemId: "", binId: "", condition: "good", qty: "", reason: "" };

function StockLineForm({ count, items, bins, balances, draft, onDraft, onSaved }: {
  count: CountSheetData; items: readonly CountableItem[]; bins: readonly BinOption[]; balances: readonly ShelfBalance[];
  draft: StockDraft; onDraft: (d: StockDraft) => void; onSaved: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(async (prev: InvActionState, fd: FormData): Promise<InvActionState> => {
    const result = await saveInventoryCountLine(prev, fd);
    if (result.error === null) onSaved();
    return result;
  }, { error: null } as InvActionState);
  const item = items.find((i) => i.id === draft.itemId) ?? null;
  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return t ? items.filter((i) => i.name.toLowerCase().includes(t) || i.id === draft.itemId) : items;
  }, [items, filter, draft.itemId]);
  const parsed = item ? parseCountedQty(draft.qty, item.scale, count.kind) : null;
  const expected = count.kind === "cycle" && item ? expectedFor(balances, item.id, draft.binId || null, draft.condition) : null;
  const needsReason = parsed?.ok === true && expected !== null && reasonRequired(count.kind, expected, parsed.value);
  const set = (patch: Partial<StockDraft>) => { setClientError(null); onDraft({ ...draft, ...patch }); };

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);
    if (!item) return setClientError("Choose the item you counted.");
    const q = parseCountedQty(draft.qty, item.scale, count.kind);
    if (!q.ok) return setClientError(q.error);
    if (count.kind === "cycle" && reasonRequired("cycle", expectedFor(balances, item.id, draft.binId || null, draft.condition), q.value) && draft.reason.trim() === "") {
      return setClientError("The count differs from what the system holds. Say why (for example: damaged and binned, found in another bin).");
    }
    const fd = new FormData();
    fd.set("countId", count.id);
    fd.set("itemId", item.id);
    if (draft.binId) fd.set("binId", draft.binId);
    fd.set("condition", draft.condition);
    fd.set("qty", String(q.value));
    if (draft.reason.trim()) fd.set("reason", draft.reason.trim());
    startTransition(() => formAction(fd));
  }
  const error = clientError ?? state.error;

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label="Add counted stock">
      <Field label="Find an item" htmlFor="cs-find"><Input id="cs-find" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Start typing the item name" autoComplete="off" /></Field>
      <Field label="Item" htmlFor="cs-item" hint={items.length === 0 ? "No counted-stock items are active yet. Add and activate them in the catalogue." : undefined}>
        <Select id="cs-item" value={draft.itemId} onChange={(e) => set({ itemId: e.target.value })}>
          <option value="">Choose an item…</option>
          {shown.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bin" htmlFor="cs-bin"><Select id="cs-bin" value={draft.binId} onChange={(e) => set({ binId: e.target.value })}><option value="">No bin</option>{bins.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</Select></Field>
        <Field label="Condition" htmlFor="cs-cond"><Select id="cs-cond" value={draft.condition} onChange={(e) => set({ condition: e.target.value })}>{CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      </div>
      <Field label={`Quantity you counted${item && item.unitOfMeasure !== "each" ? ` (${item.unitOfMeasure})` : ""}`} htmlFor="cs-qty" hint={expected !== null ? `The system holds ${formatQty(expected, item?.unitOfMeasure)} here. Type what you actually counted.` : count.kind === "opening" ? "Type what you counted on the shelf. It is never filled in for you." : undefined}>
        <Input id="cs-qty" inputMode="decimal" value={draft.qty} onChange={(e) => set({ qty: e.target.value })} autoComplete="off" placeholder="Type the number" className="max-w-[10rem]" />
      </Field>
      {count.kind === "cycle" && (needsReason || draft.reason !== "") ? (
        <Field label="Reason for the difference" htmlFor="cs-reason" hint="Required when the count differs from the system. It is kept with the correction.">
          <Textarea id="cs-reason" rows={2} value={draft.reason} onChange={(e) => set({ reason: e.target.value })} />
        </Field>
      ) : null}
      {error ? <Alert variant="destructive" role="alert">{error} {state.error && !clientError ? KEEP : ""}</Alert> : null}
      <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save this line"}</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// One unit line (by code or scan)
// ---------------------------------------------------------------------------------------------------------------
function UnitLineForm({ count, found, onFound, onSaved }: { count: CountSheetData; found: CountUnitInfo | null; onFound: (u: CountUnitInfo | null) => void; onSaved: () => void }) {
  const [typed, setTyped] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, startLookup] = useTransition();
  const [scanning, setScanning] = useState(false);
  const [present, setPresent] = useState<"1" | "0">("1");
  const [reason, setReason] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(async (prev: InvActionState, fd: FormData): Promise<InvActionState> => {
    const result = await saveInventoryCountLine(prev, fd);
    if (result.error === null) { setReason(""); setTyped(""); setPresent("1"); onSaved(); }
    return result;
  }, { error: null } as InvActionState);

  function lookup(raw: string) {
    setLookupError(null);
    setClientError(null);
    const parsed = parseInventoryScan(raw);
    if (!parsed.ok || parsed.kind !== "unit") { onFound(null); return setLookupError("That is not an equipment code. Codes look like UAE-E-00042."); }
    startLookup(async () => {
      const r = await lookupCountUnit(count.id, parsed.code);
      if (r.error || !r.unit) { onFound(null); setLookupError(r.error ?? "No unit with that code is available to you."); return; }
      onFound(r.unit);
      setPresent("1");
      setReason("");
    });
  }
  const counted = count.kind === "opening" ? 1 : Number(present);
  const needsReason = found ? reasonRequired(count.kind, found.expected, counted) : false;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);
    if (!found) return setClientError("Look up the unit first.");
    if (needsReason && reason.trim() === "") return setClientError(counted === 0 ? "Say why this unit was not found." : "Say why this unit is found again.");
    const fd = new FormData();
    fd.set("countId", count.id);
    fd.set("unitId", found.id);
    fd.set("qty", String(counted));
    if (reason.trim()) fd.set("reason", reason.trim());
    startTransition(() => formAction(fd));
  }
  const error = clientError ?? state.error;
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) lookup(typed.trim()); }} aria-label="Find a unit">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="cs-unit-code" className="mb-1 block text-sm font-medium leading-none">Equipment code</label>
          <Input id="cs-unit-code" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. UAE-E-00042" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        </div>
        <Button type="submit" variant="secondary" disabled={!typed.trim() || looking}>{looking ? "Looking…" : "Look up"}</Button>
        <Button type="button" variant="ghost" onClick={() => setScanning((s) => !s)}><Camera className="h-4 w-4" aria-hidden /> {scanning ? "Hide the camera" : "Scan a label"}</Button>
      </form>
      {scanning ? <QrScanner onRead={(raw) => { setTyped(raw); lookup(raw); }} onClose={() => setScanning(false)} /> : null}
      {lookupError ? <Alert variant="warning" role="status">{lookupError}</Alert> : null}
      {found ? (
        <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-border p-3" aria-label="Count this unit">
          <div>
            <p className="font-medium">{found.code} <span className="font-normal text-muted-foreground">· {found.itemName}</span></p>
            <p className="text-sm text-muted-foreground">{found.lifecycleWords} · {found.custodyWords}</p>
          </div>
          {count.kind === "cycle" ? (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Is it here?</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="present" value="1" checked={present === "1"} onChange={() => setPresent("1")} /> Found on the shelf (counted 1)</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="present" value="0" checked={present === "0"} onChange={() => setPresent("0")} /> Not found (counted 0)</label>
              <p className="text-sm text-muted-foreground">The system expects {found.expected === 1 ? "this unit to be on the shelf" : "this unit not to be on the shelf"}.</p>
            </fieldset>
          ) : <p className="text-sm text-muted-foreground">A single unit is counted as 1. Counting it here makes it real stock once the count is confirmed.</p>}
          {needsReason ? (
            <Field label="Reason" htmlFor="cs-unit-reason" hint="Required: this differs from what the system expects."><Textarea id="cs-unit-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          ) : null}
          {error ? <Alert variant="destructive" role="alert">{error} {state.error && !clientError ? KEEP : ""}</Alert> : null}
          <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save this line"}</Button></div>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Draft units waiting for the opening count
// ---------------------------------------------------------------------------------------------------------------
function NotCountedList({ countId, units }: { countId: string; units: readonly NotCountedUnit[] }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (units.length === 0) return null;
  const shown = units.slice(0, 60);
  async function count(u: NotCountedUnit) {
    setBusy(u.id);
    setErrors((e) => { const next = { ...e }; delete next[u.id]; return next; });
    const r = await saveLine({ countId, unitId: u.id, qty: "1" });
    setBusy(null);
    if (r.error) setErrors((e) => ({ ...e, [u.id]: r.error! }));
  }
  return (
    <section aria-labelledby="cs-waiting" className="space-y-2">
      <h3 id="cs-waiting" className="text-sm font-semibold">Registered here but not counted yet ({units.length})</h3>
      <p className="text-sm text-muted-foreground">These units are catalogued at this location. They stay marked <strong>Not counted yet</strong>, and are not available, until they are counted and the count is confirmed. Counted here means you have seen the unit on the shelf.</p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {shown.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0"><p className="break-words text-sm font-medium">{u.code} <span className="font-normal text-muted-foreground">· {u.itemName}</span></p>{errors[u.id] ? <p role="alert" className="text-sm text-destructive">{errors[u.id]}</p> : null}</div>
            <div className="flex items-center gap-2"><Badge variant="warning">{LIFECYCLE_WORDS.draft}</Badge><Button type="button" size="sm" variant="outline" disabled={busy === u.id} onClick={() => void count(u)}>{busy === u.id ? "Saving…" : "Counted here"}<span className="sr-only">{` ${u.code}`}</span></Button></div>
          </li>
        ))}
      </ul>
      {units.length > shown.length ? <p className="text-sm text-muted-foreground">Showing the first {shown.length}. Count these, then the rest will appear.</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------------------------------------------
function ConfirmPanel({ count, companyId, lines, onConfirmed }: { count: CountSheetData; companyId: string; lines: readonly SheetLineView[]; onConfirmed: () => void }) {
  // One key for this confirmation, kept until it succeeds: a double click or a retry after a lost connection cannot confirm twice.
  const [note, setNote] = useState("");
  // A new note is a different request, so it gets its own key; the same request retried keeps its key and can never be recorded twice.
  const [issued, setIssued] = useState(() => ({ note: "", key: newMovementKey("count") }));
  if (issued.note !== note.trim()) setIssued({ note: note.trim(), key: newMovementKey("count") });
  const [check, setCheck] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [state, formAction, pending] = useActionState(async (prev: InvActionState, fd: FormData): Promise<InvActionState> => {
    const result = await confirmInventoryCount(prev, fd);
    if (result.error === null) onConfirmed();
    return result;
  }, { error: null } as InvActionState);
  const verdict = canConfirmCount(count.kind, count.status, lines.map((l) => ({ counted: l.counted, expected: l.expected, reason: l.reason })));
  const differences = lines.filter((l) => reasonRequired(count.kind, l.expected, l.counted)).length;
  const done = state.error === null && state.detail !== undefined;
  const uncertain = isUncertainMessage(state.error);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("companyId", companyId);
    fd.set("countId", count.id);
    fd.set("key", issued.key);
    if (note.trim()) fd.set("note", note.trim());
    startTransition(() => formAction(fd));
  }

  if (done) {
    const d = state.detail ?? {};
    return (
      <Alert variant="success" role="status">
        Confirmed. {typeof d.units === "number" && d.units > 0 ? `${d.units} ${d.units === 1 ? "unit" : "units"}` : ""}{typeof d.units === "number" && d.units > 0 && typeof d.quantity_lines === "number" && d.quantity_lines > 0 ? " and " : ""}
        {typeof d.quantity_lines === "number" && d.quantity_lines > 0 ? `${d.quantity_lines} counted ${d.quantity_lines === 1 ? "line" : "lines"}` : ""}
        {typeof d.adjustments === "number" && d.adjustments > 0 ? `, ${d.adjustments} ${d.adjustments === 1 ? "correction" : "corrections"} recorded` : ""}. {state.replayed ? "This was already confirmed earlier; nothing was recorded twice." : ""}
      </Alert>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label="Confirm this count">
      <h3 className="text-sm font-semibold">Review and confirm</h3>
      <p className="text-sm text-muted-foreground">
        {count.kind === "opening"
          ? "Confirming turns the counted units and quantities into real, verified stock. Your name and the time are recorded."
          : "Confirming records every difference as a correction with its reason. Nothing is deleted. Your name and the time are recorded."}
        {` ${lines.length} ${lines.length === 1 ? "line" : "lines"}${count.kind === "cycle" ? `, ${differences} ${differences === 1 ? "difference" : "differences"}` : ""}.`}
      </p>
      <Field label="Note (optional)" htmlFor="cs-confirm-note"><Textarea id="cs-confirm-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {!verdict.ok && verdict.why ? <p className="text-sm text-muted-foreground" role="status">{verdict.why}</p> : null}
      {state.error ? <Alert variant="destructive" role="alert">{state.error}</Alert> : null}
      {uncertain ? (
        <div className="space-y-2">
          <Button type="button" variant="outline" size="sm" disabled={checking} onClick={() => startCheck(async () => { const r = await checkInventoryTransaction(companyId, issued.key); setCheck(r.error ?? (r.status === "recorded" ? `It went through${r.code ? ` (${r.code})` : ""}. Reload the page.` : r.status === "in_progress" ? "It is still being recorded. Check again in a moment." : "It was not recorded. You can confirm again.")); })}>{checking ? "Checking…" : "Check whether it went through"}</Button>
          {check ? <p role="status" className="text-sm">{check}</p> : null}
        </div>
      ) : null}
      <div className="flex justify-end"><Button type="submit" disabled={pending || !verdict.ok}>{pending ? "Confirming…" : "Confirm this count"}</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------------------------------------------
export function CountSheetBody({ count, companyId, canEdit, canConfirm, lines, items, bins, balances, notCounted, onCancelled }: CountSheetProps) {
  const [mode, setMode] = useState<"stock" | "unit">("stock");
  const [stock, setStock] = useState<StockDraft>(EMPTY_STOCK);
  const [found, setFound] = useState<CountUnitInfo | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const open = count.status === "open";
  const sheetLines = lines.map((l) => ({ counted: l.counted, expected: l.expected, reason: l.reason }));
  const missing = lines.filter((l) => reasonRequired(count.kind, l.expected, l.counted) && !(l.reason ?? "").trim()).length;

  function change(l: SheetLineView) {
    if (l.unitId && l.unitCode) {
      setMode("unit");
      setFound({ id: l.unitId, code: l.unitCode, itemId: l.itemId, itemName: l.itemName, lifecycle: "", lifecycleWords: "", custodyWords: "", condition: l.condition ?? "good", binId: l.binId, locationId: null, expected: (l.expected ?? 0) === 1 ? 1 : 0 });
    } else {
      setMode("stock");
      setStock({ itemId: l.itemId, binId: l.binId ?? "", condition: l.condition ?? "good", qty: String(l.counted), reason: l.reason ?? "" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant={count.status === "open" ? "warning" : count.status === "confirmed" ? "success" : "outline"}>{count.status === "open" ? "Open" : count.status === "confirmed" ? "Confirmed" : "Cancelled"}</Badge>
          <span className="font-medium">{COUNT_KIND_WORDS[count.kind].label} at {count.locationName}</span>
        </p>
        <p className="text-muted-foreground">{COUNT_KIND_WORDS[count.kind].help}</p>
        <p className="text-muted-foreground">Started by {count.startedByName}, {formatDateTime(count.startedAt)}.</p>
        {count.status === "confirmed" && count.confirmedAt ? <p><strong>Verified by {count.confirmedByName ?? "a colleague"}</strong> on {formatDateTime(count.confirmedAt)}.</p> : null}
        {count.note ? <p className="whitespace-pre-line break-words text-muted-foreground">{count.note}</p> : null}
      </div>

      {open && canEdit ? (
        <section aria-labelledby="cs-add" className="space-y-3">
          <h3 id="cs-add" className="text-sm font-semibold">Add a counted line</h3>
          <div role="tablist" aria-label="What did you count?" className="inline-flex rounded-md border border-border p-0.5">
            <button type="button" role="tab" aria-selected={mode === "stock"} onClick={() => setMode("stock")} className={`rounded px-3 py-1 text-sm ${mode === "stock" ? "bg-secondary font-medium" : "text-muted-foreground"}`}>Counted stock</button>
            <button type="button" role="tab" aria-selected={mode === "unit"} onClick={() => setMode("unit")} className={`rounded px-3 py-1 text-sm ${mode === "unit" ? "bg-secondary font-medium" : "text-muted-foreground"}`}>One unit by code</button>
          </div>
          {mode === "stock"
            ? <StockLineForm count={count} items={items} bins={bins} balances={balances} draft={stock} onDraft={setStock} onSaved={() => setStock({ ...EMPTY_STOCK, binId: stock.binId })} />
            : <UnitLineForm count={count} found={found} onFound={setFound} onSaved={() => setFound(null)} />}
        </section>
      ) : null}
      {open && !canEdit ? <Alert role="status">You can read this count, but you cannot change it: only a founder or a warehouse operator at {count.locationName} can add lines.</Alert> : null}

      {open && canEdit && count.kind === "opening" ? <NotCountedList countId={count.id} units={notCounted} /> : null}

      <section aria-labelledby="cs-lines" className="space-y-2">
        <h3 id="cs-lines" className="text-sm font-semibold">Counted so far ({lines.length})</h3>
        {lines.length === 0 ? <p className="text-sm text-muted-foreground">Nothing counted yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Counted</TableHead><TableHead>Expected</TableHead><TableHead>Counted qty</TableHead><TableHead>Difference</TableHead><TableHead>Reason</TableHead>{open && canEdit ? <TableHead><span className="sr-only">Change</span></TableHead> : null}</TableRow></TableHeader>
            <TableBody>
              {lines.map((l) => {
                const diff = l.expected === null ? null : countDifference(l.expected, l.counted);
                const needs = reasonRequired(count.kind, l.expected, l.counted);
                return (
                  <TableRow key={l.id}>
                    <TableCell className="min-w-[10rem]"><span className="font-medium">{l.unitCode ?? l.itemName}</span>{l.unitCode ? <span className="block text-sm text-muted-foreground">{l.itemName}</span> : null}<span className="block text-sm text-muted-foreground">{[l.binCode ? `Bin ${l.binCode}` : null, l.condition ? (BALANCE_CONDITION_WORDS as Record<string, string>)[l.condition] ?? l.condition : null].filter(Boolean).join(" · ")}</span></TableCell>
                    <TableCell>{count.kind === "opening" ? "—" : l.expected === null ? "—" : formatQty(l.expected, l.unitOfMeasure)}</TableCell>
                    <TableCell className="font-medium">{formatQty(l.counted, l.unitOfMeasure)}</TableCell>
                    <TableCell>{count.kind === "opening" || diff === null ? "—" : diff === 0 ? "None" : `${diff > 0 ? "+" : ""}${formatQty(diff, l.unitOfMeasure)}`}</TableCell>
                    <TableCell className="max-w-[14rem] break-words">{l.reason ? l.reason : needs ? <Badge variant="warning">Reason needed</Badge> : "—"}</TableCell>
                    {open && canEdit ? <TableCell><Button type="button" size="sm" variant="ghost" onClick={() => change(l)}>Change<span className="sr-only">{` ${l.unitCode ?? l.itemName}`}</span></Button></TableCell> : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {open && lines.length > 0 ? <p className="text-sm text-muted-foreground">To change a line, use Change and save it again: the new entry replaces the old one. To start over, cancel the count.{missing > 0 ? ` ${missing} still ${missing === 1 ? "needs" : "need"} a reason.` : ""}</p> : null}
      </section>

      {open || justConfirmed ? (canConfirm ? <ConfirmPanel count={count} companyId={companyId} lines={lines} onConfirmed={() => setJustConfirmed(true)} /> : <Alert role="status">Only a founder, or someone allowed to confirm stock counts, can confirm this count. Ask them to review it here.</Alert>) : null}

      {open && canEdit ? (
        <div className="border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setCancelling(true)}>Cancel this count</Button>
          <Modal open={cancelling} onClose={() => setCancelling(false)} title="Cancel this count?" description={count.code}>
            <ActionForm action={cancelInventoryCount} submitLabel="Cancel the count" pendingLabel="Cancelling…" variant="destructive" onDone={() => { setCancelling(false); onCancelled?.(); }} secondary={<Button type="button" variant="ghost" onClick={() => setCancelling(false)}>Keep it</Button>}>
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="countId" value={count.id} />
              <p className="text-sm">Nothing counted here becomes stock, and the units stay as they were. The count stays in the history.</p>
              <Field label="Why is it cancelled?" htmlFor="cs-cancel-reason"><Textarea id="cs-cancel-reason" name="reason" rows={2} required /></Field>
            </ActionForm>
          </Modal>
        </div>
      ) : null}
      {sheetLines.length === 0 && count.status === "confirmed" ? <p className="text-sm text-muted-foreground">This count had no lines.</p> : null}
    </div>
  );
}

/** The count sheet in the side panel: opened by `?count=ID`, closed by Back, shareable. */
export function CountSheet(props: CountSheetProps & { closeHref: string }) {
  const router = useRouter();
  const { closeHref, ...body } = props;
  return (
    <SidePanel title={`Count ${props.count.code}`} subtitle={`${COUNT_KIND_WORDS[props.count.kind].label} · ${props.count.locationName}`} closeHref={closeHref}>
      <CountSheetBody {...body} onCancelled={() => router.push(closeHref, { scroll: false })} />
    </SidePanel>
  );
}
