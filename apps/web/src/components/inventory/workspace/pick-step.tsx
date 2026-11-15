"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, ScanLine, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useUnsavedChanges } from "@/components/workspace/unsaved";
import { checkTransaction, recordPick } from "@/lib/actions/inventoryStock";
import { parseQty, type MovementInput } from "@/lib/inventory/stock-movements";
import { formatQty } from "@/lib/inventory/words";
import { pickFlags, scanForRequest, type Flag, type PickInput, type PickLine, type SendItem, type SendSelection } from "@/lib/inventory/workspace";
import { cn } from "@/lib/utils";
import { QrScanner } from "../qr-scanner";
import { useMovementFlow } from "../stock/use-movement-flow";
import { FlagList, QtyStrip, UncertainSave } from "./job-parts";

export interface PickStepProps {
  requestId: string;
  requestCode: string;
  projectName: string;
  companyId: string;
  /** Every open item of the request (also the ones with nothing reserved yet, so a short line is seen here). */
  items: SendItem[];
  sentCodes: string[];
  locations: { id: string; name: string }[];
  defaultLocationId: string;
  /** Where each reserved unit sits ("A-03"), by unit id; and the bins that hold counted stock of an item at the working warehouse, by item id. Absent = not recorded. */
  unitBins: Record<string, string>;
  itemBins: Record<string, string[]>;
  leavesLabel: string;
  sendHref: string;
  prepareHref: string;
  /** Set when nothing can be picked for the request (not submitted, fulfilled, closed), or when the pick step is not installed on this database. */
  blockedMessage?: string;
}

// The pick is saved through the same honest-saving flow as a movement (one key, single flight, "check whether it went through"); only the call differs.
const services = { submit: (input: MovementInput) => recordPick(input as unknown as PickInput), check: checkTransaction };

/**
 * Pick: the reserved equipment of ONE request, with where it sits, and one action. Ticking a unit (or scanning its label) and saving records that it was taken off the
 * shelf for this job. Nothing leaves the warehouse and no stock figure changes: sending is the next step. What is already picked stays ticked, so unticking it and
 * saving puts it back. A wrong or repeated scan is said beside the scan box and never added.
 */
export function PickStep(p: PickStepProps) {
  const [round, setRound] = useState(0);
  if (p.blockedMessage) return <Alert role="status">{p.blockedMessage}</Alert>;
  return <PickForm key={round} {...p} onAgain={() => setRound((n) => n + 1)} />;
}

function PickForm(p: PickStepProps & { onAgain: () => void }) {
  const router = useRouter();
  const uid = useId();
  const flow = useMovementFlow(services, p.companyId, "pick");
  const locked = flow.uncertain || flow.phase === "sending";
  const initialTicks = useMemo(() => Object.fromEntries(p.items.map((i) => [i.itemId, i.units.filter((u) => u.picked).map((u) => u.unitId)])), []); // eslint-disable-line react-hooks/exhaustive-deps -- the list this form opened with
  const initialCounted = useMemo(() => Object.fromEntries(p.items.filter((i) => !i.individual && i.pickedWaiting > 0).map((i) => [i.itemId, String(i.pickedWaiting)])), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [locationId, setLocationId] = useState(p.defaultLocationId);
  const [ticked, setTicked] = useState<Record<string, string[]>>(initialTicks);
  const [counted, setCounted] = useState<Record<string, string>>(initialCounted);
  const [scan, setScan] = useState("");
  const [camera, setCamera] = useState(false);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [said, setSaid] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const pickable = p.items.filter((i) => i.reserved - i.sent > 0);
  const toggle = (itemId: string, unitId: string, on: boolean) =>
    setTicked((t) => ({ ...t, [itemId]: on ? [...new Set([...(t[itemId] ?? []), unitId])] : (t[itemId] ?? []).filter((x) => x !== unitId) }));

  const read = (raw: string) => {
    const all = new Set(Object.values(ticked).flat());
    const r = scanForRequest(p.items, all, p.sentCodes, raw, "picked");
    if (r.kind === "ticked") { toggle(r.itemId, r.unitId, true); setUnknown((x) => x.filter((c) => c !== r.code)); setSaid({ tone: "ok", text: `${r.code} ticked.` }); return; }
    if (r.kind === "wrong") { setUnknown((x) => (x.includes(r.code) ? x : [...x, r.code])); setSaid({ tone: "bad", text: `Wrong item: ${r.text}` }); return; }
    setSaid({ tone: r.kind === "empty" ? "bad" : "warn", text: r.kind === "duplicate" ? `Already scanned: ${r.text}` : r.text });
  };
  const onScan = () => { const raw = scan; setScan(""); read(raw); };

  const selection: SendSelection[] = pickable.map((i) => {
    const raw = counted[i.itemId];
    const q = !i.individual && raw !== undefined && raw.trim() !== "" ? parseQty(raw, i.scale) : null;
    return { itemId: i.itemId, units: ticked[i.itemId] ?? [], counted: q && q.ok ? q.value : null };
  });
  const flags: Flag[] = pickFlags(pickable, selection, unknown);
  const blocked = flags.some((f) => f.level === "block");

  /** Only what changed is sent: a unit whose tick differs from what is recorded, a counted quantity that differs from what is recorded as picked. */
  const changes = (): { ok: true; lines: PickLine[] } | { ok: false; error: string } => {
    const out: PickLine[] = [];
    for (const i of pickable) {
      if (i.individual) {
        const now = new Set(ticked[i.itemId] ?? []);
        for (const u of i.units) if (now.has(u.unitId) !== !!u.picked) out.push({ unit_id: u.unitId, picked: now.has(u.unitId) });
        continue;
      }
      const raw = (counted[i.itemId] ?? "").trim();
      const q = raw === "" ? { ok: true as const, value: 0 } : raw === "0" ? { ok: true as const, value: 0 } : parseQty(raw, i.scale);
      if (!q.ok) return { ok: false, error: `${i.name}: ${q.error}` };
      if (q.value !== i.pickedWaiting) out.push({ item_id: i.itemId, qty: q.value });
    }
    return out.length > 0 ? { ok: true, lines: out } : { ok: false, error: "Nothing has changed. Tick what you picked, or count the quantity, first." };
  };
  const pending = changes();
  const dirty = pending.ok || unknown.length > 0;
  useUnsavedChanges(uid, dirty && flow.phase !== "done");
  useEffect(() => { if (flow.phase === "done") router.refresh(); }, [flow.phase]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when it is recorded

  const nowPicked = selection.reduce((n, s) => n + (s.units.length || (s.counted ?? 0)), 0);
  const stillOnShelf = pickable.reduce((n, i) => { const s = selection.find((x) => x.itemId === i.itemId); return n + Math.max(0, (i.individual ? i.units.length : i.countedToSend) - (i.individual ? (s?.units.length ?? 0) : (s?.counted ?? 0))); }, 0);

  const save = () => {
    if (blocked) { setProblem("Take off what cannot be picked for this request first (see below)."); return; }
    if (!locationId) { setProblem("Choose the warehouse you are picking in."); return; }
    const c = changes();
    if (!c.ok) { setProblem(c.error); return; }
    setProblem(null);
    void flow.confirm((key) => ({ companyId: p.companyId, locationId, requestId: p.requestId, key, lines: c.lines }) as unknown as MovementInput);
  };

  if (flow.phase === "done") {
    return (
      <div className="space-y-4" data-step="pick-done">
        <Alert variant="success" role="status">
          <h3 className="font-semibold">Picked</h3>
          <p className="mt-1">{flow.outcome?.message ?? "Recorded."}</p>
          <p className="mt-1 text-sm">Nothing has left the warehouse yet: the equipment is still reserved for {p.projectName} until it is sent.</p>
        </Alert>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={p.onAgain}>Pick more</Button>
          <Link href={p.sendHref} className={cn(buttonVariants(), "h-11 sm:h-9")}>Send equipment</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-2" data-step="pick">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm">
        <span>Picking at</span>
        {p.locations.length > 1 ? (
          <><label htmlFor={`${uid}-at`} className="sr-only">Pick at</label><Select id={`${uid}-at`} value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={locked} className="h-11 w-auto font-semibold sm:h-9">{p.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></>
        ) : <strong>{p.locations[0]?.name ?? "—"}</strong>}
        <span>for <strong>{p.projectName}</strong> · request {p.requestCode} · leaves warehouse <strong>{p.leavesLabel}</strong></span>
      </div>

      {pickable.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {p.items.some((i) => i.reserved > 0) ? "Everything reserved for this request has been sent." : "Nothing is reserved for this request yet, so there is nothing to pick."}{" "}
          {p.items.some((i) => i.asked - i.reserved > 0) ? <Link href={p.prepareHref} className="font-medium underline underline-offset-2">Reserve equipment under Prepare</Link> : null}
        </p>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); onScan(); }} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-1"><label htmlFor={`${uid}-scan`} className="text-sm font-medium">Scan or type a code to tick it</label><InfoHint label="scan or type a code">Scan the label on a unit with a hand scanner, or type its equipment ID and press Add. Use the camera button on a phone. Scanning only ticks the unit on this list: nothing is saved until you press Pick items.</InfoHint></div>
              <Input id={`${uid}-scan`} value={scan} onChange={(e) => setScan(e.target.value)} disabled={locked} placeholder="Equipment ID, for example UAE-E-00042" autoComplete="off" className="h-11 text-base sm:h-9 sm:text-sm" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="outline" disabled={locked || !scan.trim()} className="h-11 flex-1 sm:h-9 sm:flex-none"><ScanLine className="h-4 w-4" aria-hidden />Add</Button>
              <Button type="button" variant="outline" disabled={locked} onClick={() => setCamera((c) => !c)} aria-pressed={camera} className="h-11 flex-1 sm:h-9 sm:flex-none"><Camera className="h-4 w-4" aria-hidden />{camera ? "Close camera" : "Use camera"}</Button>
            </div>
          </form>
          {camera ? <div className="rounded-md border border-border p-3"><QrScanner onRead={read} onClose={() => setCamera(false)} /></div> : null}
          {said ? <p role={said.tone === "bad" ? "alert" : "status"} data-scan={said.tone} className={cn("rounded-md border px-3 py-2 text-sm", said.tone === "bad" ? "border-destructive/40 bg-destructive/10 text-destructive" : said.tone === "warn" ? "border-warning/40 bg-warning/10" : "border-border text-muted-foreground")}>{said.text}</p> : null}
          {unknown.length > 0 ? (
            <ul aria-label="Scanned, not on this request" className="flex flex-wrap gap-2">
              {unknown.map((c) => (
                <li key={c} className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 py-1 pl-3 pr-1 text-sm text-destructive">
                  {c}<button type="button" aria-label={`Take ${c} off the list`} onClick={() => setUnknown((x) => x.filter((y) => y !== c))} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      <div className="space-y-3">
        {p.items.map((i) => {
          const left = i.individual ? i.units.length : i.countedToSend;
          const picked = ticked[i.itemId] ?? [];
          const short = Math.max(0, i.asked - i.reserved);
          const bins = p.itemBins[i.itemId] ?? [];
          return (
            <section key={i.itemId} className="rounded-lg border border-border bg-card" aria-label={i.name} data-item={i.name}>
              <header className="space-y-2 border-b border-border/70 px-4 py-3">
                <h3 className="text-sm font-semibold">{i.name}{i.model ? <span className="font-normal text-muted-foreground"> · {i.model}</span> : null}</h3>
                <QtyStrip asked={i.asked} reserved={i.reserved} picked={i.pickedWaiting + i.sent} sent={i.sent} uom={i.uom} />
                {short > 0 ? <p className="text-sm font-medium text-[hsl(var(--os-amber))]" data-short={short}>Short: {formatQty(short, i.uom)} of {formatQty(i.asked, i.uom)} not reserved. <Link href={p.prepareHref} className="underline underline-offset-2">Reserve it, or mark it to buy or rent, under Prepare</Link></p> : null}
              </header>
              {i.reserved === 0 ? null : left <= 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">Everything reserved has been sent.</p> : i.individual ? (
                <div>
                  <ul className="divide-y divide-border/70">
                    {i.units.map((u) => (
                      <li key={u.unitId}>
                        <label className="flex min-h-[3rem] cursor-pointer items-center gap-3 px-4 py-2.5 text-sm">
                          <input type="checkbox" checked={picked.includes(u.unitId)} onChange={(e) => toggle(i.itemId, u.unitId, e.target.checked)} disabled={locked} className="h-6 w-6 flex-none accent-[hsl(var(--accent))]" />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{u.code ?? "Unit"}{u.serial ? <span className="font-normal text-muted-foreground"> · serial {u.serial}</span> : null}</span>
                            <span className="block text-muted-foreground">{p.unitBins[u.unitId] ? `Bin ${p.unitBins[u.unitId]}` : "No bin recorded"}</span>
                          </span>
                          {u.picked ? <Badge variant="outline">Picked</Badge> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                  {i.units.length > 1 ? (
                    <div className="border-t border-border/70 px-4 py-2">
                      <button type="button" disabled={locked} onClick={() => setTicked((t) => ({ ...t, [i.itemId]: i.units.map((u) => u.unitId) }))} className="min-h-[2.5rem] text-sm font-medium text-[hsl(var(--os-link))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tick all {i.units.length} of these</button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2 px-4 py-3">
                  <p className="text-sm text-muted-foreground">{bins.length > 0 ? `Bin ${bins.join(", ")}` : "No bin recorded"}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <label htmlFor={`${uid}-q-${i.itemId}`} className="text-sm font-medium">Picked</label>
                    <Input id={`${uid}-q-${i.itemId}`} inputMode={i.scale > 0 ? "decimal" : "numeric"} placeholder={`up to ${formatQty(left, i.uom)}`} value={counted[i.itemId] ?? ""} onChange={(e) => setCounted({ ...counted, [i.itemId]: e.target.value })} disabled={locked} className="h-11 w-32 text-base sm:h-9 sm:text-sm" />
                    <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => setCounted({ ...counted, [i.itemId]: String(left) })} className="h-11 sm:h-9">All {formatQty(left, i.uom)}</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Count what you took off the shelf for this job. {(() => { const s = selection.find((x) => x.itemId === i.itemId); const rest = left - (s?.counted ?? 0); return rest > 0 ? `${formatQty(rest, i.uom)} of the reserved ${formatQty(left, i.uom)} would stay on the shelf.` : rest === 0 ? "All of it is picked." : ""; })()}</p>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <FlagList flags={flags} />
      {problem ? <Alert variant="destructive" role="alert">{problem}</Alert> : null}
      {flow.error ? <Alert variant="destructive" role="alert">{flow.error}</Alert> : null}
      {flow.uncertain ? <UncertainSave flow={flow} what="pick" onRetry={save} /> : null}

      {pickable.length > 0 ? (
        <div className="sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-10 -mx-1 space-y-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur lg:bottom-0" data-testid="pick-action">
          <p className="text-sm" role="status">
            {pending.ok
              ? <>Saving records <strong>{formatQty(nowPicked, "")}</strong> as picked for this request{stillOnShelf > 0 ? <> and leaves <strong>{stillOnShelf}</strong> reserved on the shelf</> : null}. Nothing leaves the warehouse.</>
              : <span className="text-muted-foreground">Tick what you took off the shelf, or count it. What is already picked stays ticked.</span>}
          </p>
          <Button type="button" disabled={locked || !pending.ok} onClick={save} className="h-12 w-full text-base sm:h-10 sm:w-auto sm:text-sm">{flow.phase === "sending" ? "Saving…" : flow.uncertain ? "Check first, then try again" : "Pick items"}</Button>
        </div>
      ) : null}
    </div>
  );
}
