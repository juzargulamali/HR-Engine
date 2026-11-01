"use client";

import { useMemo, useState } from "react";
import { notFound, useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, ChevronDown, ScanLine, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  REQUESTS, PLAN_LABELS, bookingWindow, fmtDayTime, fmtRange, initialState, locName, reservedOf, reserveOutcome, returnedOf, sendFlags, sentOf, shortOf, stillOutOf, toSendOf,
  type Flag, type LineState, type SampleLine, type SampleRequest, type SendDraftLine, type Step,
} from "../../../_lib/inventory-concept";
import { InventoryFrame, NeedsBackend, useConceptNotice } from "../../../_components/inventory-bits";
import { ReturnList, type ReturnItem } from "../../../_components/inventory-sheets";
import { PLink } from "../../../_components/context";
import { ActionMenu, Chip, Field, Sheet, StateGate } from "../../../_components/ui";

type States = Record<string, LineState>;
const STEPS: { id: Step; label: string }[] = [{ id: "prepare", label: "1  Prepare" }, { id: "send", label: "2  Send out" }, { id: "back", label: "3  Receive back" }];

/* ---------------- header: context that stays visible through all three steps ---------------- */

function Context({ r }: { r: SampleRequest }) {
  const w = bookingWindow(r.plan);
  const overdue = new Date(r.plan.return_due).getTime() < new Date("2026-10-19T09:30:00+04:00").getTime();
  return (
    <section aria-label="Request" className="mb-5 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Request</p>
          <p className="font-heading text-xl font-semibold">{r.code}</p>
          <p className="text-sm text-muted-foreground">{locName(r.location)}</p>
        </div>
        <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-sm max-sm:w-full max-sm:grid-cols-1">
          <div><dt className="text-xs text-muted-foreground">Booking window</dt><dd className="font-medium">{fmtRange(w.from, w.to)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Dispatch</dt><dd className="font-medium">{fmtDayTime(r.plan.dispatch)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Due back</dt><dd className={cn("font-medium", overdue && "text-[hsl(var(--os-bad))]")}>{fmtDayTime(r.plan.return_due)}{overdue ? " · late" : ""}</dd></div>
        </dl>
      </div>
      <details className="group mt-3 text-sm">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[hsl(var(--os-link))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />More dates
        </summary>
        <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(PLAN_LABELS) as (keyof typeof PLAN_LABELS)[]).map((k) => <div key={k}><dt className="text-xs text-muted-foreground">{PLAN_LABELS[k]}</dt><dd>{fmtDayTime(r.plan[k])}</dd></div>)}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">The booking window runs from the earliest to the latest of these dates, so preparation and inspection time are held for this request and counted when availability is checked.</p>
      </details>
    </section>
  );
}

/* ---------------- 1 Prepare ---------------- */

function ReserveSheet({ line, st, loc, onClose, onReserve }: { line: SampleLine; st: LineState; loc: string; onClose: () => void; onReserve: (l: SampleLine, units: string[], qty: number, shortage: LineState["shortage"]) => void }) {
  const short = shortOf(line, st);
  const free = (line.free ?? []).filter((f) => !st.reserved.includes(f.code));
  const [mode, setMode] = useState<"auto" | "pick">("auto");
  const [ask, setAsk] = useState(String(short));
  const [picked, setPicked] = useState<string[]>([]);
  const [shortage, setShortage] = useState<LineState["shortage"]>(st.shortage);
  const n = Math.min(Math.max(Number(ask) || 0, 0), short);
  const out = reserveOutcome(line, st, mode === "pick" && line.tracking === "individual" ? picked.length : n);
  const autoUnits = free.slice(0, out.reserved).map((f) => f.code);
  const units = line.tracking === "individual" ? (mode === "pick" ? picked : autoUnits) : [];
  const willReserve = line.tracking === "individual" ? units.length : out.reserved;
  const stillShort = short - willReserve;
  return (
    <Sheet open onClose={onClose} title={`Reserve ${line.name}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{short} still needed for {loc}. Reserving holds equipment for the booking window; it does not send anything.</p>
        {line.tracking === "individual" ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Which units?</legend>
            <label className="flex items-start gap-2 text-sm"><input type="radio" name="rmode" checked={mode === "auto"} onChange={() => setMode("auto")} className="mt-1 accent-[hsl(var(--accent))]" /><span><strong>Choose free units for me</strong> <span className="text-muted-foreground">(recommended: units on the shelf first)</span></span></label>
            <label className="flex items-start gap-2 text-sm"><input type="radio" name="rmode" checked={mode === "pick"} onChange={() => setMode("pick")} className="mt-1 accent-[hsl(var(--accent))]" /><span><strong>Let me choose specific units</strong></span></label>
          </fieldset>
        ) : null}
        {line.tracking === "counted" || mode === "auto" ? (
          <Field label="How many" htmlFor="rs-qty" required tag={`(up to ${short})`}>
            <Input id="rs-qty" inputMode="numeric" value={ask} onChange={(e) => setAsk(e.target.value.replace(/[^0-9]/g, ""))} className="w-32" />
          </Field>
        ) : (
          <div>
            <p className="mb-1 text-sm font-medium">Free for these dates</p>
            {free.length === 0 ? <p className="text-sm text-muted-foreground">No unit is free for the booking window.</p> : (
              <ul className="divide-y divide-border/70 rounded-lg border border-border">
                {free.map((f) => (
                  <li key={f.code}><label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                    <input type="checkbox" checked={picked.includes(f.code)} onChange={(e) => setPicked(e.target.checked ? [...picked, f.code].slice(0, short) : picked.filter((c) => c !== f.code))} className="h-5 w-5 accent-[hsl(var(--accent))]" />
                    <span className="font-medium">{f.code}</span><span className="text-muted-foreground">{f.where}</span>
                  </label></li>
                ))}
              </ul>
            )}
          </div>
        )}
        {line.cannotUse ? <p className="text-xs text-muted-foreground">Not offered: {line.cannotUse}.</p> : null}
        <div role="status" className={cn("rounded-md px-3 py-2 text-sm", stillShort > 0 ? "border border-warning/60 bg-warning/10" : "bg-secondary/60")}>
          Will reserve <strong>{willReserve}</strong>{stillShort > 0 ? <> · <strong>{stillShort}</strong> will still be short{line.tracking === "counted" && (line.freeQty ?? 0) < short ? ` (only ${line.freeQty ?? 0} free for these dates)` : ""}</> : " · nothing short"}
        </div>
        {stillShort > 0 ? (
          <Field label="For what is still short" htmlFor="rs-short" tag="(optional)" hint="Tells the purchasing team what to look for. It does not order anything.">
            <Select id="rs-short" value={shortage} onChange={(e) => setShortage(e.target.value as LineState["shortage"])}>
              <option value="undecided">Decide later</option><option value="buy">We need to buy</option><option value="rent">We need to rent</option>
            </Select>
          </Field>
        ) : null}
        <Button type="button" disabled={willReserve === 0 && shortage === st.shortage} onClick={() => onReserve(line, units, willReserve, shortage)} className="h-11 w-full sm:h-9 sm:w-auto">{willReserve > 0 ? `Reserve ${willReserve}` : "Save"}</Button>
      </div>
    </Sheet>
  );
}

function Prepare({ r, states, setStates }: { r: SampleRequest; states: States; setStates: (s: States) => void }) {
  const notify = useConceptNotice();
  const [reserving, setReserving] = useState<SampleLine | null>(null);
  const totals = r.lines.reduce((a, l) => ({ needed: a.needed + l.needed, reserved: a.reserved + reservedOf(l, states[l.id]!) }), { needed: 0, reserved: 0 });
  const short = totals.needed - totals.reserved;
  const apply = (l: SampleLine, units: string[], qty: number, shortage: LineState["shortage"]) => {
    const s = states[l.id]!;
    const next: LineState = l.tracking === "individual" ? { ...s, reserved: [...s.reserved, ...units], shortage } : { ...s, reservedQty: s.reservedQty + qty, shortage };
    setStates({ ...states, [l.id]: next });
    setReserving(null);
    notify(qty > 0 ? `Reserved ${qty} × ${l.name}` : "Saved");
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm"><strong>{totals.reserved} of {totals.needed}</strong> reserved{short > 0 ? <> · <span className="font-medium text-warning">{short} short</span></> : <> · <span className="font-medium text-[hsl(var(--os-good))]">everything reserved</span></>}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled title="Proposed: needs a backend change to be safe">Reserve all open lines</Button>
          <NeedsBackend>Proposed, needs a backend change</NeedsBackend>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="hidden grid-cols-[minmax(0,2fr)_5rem_6rem_5rem_minmax(0,1.6fr)] gap-3 border-b border-border bg-secondary/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Equipment</span><span className="text-right">Needed</span><span className="text-right">Reserved</span><span className="text-right">Short</span><span className="text-right">Action</span>
        </div>
        <ul className="divide-y divide-border/70">
          {r.lines.map((l) => {
            const s = states[l.id]!;
            const sh = shortOf(l, s);
            return (
              <li key={l.id} className="grid gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,2fr)_5rem_6rem_5rem_minmax(0,1.6fr)] md:items-center">
                <div className="min-w-0">
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">{l.tracking === "individual" ? "Individual units" : "Counted"}{l.shortWhy && sh > 0 ? ` · ${l.shortWhy}` : ""}</p>
                  {s.substitution === "proposed" ? <p className="mt-1 text-xs"><Chip tone="info">Substitute proposed: {l.substitute}</Chip> <span className="text-muted-foreground">waiting for the Project Manager to decide</span></p> : null}
                  {s.shortage !== "undecided" && sh > 0 ? <p className="mt-1 text-xs"><Chip tone="warn">{s.shortage === "buy" ? "Need to buy" : "Need to rent"}</Chip></p> : null}
                </div>
                <p className="md:text-right"><span className="text-xs text-muted-foreground md:hidden">Needed </span>{l.needed}</p>
                <p className="md:text-right"><span className="text-xs text-muted-foreground md:hidden">Reserved </span>{reservedOf(l, s)}</p>
                <p className={cn("md:text-right", sh > 0 ? "font-semibold text-warning" : "text-muted-foreground")}><span className="text-xs font-normal text-muted-foreground md:hidden">Short </span>{sh > 0 ? sh : "—"}</p>
                <div className="flex items-center gap-1.5 md:justify-end">
                  {sh > 0 ? <Button type="button" size="sm" onClick={() => setReserving(l)} className="h-10 md:h-8">Reserve</Button> : <Chip tone="good" icon={CheckCircle2}>Reserved</Chip>}
                  {sh > 0 ? (
                    <ActionMenu label="More" items={[
                      ...(l.substitute && s.substitution === "none" ? [{ label: `Suggest ${l.substitute}`, onSelect: () => { setStates({ ...states, [l.id]: { ...s, substitution: "proposed" } }); notify(`Substitute proposed: ${l.substitute}`); } }] : []),
                      { label: "We need to buy the rest", onSelect: () => setStates({ ...states, [l.id]: { ...s, shortage: "buy" } }) },
                      { label: "We need to rent the rest", onSelect: () => setStates({ ...states, [l.id]: { ...s, shortage: "rent" } }) },
                    ]} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Reserving never sends anything. A substitute is only a proposal: the Project Manager decides.</p>
      {reserving ? <ReserveSheet line={reserving} st={states[reserving.id]!} loc={locName(r.location)} onClose={() => setReserving(null)} onReserve={apply} /> : null}
    </div>
  );
}

/* ---------------- 2 Send out ---------------- */

function Send({ r, states, setStates }: { r: SampleRequest; states: States; setStates: (s: States) => void }) {
  const notify = useConceptNotice();
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [scan, setScan] = useState("");
  const [unknown, setUnknown] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [exception, setException] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const draft: SendDraftLine[] = r.lines.map((l) => ({ line: l, ticked: ticked[l.id] ?? [], counted: l.tracking === "counted" ? (counted[l.id] === undefined || counted[l.id] === "" ? null : Number(counted[l.id])) : null }));
  const flags: Flag[] = sendFlags(draft, states, unknown);
  const blocked = flags.some((f) => f.level === "block");
  const picks = draft.reduce((n, d) => n + (d.line.tracking === "individual" ? d.ticked.length : d.counted ?? 0), 0);
  const remaining = r.lines.reduce((n, l) => n + toSendOf(l, states[l.id]!), 0);
  const unsent = (l: SampleLine) => states[l.id]!.reserved.filter((c) => !states[l.id]!.sent.includes(c));

  const onScan = () => {
    const code = scan.trim().toUpperCase();
    if (!code) return;
    const hit = r.lines.find((l) => l.tracking === "individual" && unsent(l).includes(code));
    if (hit) { setTicked((t) => ({ ...t, [hit.id]: [...new Set([...(t[hit.id] ?? []), code])] })); setUnknown((u) => u.filter((x) => x !== code)); }
    else if (r.lines.some((l) => states[l.id]!.sent.includes(code))) notify(`${code} has already been sent`);
    else setUnknown((u) => [...new Set([...u, code])]);
    setScan("");
  };
  const confirm = () => {
    const next: States = { ...states };
    for (const d of draft) {
      const s = next[d.line.id]!;
      next[d.line.id] = d.line.tracking === "individual" ? { ...s, sent: [...s.sent, ...d.ticked] } : { ...s, sentQty: s.sentQty + (d.counted ?? 0) };
    }
    setStates(next);
    setDone(`Recorded: ${picks} ${picks === 1 ? "item" : "items"} sent to ${r.project}.`);
    setTicked({}); setCounted({}); setUnknown([]); setReview(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm">
        Sending from <strong>{locName(r.location)}</strong> to <strong>{r.project}</strong> · request {r.code} · expected back <strong>{fmtDayTime(r.plan.return_due)}</strong>
      </div>
      {done ? <div role="status" className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2.5 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--os-good))]" aria-hidden /><p>{done} <span className="text-muted-foreground">{remaining} reserved {remaining === 1 ? "item stays" : "items stay"} to send. Preview only: nothing was saved.</span></p></div> : null}

      {review ? (
        <div className="space-y-3">
          <h3 className="font-heading text-sm font-semibold">Check before you confirm</h3>
          <ul className="divide-y divide-border/70 rounded-lg border border-border text-sm">
            {draft.filter((d) => (d.line.tracking === "individual" ? d.ticked.length : d.counted ?? 0) > 0).map((d) => (
              <li key={d.line.id} className="flex flex-wrap justify-between gap-2 px-3 py-2.5"><strong>{d.line.tracking === "individual" ? d.ticked.length : d.counted} × {d.line.name}</strong><span className="text-muted-foreground">{d.line.tracking === "individual" ? d.ticked.join(", ") : "counted"}</span></li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">To {r.project} · expected back {fmtDayTime(r.plan.return_due)}.</p>
          <FlagList flags={flags} />
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setReview(false)}>Back to edit</Button><Button type="button" disabled={blocked || picks === 0} onClick={confirm}>Confirm: send {picks}</Button></div>
        </div>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); onScan(); }} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1"><label htmlFor="send-scan" className="mb-1 block text-sm font-medium">Scan or type a code to tick it</label><Input id="send-scan" value={scan} onChange={(e) => setScan(e.target.value)} placeholder="e.g. PJ-0403" className="h-11 text-base sm:h-9 sm:text-sm" autoComplete="off" /></div>
            <Button type="submit" variant="outline" className="h-11 sm:h-9"><ScanLine className="h-4 w-4" aria-hidden />Add</Button>
          </form>
          <p className="-mt-2 text-xs text-muted-foreground">Nothing is ticked for you: reserved does not mean sent. Scanning only ticks a unit; Confirm records it.</p>

          <div className="space-y-3">
            {r.lines.map((l) => {
              const s = states[l.id]!;
              const left = toSendOf(l, s);
              return (
                <section key={l.id} className="rounded-lg border border-border bg-card">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
                    <h3 className="text-sm font-semibold">{l.name}</h3>
                    <p className="text-xs text-muted-foreground">Reserved {reservedOf(l, s)} · Sent {sentOf(l, s)} · <span className={cn(left > 0 && "font-medium text-foreground")}>To send {left}</span></p>
                  </header>
                  {left === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">{reservedOf(l, s) === 0 ? "Nothing is reserved for this line yet. Reserve it under Prepare." : "Everything reserved has been sent."}</p> : l.tracking === "individual" ? (
                    <div>
                      <ul className="divide-y divide-border/70">
                        {unsent(l).map((c) => (
                          <li key={c}><label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm"><input type="checkbox" checked={(ticked[l.id] ?? []).includes(c)} onChange={(e) => setTicked((t) => ({ ...t, [l.id]: e.target.checked ? [...(t[l.id] ?? []), c] : (t[l.id] ?? []).filter((x) => x !== c) }))} className="h-5 w-5 accent-[hsl(var(--accent))]" /><span className="font-medium">{c}</span><span className="text-muted-foreground">reserved for this request</span></label></li>
                        ))}
                      </ul>
                      <div className="border-t border-border/70 px-4 py-2"><button type="button" onClick={() => setTicked((t) => ({ ...t, [l.id]: unsent(l) }))} className="text-sm text-[hsl(var(--os-link))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tick all {unsent(l).length} of these</button></div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <label htmlFor={`cq-${l.id}`} className="text-sm">Counted quantity</label>
                      <Input id={`cq-${l.id}`} inputMode="numeric" placeholder={`up to ${left}`} value={counted[l.id] ?? ""} onChange={(e) => setCounted({ ...counted, [l.id]: e.target.value.replace(/[^0-9]/g, "") })} className="h-10 w-32 sm:h-9" />
                      <span className="text-xs text-muted-foreground">Count what you put in the box. It is never filled in for you.</span>
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <FlagList flags={flags} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={picks === 0} onClick={() => { setDone(null); setReview(true); }} className="h-11 w-full sm:h-9 sm:w-auto">Review {picks > 0 ? `${picks} to send` : ""}</Button>
            <button type="button" onClick={() => setException(true)} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Send something that is not on this request…</button>
          </div>
        </>
      )}

      <Sheet open={exception} onClose={() => setException(false)} title="Unplanned dispatch (exception)">
        <div className="space-y-3 text-sm">
          <p className="rounded-md border border-warning/60 bg-warning/10 px-3 py-2"><strong>This is an exception.</strong> The equipment goes to {r.project} but is recorded <em>without</em> this request, so it appears as “not part of a request” and never counts towards the request’s progress.</p>
          <p className="text-muted-foreground">Equipment already reserved by any request (including this project’s) cannot be sent this way; the system refuses it.</p>
          <Field label="Code or item" htmlFor="ex-code" required><Input id="ex-code" placeholder="Scan or type a code" /></Field>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><NeedsBackend>Needs a backend change</NeedsBackend>Recording it against this request, with a reason, is not possible today and is not part of this concept.</p>
          <Button type="button" onClick={() => { setException(false); notify("Would record an unplanned dispatch"); }} className="h-11 sm:h-9">Continue to review</Button>
        </div>
      </Sheet>
    </div>
  );
}

function FlagList({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;
  return (
    <ul aria-label="Check these first" className="space-y-1.5">
      {flags.map((f) => (
        <li key={f.text} role={f.level === "block" ? "alert" : undefined} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", f.level === "block" ? "border-destructive/40 bg-destructive/10 text-[hsl(var(--os-bad))]" : "border-warning/60 bg-warning/10")}>
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden /><span>{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- 3 Receive back ---------------- */

function Back({ r, states, setStates }: { r: SampleRequest; states: States; setStates: (s: States) => void }) {
  const [nonce, setNonce] = useState(0);
  const [justDone, setJustDone] = useState(false);
  const items: ReturnItem[] = useMemo(() => r.lines.flatMap((l): ReturnItem[] => {
    const s = states[l.id]!;
    if (l.tracking === "individual") return s.sent.filter((c) => !s.returned.includes(c)).map((c) => ({ key: c, name: l.name, sub: c, tracking: "individual" as const, max: 1 }));
    const out = stillOutOf(l, s);
    return out > 0 ? [{ key: l.id, name: l.name, tracking: "counted" as const, max: out }] : [];
  }), [r, states]);
  const totals = r.lines.reduce((a, l) => { const s = states[l.id]!; return { sent: a.sent + sentOf(l, s), ret: a.ret + returnedOf(l, s), out: a.out + stillOutOf(l, s) }; }, { sent: 0, ret: 0, out: 0 });
  const record = (res: { key: string; qty: number }[]) => {
    const next: States = { ...states };
    for (const l of r.lines) {
      const s = next[l.id]!;
      if (l.tracking === "individual") next[l.id] = { ...s, returned: [...s.returned, ...res.filter((x) => s.sent.includes(x.key)).map((x) => x.key)] };
      else { const q = res.find((x) => x.key === l.id)?.qty ?? 0; if (q) next[l.id] = { ...s, returnedQty: s.returnedQty + q }; }
    }
    setStates(next); setJustDone(true);
  };
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="hidden grid-cols-[minmax(0,2fr)_repeat(3,6rem)] gap-3 border-b border-border bg-secondary/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid"><span>Equipment</span><span className="text-right">Sent</span><span className="text-right">Returned</span><span className="text-right">Still out</span></div>
        <ul className="divide-y divide-border/70">
          {r.lines.filter((l) => sentOf(l, states[l.id]!) > 0).map((l) => { const s = states[l.id]!; const out = stillOutOf(l, s); return (
            <li key={l.id} className="grid grid-cols-3 gap-x-3 gap-y-1 px-4 py-2.5 text-sm md:grid-cols-[minmax(0,2fr)_repeat(3,6rem)] md:items-center">
              <p className="col-span-3 font-medium md:col-span-1">{l.name}</p>
              <p className="md:text-right"><span className="text-xs text-muted-foreground md:hidden">Sent </span>{sentOf(l, s)}</p>
              <p className="md:text-right"><span className="text-xs text-muted-foreground md:hidden">Returned </span>{returnedOf(l, s)}</p>
              <p className={cn("md:text-right", out > 0 ? "font-semibold" : "text-muted-foreground")}><span className="text-xs font-normal text-muted-foreground md:hidden">Still out </span>{out > 0 ? out : "—"}</p>
            </li>
          ); })}
        </ul>
        <p className="border-t border-border/70 bg-secondary/30 px-4 py-2 text-sm"><strong>Sent {totals.sent} · Returned {totals.ret} · Still out {totals.out}</strong></p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{totals.sent === 0 ? "Nothing has been sent for this request, so nothing can come back yet." : "Everything that was sent is back."}</p>
      ) : (
        <>
          <h3 className="font-heading text-sm font-semibold">What is actually here now?</h3>
          <ReturnList key={nonce} items={items} cameLabel="Came back" remainWord="out" confirmLabel="Confirm: record returns" onDone={record} />
          {justDone ? <Button type="button" variant="outline" onClick={() => { setNonce((n) => n + 1); setJustDone(false); }}>Record more returns</Button> : null}
        </>
      )}
    </div>
  );
}

/* ---------------- page ---------------- */

export default function ProjectEquipment() {
  const { id } = useParams<{ id: string }>();
  const r = REQUESTS[id];
  if (!r) notFound();
  return <Workspace r={r} />;
}

function Workspace({ r }: { r: SampleRequest }) {
  const router = useRouter();
  const sp = useSearchParams();
  const step: Step = sp.get("step") === "send" ? "send" : sp.get("step") === "back" ? "back" : sp.get("step") === "prepare" ? "prepare" : r.step;
  const [states, setStates] = useState<States>(() => Object.fromEntries(r.lines.map((l) => [l.id, initialState(l)])));
  const go = (s: Step) => { const q = new URLSearchParams(sp.toString()); q.set("step", s); router.replace(`?${q.toString()}`, { scroll: false }); };
  return (
    <InventoryFrame section="project" title={r.project} description="One place for this project's equipment: prepare it, send it out, receive it back.">
      <StateGate what="this project's equipment" emptyTitle="No equipment requested" emptyText="This request has no lines yet." deniedWho="Your account has no warehouse access for this request.">
        <PLink href="/os-preview/inventory" className="mb-3 inline-block text-sm text-[hsl(var(--os-link))] underline-offset-4 hover:underline">← Back to Today</PLink>
        <Context r={r} />
        <div role="tablist" aria-label="Project equipment steps" className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-border bg-card p-1">
          {STEPS.map((s, i) => (
            <button key={s.id} type="button" role="tab" aria-selected={step === s.id} id={`step-${s.id}`} onClick={() => go(s.id)}
              className={cn("flex h-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", step === s.id ? "brand-gradient font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground")}>
              {s.label}{i < 2 ? <ArrowRight className="hidden h-3.5 w-3.5 opacity-50 sm:block" aria-hidden /> : null}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-labelledby={`step-${step}`}>
          {step === "prepare" ? <Prepare r={r} states={states} setStates={setStates} /> : null}
          {step === "send" ? <Send r={r} states={states} setStates={setStates} /> : null}
          {step === "back" ? <Back r={r} states={states} setStates={setStates} /> : null}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">These three steps are working views of the same request and its reservations. They add no approval and no new status.</p>
      </StateGate>
    </InventoryFrame>
  );
}
