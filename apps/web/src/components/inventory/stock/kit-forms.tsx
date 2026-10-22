"use client";

import { useId, useState } from "react";
import { Camera } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { QrScanner } from "@/components/inventory/qr-scanner";
import { useUnsavedChanges } from "@/components/workspace/unsaved";
import type { Candidate } from "@/lib/inventory/stock-candidates";
import { parseQty, successMessage, validateInput, type MovementInput, type RpcLine, type SummaryRow } from "@/lib/inventory/stock-movements";
import { formatQty } from "@/lib/inventory/words";
import type { InvTracking } from "@/types/inventory";
import type { MovementServices } from "./movement-services";
import { DonePanel, ReviewPanel } from "./movement-review";
import { useMovementFlow } from "./use-movement-flow";

export interface KitRow {
  itemId: string;
  itemName: string;
  tracking: InvTracking;
  uom: string;
  scale: number;
  expectedQty: number;
  required: boolean;
  status: "present" | "missing" | "substituted";
  /** What is packed against this line now. */
  packedText: string | null;
  /** Units of this item that could be packed now. */
  options: { unitId: string; code: string; serial: string | null }[];
}

type Choice = "leave" | "present" | "missing" | "substituted";
interface RowState { choice: Choice; unitId: string; qty: string; binId: string; note: string; sub: Candidate | null; subQty: string }

const blank = (): RowState => ({ choice: "leave", unitId: "", qty: "", binId: "", note: "", sub: null, subQty: "" });

/**
 * Pack a kit against its checklist. For every line say whether it is in the box now, missing, or replaced by something else: missing and
 * substituted lines are recorded, never hidden. Quantities are typed. The same review step, key and result check as every other movement.
 */
export function KitPackForm({ services, kit, rows, bins, onClose }: {
  services: MovementServices;
  kit: { unitId: string; code: string; companyId: string; locationId: string; locationName: string; itemName: string };
  rows: KitRow[]; bins: { id: string; code: string; label: string | null }[]; onClose?: () => void;
}) {
  const uid = useId();
  const [state, setState] = useState<Record<string, RowState>>({});
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const flow = useMovementFlow(services, kit.companyId, "pack");
  const locked = flow.uncertain && flow.phase !== "done";
  const get = (id: string): RowState => state[id] ?? blank();
  const patch = (id: string, over: Partial<RowState>) => setState((s) => ({ ...s, [id]: { ...(s[id] ?? blank()), ...over } }));
  const dirty = Object.values(state).some((r) => r.choice !== "leave") || note.trim() !== "";
  useUnsavedChanges(uid, dirty && flow.phase !== "done");

  const build = (key: string): { input: MovementInput; rows: SummaryRow[] } | { error: string } => {
    const lines: RpcLine[] = [];
    const what: string[] = [];
    let present = 0, missing = 0, substituted = 0;
    const seen = new Set<string>();
    for (const r of rows) {
      const s = get(r.itemId);
      if (s.choice === "leave") continue;
      const label = r.itemName;
      if (s.choice === "missing") {
        lines.push({ item_id: r.itemId, status: "missing", ...(s.note.trim() ? { note: s.note.trim() } : {}) });
        what.push(`${label}: missing`);
        missing += 1;
        continue;
      }
      const line: RpcLine = { item_id: r.itemId, status: s.choice };
      if (s.note.trim()) line.note = s.note.trim();
      if (s.choice === "substituted") {
        if (!s.sub) return { error: `${label}: search for the item that stands in for it` };
        line.substitute_item_id = s.sub.itemId;
      }
      const actual = s.choice === "substituted" ? s.sub! : null;
      const individual = actual ? actual.type === "unit" : r.tracking === "individual";
      if (individual) {
        const unitId = actual ? (actual.unitId ?? "") : s.unitId;
        if (!unitId) return { error: `${label}: choose which unit is in the kit` };
        if (seen.has(unitId)) return { error: `${label}: that unit is already used for another line` };
        seen.add(unitId);
        line.unit_id = unitId;
        const code = actual ? actual.code : r.options.find((o) => o.unitId === unitId)?.code;
        what.push(s.choice === "substituted" ? `${label}: substituted by ${actual!.itemName} ${code ?? ""}`.trim() : `${label}: ${code ?? "packed"}`);
      } else {
        const typed = actual ? s.subQty : s.qty;
        const q = parseQty(typed, actual ? actual.scale : r.scale);
        if (!q.ok) return { error: `${label}: ${q.error}` };
        line.qty = q.value;
        if (s.binId) line.bin_id = s.binId;
        what.push(s.choice === "substituted" ? `${label}: substituted by ${formatQty(q.value, actual!.uom)} ${actual!.itemName}` : `${label}: ${formatQty(q.value, r.uom)} packed`);
      }
      if (s.choice === "present") present += 1; else substituted += 1;
      lines.push(line);
    }
    if (lines.length === 0) return { error: "Choose what to do with at least one line of the checklist" };
    const input: MovementInput = { kind: "pack_kit", companyId: kit.companyId, locationId: kit.locationId, key, lines, kitUnitId: kit.unitId, note: note.trim() || undefined };
    const bad = validateInput(input);
    if (bad) return { error: bad };
    const summary: SummaryRow[] = [
      { label: "What", value: what.join("\n") },
      { label: "How much", value: [present ? `${present} packed` : "", substituted ? `${substituted} substituted` : "", missing ? `${missing} recorded as missing` : ""].filter(Boolean).join(", ") },
      { label: "From", value: `${kit.locationName} (the shelf)` },
      { label: "To", value: `Inside kit ${kit.code} (${kit.itemName})` },
      ...(note.trim() ? [{ label: "Note", value: note.trim() }] : []),
    ];
    return { input, rows: summary };
  };

  const onScan = async (raw: string) => {
    const res = await services.read(raw).catch(() => null);
    if (!res) { setMessage("The code could not be looked up right now. Try again."); return; }
    if (!res.ok) { setMessage(res.message); return; }
    const c = res.candidate;
    const row = rows.find((r) => r.itemId === c.itemId && r.status !== "present");
    if (c.type !== "unit" || !row) { setMessage(`${c.code ?? c.itemName} is not an open line of this kit's checklist. If it stands in for something else, choose “Substituted” on that line.`); return; }
    if (Object.values(state).some((s) => s.unitId === c.unitId)) { setMessage(`${c.code} is already on the list.`); return; }
    if (!row.options.some((o) => o.unitId === c.unitId)) { setMessage(`${c.code} cannot be packed now: ${c.where || "it is not on the shelf here"}.`); return; }
    patch(row.itemId, { choice: "present", unitId: c.unitId ?? "" });
    setMessage(`${c.code} ticked for ${row.itemName}.`);
  };

  if (flow.phase === "done") return <DonePanel flow={{ ...flow, outcome: flow.outcome ? { ...flow.outcome, message: flow.outcome.message ?? successMessage("pack_kit", flow.outcome.result) } : flow.outcome }} onAnother={() => { setState({}); setNote(""); flow.startNew(); }} onClose={onClose} />;
  if (flow.phase === "reviewing" || flow.phase === "sending") {
    const built = build(flow.key);
    return <ReviewPanel flow={flow} rows={"error" in built ? [{ label: "Problem", value: built.error }] : built.rows} confirmLabel="Confirm packing" onConfirm={() => { if ("error" in built) { setProblem(built.error); flow.toEdit(); return; } void flow.confirm(() => built.input); }} />;
  }

  return (
    <form className="space-y-4" aria-label={`Pack kit ${kit.code}`} noValidate onSubmit={(e) => { e.preventDefault(); const built = build(flow.key); if ("error" in built) { setProblem(built.error); return; } setProblem(null); flow.toReview(); }}>
      <p className="text-sm text-muted-foreground">Kit <strong>{kit.code}</strong> at {kit.locationName}. For each line of the checklist say what is in the box now. Lines you leave alone are not changed.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => setScanning((v) => !v)} aria-expanded={scanning} disabled={locked}><Camera className="h-4 w-4" aria-hidden /> {scanning ? "Close scanner" : "Scan a unit to tick it off"}</Button>
      </div>
      {scanning ? <div className="rounded-md border border-border p-3"><QrScanner onRead={(raw) => { void onScan(raw); }} onClose={() => setScanning(false)} /></div> : null}
      <div role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-muted-foreground">{message}</div>
      <ul className="space-y-2" aria-label="Kit checklist">
        {rows.map((r) => {
          const s = get(r.itemId);
          return (
            <li key={r.itemId} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{r.itemName} <span className="font-normal text-muted-foreground">× {formatQty(r.expectedQty, r.uom)}{r.required ? "" : " (optional)"}</span></p>
                <p className="text-[13px] text-muted-foreground">{r.status === "present" ? `In the kit${r.packedText ? `: ${r.packedText}` : ""}` : r.status === "substituted" ? `Substituted${r.packedText ? `: ${r.packedText}` : ""}` : "Not in the kit"}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor={`${uid}-${r.itemId}-c`} className="text-sm font-medium leading-none">This line</label>
                  <Select id={`${uid}-${r.itemId}-c`} value={s.choice} disabled={locked} onChange={(e) => patch(r.itemId, { choice: e.target.value as Choice })}>
                    <option value="leave">Leave as it is</option>
                    <option value="present">It is in the box now</option>
                    <option value="missing">It is missing</option>
                    <option value="substituted">Something else stands in for it</option>
                  </Select>
                </div>
                {s.choice === "present" && r.tracking === "individual" ? (
                  <div className="space-y-1.5">
                    <label htmlFor={`${uid}-${r.itemId}-u`} className="text-sm font-medium leading-none">Which unit</label>
                    <Select id={`${uid}-${r.itemId}-u`} value={s.unitId} disabled={locked} onChange={(e) => patch(r.itemId, { unitId: e.target.value })}>
                      <option value="">{r.options.length === 0 ? "None on the shelf here" : "Choose a unit…"}</option>
                      {r.options.map((o) => <option key={o.unitId} value={o.unitId}>{o.code}{o.serial ? ` · serial ${o.serial}` : ""}</option>)}
                    </Select>
                  </div>
                ) : null}
                {s.choice === "present" && r.tracking !== "individual" ? (
                  <>
                    <div className="space-y-1.5">
                      <label htmlFor={`${uid}-${r.itemId}-q`} className="text-sm font-medium leading-none">How many{r.uom !== "each" ? ` (${r.uom})` : ""}</label>
                      <Input id={`${uid}-${r.itemId}-q`} inputMode="decimal" value={s.qty} disabled={locked} onChange={(e) => patch(r.itemId, { qty: e.target.value })} aria-label={`Quantity of ${r.itemName} packed`} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`${uid}-${r.itemId}-b`} className="text-sm font-medium leading-none">Take from bin</label>
                      <Select id={`${uid}-${r.itemId}-b`} value={s.binId} disabled={locked} onChange={(e) => patch(r.itemId, { binId: e.target.value })}>
                        <option value="">Any bin here</option>
                        {bins.map((b) => <option key={b.id} value={b.id}>{b.label?.trim() ? `${b.code} (${b.label})` : b.code}</option>)}
                      </Select>
                    </div>
                  </>
                ) : null}
              </div>
              {s.choice === "substituted" ? (
                <Substitute services={services} kit={kit} value={s.sub} qty={s.subQty} disabled={locked} onPick={(c) => patch(r.itemId, { sub: c, subQty: "" })} onQty={(q) => patch(r.itemId, { subQty: q })} />
              ) : null}
              {s.choice !== "leave" ? (
                <div className="space-y-1.5">
                  <label htmlFor={`${uid}-${r.itemId}-n`} className="text-sm font-medium leading-none">Note (optional)</label>
                  <Input id={`${uid}-${r.itemId}-n`} value={s.note} maxLength={300} disabled={locked} onChange={(e) => patch(r.itemId, { note: e.target.value })} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-note`} className="text-sm font-medium leading-none">Note (optional)</label>
        <Input id={`${uid}-note`} value={note} maxLength={2000} disabled={locked} onChange={(e) => setNote(e.target.value)} />
      </div>
      {problem ? <Alert variant="destructive" role="alert">{problem}</Alert> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onClose ? <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button> : null}
        <Button type="submit">Review</Button>
      </div>
    </form>
  );
}

function Substitute({ services, kit, value, qty, disabled, onPick, onQty }: {
  services: Pick<MovementServices, "search">; kit: { companyId: string; locationId: string }; value: Candidate | null; qty: string; disabled: boolean; onPick: (c: Candidate | null) => void; onQty: (q: string) => void;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async (text: string) => {
    setQ(text);
    if (text.trim().length < 2) { setResults([]); return; }
    setBusy(true);
    const r = await services.search({ companyId: kit.companyId, locationId: kit.locationId, kind: "pack_kit", q: text }).catch(() => ({ error: "x", candidates: [] as Candidate[] }));
    setResults(r.candidates.filter((c) => c.type === "unit" || c.type === "counted"));
    setBusy(false);
  };
  if (value) {
    return (
      <div className="space-y-2 rounded-md bg-secondary/40 p-2 text-sm">
        <div className="flex items-center justify-between gap-2"><span>Stands in: <strong>{value.itemName}</strong>{value.code ? ` (${value.code})` : ""}</span><Button type="button" size="sm" variant="ghost" onClick={() => onPick(null)} disabled={disabled}>Change</Button></div>
        {value.type === "counted" ? (
          <div className="space-y-1.5"><label htmlFor={`${id}-q`} className="text-sm font-medium leading-none">How many</label><Input id={`${id}-q`} inputMode="decimal" value={qty} onChange={(e) => onQty(e.target.value)} disabled={disabled} aria-label={`Quantity of ${value.itemName} standing in`} /></div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${id}-s`} className="text-sm font-medium leading-none">What stands in for it?</label>
      <Input id={`${id}-s`} value={q} onChange={(e) => void run(e.target.value)} placeholder="Search the shelf by name, model or ID" disabled={disabled} />
      {busy ? <p className="text-sm text-muted-foreground" role="status">Searching…</p> : null}
      {results.length > 0 ? (
        <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Substitutes">
          {results.map((c) => <li key={c.key}><button type="button" className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-secondary/70" onClick={() => { onPick(c); setResults([]); }}><span className="font-medium">{c.itemName}</span><span className="text-[13px] text-muted-foreground">{c.code ?? ""} {c.where}</span></button></li>)}
        </ul>
      ) : null}
    </div>
  );
}
