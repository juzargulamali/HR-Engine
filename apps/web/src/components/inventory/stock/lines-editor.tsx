"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera, Plus, Search, Trash2 } from "lucide-react";
import { parseInventoryScan, addToPendingList, type PendingScanLine } from "@enginious-hr/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { QrScanner } from "@/components/inventory/qr-scanner";
import { draftFromCandidate, unitProblemFor, type Candidate } from "@/lib/inventory/stock-candidates";
import { KIND_CONFIG, sourceFor, type AdjustAction, type LineDraft, type MovementKind } from "@/lib/inventory/stock-movements";
import { BALANCE_CONDITION_WORDS, CONDITION_WORDS, formatQty } from "@/lib/inventory/words";
import type { MovementServices } from "./movement-services";

export interface HeldSource {
  candidates: readonly Candidate[];
  loading: boolean;
  error: string | null;
  /** Said when nothing is held / nothing is on the way. */
  emptyText: string;
  title: string;
}

interface Props {
  kind: MovementKind;
  adjustAction?: AdjustAction;
  services: Pick<MovementServices, "search" | "read">;
  companyId: string;
  locationId: string | null;
  bins: readonly { id: string; code: string; label: string | null }[];
  drafts: LineDraft[];
  onChange: (next: LineDraft[]) => void;
  held?: HeldSource | null;
  rentalId?: string | null;
  canSeeCosts?: boolean;
  disabled?: boolean;
  lineError?: { id: string; message: string } | null;
  /** The form's own check for lines that come from a holder (a return): says in words why a candidate cannot be added, or null. */
  acceptHeld?: (c: Candidate) => string | null;
  /** A scanned unit told us who holds it: lets the form fill in the holder. */
  onHolderFound?: (c: Candidate) => void;
  /** Wording of the empty list. */
  emptyHint?: string;
  /** Words put in the search box when the form opens (the item panel names the item). */
  initialQuery?: string;
}

/** The heading over the list, in the words of what is being done (the plain "What is it about" read as a riddle on a dispatch). */
const LEGEND: Partial<Record<MovementKind, string>> = {
  issue: "What is being given out", dispatch: "What is going out", transfer: "What is being sent", repair_out: "What is going for repair", check: "What is being checked",
  adjust: "What is affected", consume: "What is being used up", pack_kit: "What goes in the kit", return_rental: "What goes back to the supplier",
  return: "What is coming back", repair_in: "What came back from repair", return_unused: "What is being returned unused", unpack_kit: "What comes out of the kit", receive_transfer: "What arrived",
};
const UNIT_BIN_KINDS: readonly MovementKind[] = ["return", "repair_in", "receive_transfer", "unpack_kit"];
const TAKING_KINDS: readonly MovementKind[] = ["issue", "dispatch", "transfer", "consume", "repair_out", "check", "adjust", "return_rental", "pack_kit"];

/**
 * The list of what a movement is about. Items are added by searching or by scanning a label; quantities of counted stock are ALWAYS typed
 * (scanning a bin label names the item and the bin, never "everything in it"); an individual unit can be on the list once, and a second scan
 * of it says so. Nothing here records anything: the form's Confirm button does, after the review step.
 */
export function LinesEditor(props: Props) {
  const { kind, adjustAction, services, companyId, locationId, bins, drafts, onChange, held, rentalId, canSeeCosts, disabled, lineError, acceptHeld, onHolderFound } = props;
  const cfg = KIND_CONFIG[kind];
  const source = sourceFor(kind, adjustAction);
  const searchId = useId();
  const [q, setQ] = useState(props.initialQuery ?? "");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const counter = useRef(0);
  const seq = useRef(0);
  // Codes being looked up right now (a camera reads the same label many times a second): they count as "on the list" at once.
  const inFlight = useRef<PendingScanLine[]>([]);
  const draftsRef = useRef(drafts);
  useEffect(() => { draftsRef.current = drafts; });
  const nextId = () => `l${++counter.current}`;
  const searchable = source !== "held" && source !== "transit" && source !== "kit";

  // Searching as the person types (the database answers; people who may not see stock get nothing).
  const searching_ = searchable && q.trim().length >= 2 && !!companyId;
  useEffect(() => {
    if (!searching_) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      setSearching(true);
      services.search({ companyId, locationId, kind, q, rentalId, adjustAction })
        .then((r) => { if (mine === seq.current) { setResults(r.candidates); setSearchError(r.error); } })
        .catch(() => { if (mine === seq.current) { setResults([]); setSearchError("The search could not be done. Try again."); } })
        .finally(() => { if (mine === seq.current) setSearching(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q, searching_, companyId, locationId, kind, rentalId, adjustAction, services]);

  const onList = (c: Candidate, list: readonly LineDraft[]): boolean =>
    c.type === "unit" ? list.some((d) => d.unitId === c.unitId)
      : c.type === "counted" ? list.some((d) => !d.unitId && d.itemId === c.itemId && d.binId === (c.binId ?? "") && d.condition === (c.condition) && d.rentalId === c.rentalId)
        : list.some((d) => !d.unitId && d.itemId === c.itemId);

  /** Adds a candidate to the list (or says in words why it cannot be). Returns true when it was added. */
  const add = (c: Candidate): boolean => {
    const list = draftsRef.current;
    if (onList(c, list)) { setMessage(`${c.code ?? c.itemName} is already on the list.`); return false; }
    const problem = c.type === "unit" ? (unitProblemFor(kind, c, adjustAction) ?? acceptHeld?.(c) ?? null) : (acceptHeld?.(c) ?? null);
    if (problem) { setMessage(problem); return false; }
    const d = draftFromCandidate(c, kind, nextId());
    const next = [...list, d];
    draftsRef.current = next;
    onChange(next);
    setMessage(c.type === "unit" ? `Added ${c.code} ${c.itemName}.` : `Added ${c.itemName}${c.binLabel ? ` (bin ${c.binLabel})` : ""}. Type how many.`);
    return true;
  };

  const onScan = async (raw: string) => {
    const parsed = parseInventoryScan(raw);
    if (!parsed.ok) { setMessage(parsed.problem === "empty" ? "Nothing was read." : "That is not an Inventory label. Scan the QR code on a unit or a bin label."); return; }
    const pending: PendingScanLine[] = [
      ...draftsRef.current.filter((d) => d.code).map((d) => ({ code: d.code!, kind: d.unitId ? ("unit" as const) : ("stock" as const) })),
      ...inFlight.current,
    ];
    const { list, added } = addToPendingList(pending, parsed);
    if (!added) { setMessage(`${parsed.code} is already on the list.`); return; }
    const entry = list[list.length - 1]!;
    inFlight.current = [...inFlight.current, entry];
    try {
      const res = await services.read(raw);
      if (!res.ok) { setMessage(res.message); return; }
      if (source === "held" && res.candidate.type === "unit") onHolderFound?.(res.candidate);
      add(res.candidate);
    } catch {
      setMessage("The code could not be looked up right now. Try again.");
    } finally {
      inFlight.current = inFlight.current.filter((p) => p !== entry);
    }
  };

  const patch = (id: string, over: Partial<LineDraft>) => onChange(drafts.map((d) => (d.id === id ? { ...d, ...over } : d)));
  const remove = (id: string) => onChange(drafts.filter((d) => d.id !== id));

  const heldLeft = (held?.candidates ?? []).filter((c) => !onList(c, drafts));
  const heldShown = q.trim() ? heldLeft.filter((c) => [c.itemName, c.code, c.serial, c.binLabel].filter(Boolean).join(" ").toLowerCase().includes(q.trim().toLowerCase())) : heldLeft;

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-medium">{source === "catalogue" ? "What arrived" : held ? held.title : (LEGEND[kind] ?? "What is it about")}</legend>

      {searchable || held ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor={searchId} className="sr-only">{searchable ? "Search for an item or unit to add" : "Narrow the list"}</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id={searchId} value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchable ? (source === "catalogue" ? "Search the catalogue by name or model" : "Search by name, model, serial or ID") : "Narrow the list"} className="pl-9" autoComplete="off" maxLength={80} />
            </div>
          </div>
          {searchable || kind === "return" || kind === "project_transfer" ? (
            <Button type="button" variant="outline" onClick={() => setScanning((s) => !s)} aria-expanded={scanning}>
              <Camera className="h-4 w-4" aria-hidden /> {scanning ? "Close scanner" : "Scan a label"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {scanning ? (
        <div className="rounded-md border border-border p-3">
          <QrScanner onRead={(raw) => { void onScan(raw); }} onClose={() => setScanning(false)} />
          <p className="mt-2 text-sm text-muted-foreground">Scanning adds the item to the list. Nothing is recorded until you review and confirm, and counted stock always needs its quantity typed.</p>
        </div>
      ) : null}

      <div role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-muted-foreground">{message}</div>

      {searching_ ? (
        <div>
          {searching ? <p className="text-sm text-muted-foreground" role="status">Searching…</p> : null}
          {searchError ? <p role="alert" className="text-sm text-destructive">{searchError}</p> : null}
          {!searching && !searchError && results.length === 0 ? <p className="text-sm text-muted-foreground" role="status">Nothing found for “{q.trim()}”{source === "shelf" ? " on the shelf here" : ""}.</p> : null}
          {results.length > 0 ? (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Search results">
              {results.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <CandidateText c={c} />
                  <Button type="button" size="sm" variant="outline" onClick={() => add(c)} aria-label={`Add ${c.itemName}${c.code ? ` ${c.code}` : ""}${c.binLabel ? ` bin ${c.binLabel}` : ""}`}>
                    <Plus className="h-3.5 w-3.5" aria-hidden /> Add
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {held ? (
        <div className="space-y-2">
          {held.loading ? <p className="text-sm text-muted-foreground" role="status">Loading…</p> : null}
          {held.error ? <p role="alert" className="text-sm text-destructive">{held.error}</p> : null}
          {!held.loading && !held.error && held.candidates.length === 0 ? <p className="text-sm text-muted-foreground" role="status">{held.emptyText}</p> : null}
          {heldShown.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{held.title}</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => { const list = draftsRef.current; const next = [...list]; for (const c of heldShown) { if (!onList(c, next) && !((c.type === "unit" ? unitProblemFor(kind, c, adjustAction) : null) ?? acceptHeld?.(c))) next.push(draftFromCandidate(c, kind, nextId())); } draftsRef.current = next; onChange(next); setMessage(null); }}>
                  Add all ({heldShown.length})
                </Button>
              </div>
              <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label={held.title}>
                {heldShown.map((c) => (
                  <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <CandidateText c={c} />
                    <Button type="button" size="sm" variant="outline" onClick={() => add(c)} aria-label={`Add ${c.itemName}${c.code ? ` ${c.code}` : ""}`}><Plus className="h-3.5 w-3.5" aria-hidden /> Add</Button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {drafts.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{props.emptyHint ?? (cfg.linesOptional ? "The list is empty, which means everything that applies. Add items to choose only some." : "Nothing on the list yet. Search for an item or scan a label.")}</p>
      ) : (
        <ol className="space-y-2" aria-label="On the list">
          {drafts.map((d) => (
            <DraftRow key={d.id} d={d} kind={kind} bins={bins} canSeeCosts={!!canSeeCosts} error={lineError?.id === d.id ? lineError.message : null} patch={patch} remove={remove} taking={TAKING_KINDS.includes(kind)} />
          ))}
        </ol>
      )}
    </fieldset>
  );
}

function CandidateText({ c }: { c: Candidate }) {
  return (
    <div className="min-w-0">
      <p className="break-words text-sm font-medium">
        {c.itemName}{c.detail ? <span className="font-normal text-muted-foreground"> · {c.detail}</span> : null}
      </p>
      <p className="break-words text-[13px] text-muted-foreground">
        {c.code ? <span className="font-mono">{c.code}</span> : null}{c.code && (c.serial || c.where) ? " · " : ""}{c.serial ? `serial ${c.serial}` : ""}{c.serial && c.where ? " · " : ""}{c.where}
        {c.type === "counted" && c.qty !== null ? ` · ${formatQty(c.qty, c.uom)} ${c.uom === "each" ? "" : ""}${c.condition !== "good" ? `(${BALANCE_CONDITION_WORDS[c.condition as keyof typeof BALANCE_CONDITION_WORDS] ?? c.condition})` : ""}`.trimEnd() : ""}
      </p>
    </div>
  );
}

function DraftRow({ d, kind, bins, canSeeCosts, error, patch, remove, taking }: {
  d: LineDraft; kind: MovementKind; bins: Props["bins"]; canSeeCosts: boolean; error: string | null; taking: boolean;
  patch: (id: string, over: Partial<LineDraft>) => void; remove: (id: string) => void;
}) {
  const cfg = KIND_CONFIG[kind];
  const uid = useId();
  const isUnit = d.unitId !== null;
  const receivingUnits = kind === "receive" && (d.tracking === "individual" || d.tracking === "kit");
  const wantsCondition = cfg.lineCondition || kind === "check" || (kind === "adjust" && isUnit && d.condition !== "good");
  const showBin = isUnit ? UNIT_BIN_KINDS.includes(kind) : cfg.lineBin;
  const label = `${d.itemName}${d.code ? ` ${d.code}` : ""}`;
  const conditions = isUnit || receivingUnits ? Object.entries(CONDITION_WORDS) : Object.entries(BALANCE_CONDITION_WORDS);
  const releasing = kind === "return" || kind === "repair_in" || kind === "receive_transfer" || kind === "receive";
  const condLabel = (value: string, word: string) => (releasing ? (value === "good" ? `${word}: available now` : value === "fair" ? `${word}: available now` : `${word}: held back`) : word);
  return (
    <li className="space-y-2 rounded-md border border-border p-3" aria-label={label}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{d.itemName}{d.code ? <span className="ml-2 font-mono text-[13px] font-normal text-muted-foreground">{d.code}</span> : null}</p>
          {d.where ? <p className="break-words text-[13px] text-muted-foreground">{d.where}</p> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => remove(d.id)} aria-label={`Remove ${label} from the list`}><Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {!isUnit ? (
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-q`} className="text-sm font-medium leading-none">{receivingUnits ? "How many arrived" : `Quantity${d.uom !== "each" ? ` (${d.uom})` : ""}`}</label>
            <Input id={`${uid}-q`} inputMode={d.scale > 0 && !receivingUnits ? "decimal" : "numeric"} value={d.qty} onChange={(e) => patch(d.id, { qty: e.target.value })} aria-invalid={!!error || undefined} aria-label={`Quantity of ${label}`} autoComplete="off" />
            {d.maxQty !== null ? <p className="text-[13px] text-muted-foreground">{formatQty(d.maxQty, d.uom)} {kind === "return" || kind === "project_transfer" ? "held" : kind === "receive_transfer" ? "on the way" : "on the shelf"}. Type the amount you are handling.</p> : null}
          </div>
        ) : null}
        {showBin && !(isUnit && !UNIT_BIN_KINDS.includes(kind)) ? (
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-b`} className="text-sm font-medium leading-none">{taking ? "Take from bin" : "Put into bin"}</label>
            <Select id={`${uid}-b`} value={d.binId} onChange={(e) => { const b = bins.find((x) => x.id === e.target.value); patch(d.id, { binId: e.target.value, binLabel: b ? b.code : "" }); }}>
              <option value="">{taking ? "Any bin here" : "No bin"}</option>
              {bins.map((b) => <option key={b.id} value={b.id}>{b.label?.trim() ? `${b.code} (${b.label})` : b.code}</option>)}
            </Select>
          </div>
        ) : null}
        {wantsCondition ? (
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-c`} className="text-sm font-medium leading-none">{kind === "check" ? "Condition after the check" : releasing ? "Condition" : "Condition"}</label>
            <Select id={`${uid}-c`} value={d.condition} onChange={(e) => patch(d.id, { condition: e.target.value })}>
              {conditions.map(([value, word]) => <option key={value} value={value}>{condLabel(value, word)}</option>)}
            </Select>
          </div>
        ) : null}
        {receivingUnits && canSeeCosts ? (
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-m`} className="text-sm font-medium leading-none">Cost of each (optional)</label>
            <Input id={`${uid}-m`} inputMode="decimal" value={d.cost} onChange={(e) => patch(d.id, { cost: e.target.value })} />
          </div>
        ) : null}
        {!isUnit && !receivingUnits && kind === "receive" && canSeeCosts ? (
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-m`} className="text-sm font-medium leading-none">Cost of each (optional)</label>
            <Input id={`${uid}-m`} inputMode="decimal" value={d.cost} onChange={(e) => patch(d.id, { cost: e.target.value })} />
          </div>
        ) : null}
      </div>
      {receivingUnits ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-s`} className="text-sm font-medium leading-none">Serial numbers (optional)</label>
          <Textarea id={`${uid}-s`} rows={2} value={d.serials} onChange={(e) => patch(d.id, { serials: e.target.value })} placeholder="One per line, in the same count as above" />
        </div>
      ) : null}
      {isUnit && (kind === "return" || kind === "check" || kind === "repair_in" || kind === "receive_transfer") ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-n`} className="text-sm font-medium leading-none">Note (optional)</label>
          <Input id={`${uid}-n`} value={d.note} onChange={(e) => patch(d.id, { note: e.target.value })} maxLength={300} />
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </li>
  );
}
