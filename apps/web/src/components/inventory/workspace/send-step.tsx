"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine, TriangleAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useUnsavedChanges } from "@/components/workspace/unsaved";
import { formatQty } from "@/lib/inventory/words";
import { parseQty, validateInput, type MovementInput, type RpcLine, type SummaryRow } from "@/lib/inventory/stock-movements";
import type { FormContext } from "@/lib/inventory/stock-candidates";
import { sendFlags, type Flag, type SendItem, type SendSelection } from "@/lib/inventory/workspace";
import { cn } from "@/lib/utils";
import { DonePanel, ReviewPanel } from "../stock/movement-review";
import { MovementDialog } from "../stock/movement-panel";
import { liveServices } from "../stock/movement-services-live";
import { useMovementFlow } from "../stock/use-movement-flow";

export interface SendStepProps {
  requestId: string;
  requestCode: string;
  projectId: string;
  projectName: string;
  companyId: string;
  items: SendItem[];
  /** Codes of units of this request that are already out, so a scan can say so. */
  sentCodes: string[];
  /** The warehouses the person may send from, and the one to start with. */
  locations: { id: string; name: string }[];
  defaultLocationId: string;
  expectedReturnLabel: string;
  /** For the unplanned-dispatch exception (the existing dispatch form). Null when it could not be loaded. */
  formContext: FormContext | null;
}

/**
 * Send out: the project, request, warehouse and expected return are carried forward, the RESERVED equipment is listed, and nothing is ticked for
 * you (reserved is not sent). Scan a code or tick the units that are actually going; counted stock takes a counted quantity; sending only part is
 * normal. What the database would refuse is flagged before the review step, and recording uses the same movement flow as every other
 * movement (one key, single flight, "check whether it went through"). An unplanned dispatch is a separate, clearly labelled exception.
 */
export function SendStep(p: SendStepProps) {
  const router = useRouter();
  const uid = useId();
  const flow = useMovementFlow(liveServices, p.companyId, "dispatch");
  const locked = flow.uncertain && flow.phase !== "done";
  const [locationId, setLocationId] = useState(p.defaultLocationId);
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [scan, setScan] = useState("");
  const [unknown, setUnknown] = useState<string[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [exception, setException] = useState(false);

  const toSend = (i: SendItem) => (i.individual ? i.units.length : i.countedToSend);
  const selection: SendSelection[] = p.items.map((i) => {
    const raw = counted[i.itemId];
    const q = !i.individual && raw !== undefined && raw.trim() !== "" ? parseQty(raw, i.scale) : null;
    return { itemId: i.itemId, units: ticked[i.itemId] ?? [], counted: q && q.ok ? q.value : null };
  });
  const flags: Flag[] = sendFlags(p.items, selection, unknown);
  const blocked = flags.some((f) => f.level === "block");
  const picks = selection.reduce((n, s) => n + (s.units.length || (s.counted ?? 0)), 0);
  const dirty = picks > 0 || unknown.length > 0;
  useUnsavedChanges(uid, dirty && flow.phase !== "done");
  useEffect(() => { if (flow.phase === "done") router.refresh(); }, [flow.phase]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when it is recorded

  const toggle = (itemId: string, unitId: string, on: boolean) =>
    setTicked((t) => ({ ...t, [itemId]: on ? [...new Set([...(t[itemId] ?? []), unitId])] : (t[itemId] ?? []).filter((x) => x !== unitId) }));

  const onScan = () => {
    const code = scan.trim().toUpperCase();
    setInfo(null);
    if (!code) return;
    setScan("");
    for (const i of p.items) {
      const u = i.units.find((x) => (x.code ?? "").toUpperCase() === code);
      if (u) { toggle(i.itemId, u.unitId, true); setUnknown((x) => x.filter((c) => c !== code)); return; }
    }
    if (p.sentCodes.some((c) => c.toUpperCase() === code)) { setInfo(`${code} has already been sent for this request.`); return; }
    setUnknown((x) => (x.includes(code) ? x : [...x, code]));
  };

  const lines = (): { ok: true; lines: RpcLine[] } | { ok: false; error: string } => {
    const out: RpcLine[] = [];
    for (const i of p.items) {
      if (i.individual) { for (const id of ticked[i.itemId] ?? []) out.push({ unit_id: id }); continue; }
      const raw = counted[i.itemId];
      if (raw === undefined || raw.trim() === "") continue;
      const q = parseQty(raw, i.scale);
      if (!q.ok) return { ok: false, error: `${i.name}: ${q.error}` };
      out.push({ item_id: i.itemId, qty: q.value });
    }
    return out.length ? { ok: true, lines: out } : { ok: false, error: "Tick what is being sent, or count the quantity, first." };
  };
  const build = (key: string): { input: MovementInput } | { error: string } => {
    const l = lines();
    if (!l.ok) return { error: l.error };
    const input: MovementInput = { kind: "dispatch", companyId: p.companyId, locationId: locationId || null, key, lines: l.lines, projectId: p.projectId, requestId: p.requestId };
    const bad = validateInput(input);
    return bad ? { error: bad } : { input };
  };

  const onReview = () => {
    if (blocked) { setProblem("Take off what the system would refuse before you review."); return; }
    const res = build(flow.key);
    if ("error" in res) { setProblem(res.error); return; }
    setProblem(null);
    flow.toReview();
  };
  const onConfirm = () => {
    const res = build(flow.key);
    if ("error" in res) { setProblem(res.error); flow.toEdit(); return; }
    void flow.confirm(() => res.input);
  };

  const rows: SummaryRow[] = (() => {
    const what = p.items.flatMap((i) => {
      const s = selection.find((x) => x.itemId === i.itemId);
      if (!s) return [];
      if (i.individual && s.units.length) return [`${s.units.length} × ${i.name} (${i.units.filter((u) => s.units.includes(u.unitId)).map((u) => u.code ?? "unit").join(", ")})`];
      if (!i.individual && s.counted) return [`${formatQty(s.counted, i.uom)} × ${i.name}`];
      return [];
    });
    const left = p.items.reduce((n, i) => { const s = selection.find((x) => x.itemId === i.itemId); return n + Math.max(0, toSend(i) - (i.individual ? (s?.units.length ?? 0) : (s?.counted ?? 0))); }, 0);
    return [
      { label: "What", value: what.join("\n") },
      { label: "From", value: p.locations.find((l) => l.id === locationId)?.name ?? "—" },
      { label: "To", value: `Project ${p.projectName}` },
      { label: "Request", value: p.requestCode },
      { label: "Expected return", value: `${p.expectedReturnLabel} (from the request)` },
      { label: "Still reserved, not sent", value: left > 0 ? `${left} ${left === 1 ? "item stays" : "items stay"} reserved and unsent after this` : "Nothing: everything reserved is going" },
    ];
  })();

  if (flow.phase === "done") {
    return <DonePanel flow={flow} onAnother={() => { setTicked({}); setCounted({}); setUnknown([]); setInfo(null); flow.startNew(); }} />;
  }
  if (flow.phase === "reviewing" || flow.phase === "sending") {
    return (
      <div className="space-y-3">
        {flags.length > 0 ? <FlagList flags={flags} /> : null}
        <ReviewPanel flow={flow} rows={rows} confirmLabel={`Confirm: send ${picks}`} onConfirm={onConfirm} />
      </div>
    );
  }

  const anything = p.items.some((i) => toSend(i) > 0);
  return (
    <div className="space-y-4" data-step="send">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm">
        <span>Sending from</span>
        {p.locations.length > 1 ? (
          <>
            <label htmlFor={`${uid}-from`} className="sr-only">Send from</label>
            <Select id={`${uid}-from`} value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={locked} className="h-9 w-auto font-semibold">
              {p.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </>
        ) : <strong>{p.locations[0]?.name ?? "—"}</strong>}
        <span>to <strong>{p.projectName}</strong> · request {p.requestCode} · expected back <strong>{p.expectedReturnLabel}</strong></span>
      </div>

      {!anything ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{p.items.length === 0 ? "Nothing is reserved for this request yet. Reserve equipment under Prepare first." : "Everything reserved for this request has been sent."}</p>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); onScan(); }} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor={`${uid}-scan`} className="mb-1 block text-sm font-medium">Scan or type a code to tick it</label>
              <Input id={`${uid}-scan`} value={scan} onChange={(e) => setScan(e.target.value)} disabled={locked} placeholder="Equipment ID, for example UAE-E-00042" autoComplete="off" className="h-11 text-base sm:h-9 sm:text-sm" />
            </div>
            <Button type="submit" variant="outline" disabled={locked || !scan.trim()} className="h-11 sm:h-9"><ScanLine className="h-4 w-4" aria-hidden />Add</Button>
          </form>
          <p className="-mt-2 text-xs text-muted-foreground">Nothing is ticked for you: reserved does not mean sent. Scanning only ticks a unit; nothing is recorded until you confirm.</p>
          {info ? <p role="status" className="text-sm text-muted-foreground">{info}</p> : null}

          <div className="space-y-3">
            {p.items.map((i) => {
              const left = toSend(i);
              const picked = ticked[i.itemId] ?? [];
              return (
                <section key={i.itemId} className="rounded-lg border border-border bg-card" aria-label={i.name}>
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
                    <h3 className="text-sm font-semibold">{i.name}{i.model ? <span className="font-normal text-muted-foreground"> · {i.model}</span> : null}</h3>
                    <p className="text-xs text-muted-foreground">Reserved {formatQty(i.reserved, i.uom)} · Sent {formatQty(i.sent, i.uom)} · <span className={cn(left > 0 && "font-medium text-foreground")}>To send {formatQty(left, i.uom)}</span></p>
                  </header>
                  {left <= 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">Everything reserved has been sent.</p> : i.individual ? (
                    <div>
                      <ul className="divide-y divide-border/70">
                        {i.units.map((u) => (
                          <li key={u.unitId}>
                            <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm">
                              <input type="checkbox" checked={picked.includes(u.unitId)} onChange={(e) => toggle(i.itemId, u.unitId, e.target.checked)} disabled={locked} className="h-5 w-5 accent-[hsl(var(--accent))]" />
                              <span className="font-medium">{u.code ?? "Unit"}</span>
                              {u.serial ? <span className="text-muted-foreground">serial {u.serial}</span> : null}
                              <span className="text-muted-foreground">reserved for this request</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      <div className="border-t border-border/70 px-4 py-2">
                        <button type="button" disabled={locked} onClick={() => setTicked((t) => ({ ...t, [i.itemId]: i.units.map((u) => u.unitId) }))} className="text-sm font-medium text-[hsl(var(--os-link))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tick all {i.units.length} of these</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <label htmlFor={`${uid}-q-${i.itemId}`} className="text-sm">Counted quantity</label>
                      <Input id={`${uid}-q-${i.itemId}`} inputMode={i.scale > 0 ? "decimal" : "numeric"} placeholder={`up to ${formatQty(left, i.uom)}`} value={counted[i.itemId] ?? ""} onChange={(e) => setCounted({ ...counted, [i.itemId]: e.target.value })} disabled={locked} className="h-10 w-36 sm:h-9" />
                      <span className="text-xs text-muted-foreground">Count what goes in the box. It is never filled in for you.</span>
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <FlagList flags={flags} />
          {problem ? <Alert variant="destructive" role="alert">{problem}</Alert> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={picks === 0 || locked} onClick={onReview} className="h-11 w-full sm:h-9 sm:w-auto">Review{picks > 0 ? ` ${picks} to send` : ""}</Button>
            {picks === 0 ? <span className="text-xs text-muted-foreground">Tick or count what is actually going to continue.</span> : null}
          </div>
        </>
      )}

      <section className="rounded-lg border border-dashed border-border px-4 py-3 text-sm" aria-label="Unplanned dispatch">
        <h3 className="font-medium">Sending something that is not on this request?</h3>
        <p className="mt-1 text-muted-foreground">An unplanned dispatch is an exception. It does <strong>not</strong> fulfil this request: it is recorded without a request and shows as “not part of a request”. Equipment that any request has reserved cannot be sent this way.</p>
        {p.formContext ? (
          <>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setException(true)}>Record an unplanned dispatch</Button>
            <MovementDialog
              open={exception} onClose={() => setException(false)} kind="dispatch" context={p.formContext} initial={{ projectId: p.projectId, locationId }}
              title="Unplanned dispatch (exception)" description={`To ${p.projectName}. This does not fulfil request ${p.requestCode} or any other request.`}
            />
          </>
        ) : <p className="mt-2 text-xs text-muted-foreground">The dispatch form could not be loaded. Reload the page to try again.</p>}
      </section>
    </div>
  );
}

function FlagList({ flags }: { flags: Flag[] }) {
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
