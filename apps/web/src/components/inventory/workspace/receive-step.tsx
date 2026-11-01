"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useUnsavedChanges } from "@/components/workspace/unsaved";
import { draftFromCandidate, type Candidate } from "@/lib/inventory/stock-candidates";
import { parseLines, validateInput, type LineDraft, type MovementInput, type SummaryRow } from "@/lib/inventory/stock-movements";
import { BALANCE_CONDITION_WORDS, CONDITION_WORDS, formatQty } from "@/lib/inventory/words";
import { returnOutcome, type HolderOf, type ItemTotals } from "@/lib/inventory/workspace";
import { cn } from "@/lib/utils";
import { DonePanel, ReviewPanel } from "../stock/movement-review";
import { SentReturned } from "./sent-returned";
import { liveServices } from "../stock/movement-services-live";
import { useMovementFlow } from "../stock/use-movement-flow";

export interface ReceiveStepProps {
  companyId: string;
  projectId: string;
  projectName: string;
  requestCode: string;
  locations: { id: string; name: string }[];
  defaultLocationId: string;
  /** What the project is recorded as holding (the same list the return form uses), or the reason it could not be loaded. */
  held: Candidate[];
  heldError: string | null;
  totals: ItemTotals[];
  holders: Record<string, HolderOf>;
}

const HOLDER_LABEL: Record<HolderOf, string> = { this: "This request", other: "Another request", none: "Not from a request" };

/**
 * Receive back: starts from what is actually outstanding (what the PROJECT is recorded as holding), shows Sent / Returned / Still out at the
 * level the data supports (see lib/inventory/workspace.ts), and never assumes anything came back: nothing is ticked, a condition is chosen for
 * everything received, partial returns are normal. Good equipment becomes available through the existing rules; damaged or unchecked equipment
 * stays unavailable until it is checked.
 */
export function ReceiveStep(p: ReceiveStepProps) {
  const router = useRouter();
  const uid = useId();
  const flow = useMovementFlow(liveServices, p.companyId, "return");
  const locked = flow.uncertain && flow.phase !== "done";
  const [locationId, setLocationId] = useState(p.defaultLocationId);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cond, setCond] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const isUnit = (c: Candidate) => c.type === "unit";
  const chosen = p.held.filter((c) => (isUnit(c) ? ticked[c.key] : Number(qty[c.key] || 0) > 0));
  const dirty = chosen.length > 0;
  useUnsavedChanges(uid, dirty && flow.phase !== "done");
  useEffect(() => { if (flow.phase === "done") router.refresh(); }, [flow.phase]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when it is recorded

  const missing = chosen.filter((c) => !cond[c.key]);
  const drafts = (): LineDraft[] => chosen.map((c, i) => ({ ...draftFromCandidate(c, "return", `r${i}`), qty: isUnit(c) ? "" : (qty[c.key] ?? ""), condition: cond[c.key] ?? "" }));
  const build = (key: string): { input: MovementInput } | { error: string } => {
    if (missing.length > 0) return { error: `Choose a condition for ${missing.map((c) => (c.code ? `${c.itemName} (${c.code})` : c.itemName)).join(", ")}.` };
    const parsed = parseLines("return", drafts());
    if (!parsed.ok) return { error: parsed.error };
    const input: MovementInput = { kind: "return", companyId: p.companyId, locationId: locationId || null, key, lines: parsed.lines, projectId: p.projectId, returnFrom: "project" };
    const bad = validateInput(input);
    return bad ? { error: bad } : { input };
  };
  const onReview = () => {
    setShown(true);
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

  const countOf = (c: Candidate) => (isUnit(c) ? 1 : Number(qty[c.key] || 0));
  const heldCount = (c: Candidate[]) => c.reduce((n, x) => n + (isUnit(x) ? 1 : (x.qty ?? 0)), 0);
  const stay = Math.max(0, heldCount(p.held) - chosen.reduce((n, c) => n + countOf(c), 0));
  const heldBack = chosen.filter((c) => returnOutcome(cond[c.key] ?? "", isUnit(c) || c.tracking === "individual") === "held").length;
  const rows: SummaryRow[] = [
    { label: "What", value: chosen.map((c) => `${isUnit(c) ? 1 : formatQty(countOf(c), c.uom)} × ${c.itemName}${c.code ? ` (${c.code})` : c.binLabel ? ` (bin ${c.binLabel})` : ""}: ${conditionWord(isUnit(c), cond[c.key] ?? "good")}`).join("\n") },
    { label: "From", value: `Project ${p.projectName}` },
    { label: "Back into", value: p.locations.find((l) => l.id === locationId)?.name ?? "—" },
    { label: "Still out", value: stay > 0 ? `${stay} ${stay === 1 ? "item stays" : "items stay"} with the project until you record ${stay === 1 ? "it" : "them"} coming back` : "Nothing else is out" },
    ...(heldBack > 0 ? [{ label: "Held back", value: `${heldBack} ${heldBack === 1 ? "item is" : "items are"} not in good condition. ${heldBack === 1 ? "It is" : "They are"} held for checking and not available until someone releases ${heldBack === 1 ? "it" : "them"}` }] : []),
  ];

  if (flow.phase === "done") return <DonePanel flow={flow} onAnother={() => { setTicked({}); setQty({}); setCond({}); setShown(false); flow.startNew(); }} />;
  if (flow.phase === "reviewing" || flow.phase === "sending") return <ReviewPanel flow={flow} rows={rows} confirmLabel="Confirm: record returns" onConfirm={onConfirm} />;

  const sentTotal = p.totals.reduce((n, t) => n + t.sent, 0);
  return (
    <div className="space-y-4" data-step="back">
      {p.totals.length > 0 ? (
        <SentReturned totals={p.totals} heading={`Equipment sent for ${p.requestCode}`} />
      ) : sentTotal === 0 ? <p className="rounded-lg border border-border bg-card px-4 py-4 text-sm text-muted-foreground">Nothing has been sent for this request, so nothing from it can be out yet.</p> : null}

      <h3 className="font-heading text-sm font-semibold">What is actually here now?</h3>
      {p.heldError ? (
        <Alert variant="destructive" role="alert">
          What {p.projectName} is holding could not be loaded: {p.heldError} This is not an empty list.{" "}
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => router.refresh()}>Try again</button>
        </Alert>
      ) : p.held.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{p.projectName} holds nothing that is recorded as dispatched to it. Everything that was sent is back.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span>Receiving into</span>
            {p.locations.length > 1 ? (
              <><label htmlFor={`${uid}-into`} className="sr-only">Receive into</label><Select id={`${uid}-into`} value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={locked} className="h-9 w-auto font-semibold">{p.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></>
            ) : <strong>{p.locations[0]?.name ?? "—"}</strong>}
          </div>
          <ul className="divide-y divide-border/70 rounded-lg border border-border bg-card" aria-label="Held by the project">
            {[...p.held].sort((a, b) => holderRank(holderOf(a, p.holders)) - holderRank(holderOf(b, p.holders)) || a.itemName.localeCompare(b.itemName)).map((c) => {
              const on = isUnit(c) ? !!ticked[c.key] : Number(qty[c.key] || 0) > 0;
              const individual = isUnit(c);
              const options = Object.entries(individual ? CONDITION_WORDS : BALANCE_CONDITION_WORDS);
              const outcome = returnOutcome(cond[c.key] ?? "", individual);
              const label = `${c.itemName}${c.code ? ` · ${c.code}` : c.binLabel ? ` · bin ${c.binLabel}` : ""}`;
              const holder = holderOf(c, p.holders);
              return (
                <li key={c.key} className={cn("grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", on && "bg-accent/5")}>
                  <div className="flex items-start gap-3">
                    {individual ? <input id={`${uid}-t-${c.key}`} type="checkbox" checked={!!ticked[c.key]} onChange={(e) => setTicked({ ...ticked, [c.key]: e.target.checked })} disabled={locked} className="mt-1 h-5 w-5 flex-none accent-[hsl(var(--accent))]" /> : null}
                    <div className="min-w-0">
                      <label htmlFor={individual ? `${uid}-t-${c.key}` : `${uid}-q-${c.key}`} className="block text-sm font-medium">{label}</label>
                      <p className="text-xs text-muted-foreground">
                        {individual ? "Came back" : `${formatQty(c.qty ?? 0, c.uom)} held by the project`}
                        {c.serial ? ` · serial ${c.serial}` : ""}{individual ? ` · ${HOLDER_LABEL[holder]}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {!individual ? <Input id={`${uid}-q-${c.key}`} inputMode={c.scale > 0 ? "decimal" : "numeric"} aria-label={`How many ${c.itemName} came back`} placeholder="How many" value={qty[c.key] ?? ""} onChange={(e) => setQty({ ...qty, [c.key]: e.target.value })} disabled={locked} className="h-10 w-28 sm:h-9" /> : null}
                    {on ? (
                      <>
                        <label htmlFor={`${uid}-c-${c.key}`} className="sr-only">Condition of {label}</label>
                        <Select id={`${uid}-c-${c.key}`} value={cond[c.key] ?? ""} onChange={(e) => setCond({ ...cond, [c.key]: e.target.value })} disabled={locked} aria-invalid={shown && !cond[c.key] ? true : undefined} className="h-10 w-44 sm:h-9">
                          <option value="">Choose condition</option>
                          {options.map(([v, w]) => <option key={v} value={v}>{w}</option>)}
                        </Select>
                        {outcome === "available" ? <Badge variant="success">Available again</Badge> : outcome === "held" ? <Badge variant="warning">Held, not available</Badge> : null}
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Nothing is ticked for you. Tick only what is actually here. Good equipment becomes available again; damaged or unchecked equipment stays unavailable until it is checked. Anything you leave out stays with the project.</p>
          {problem && shown ? <Alert variant="destructive" role="alert">{problem}</Alert> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={chosen.length === 0 || locked} onClick={onReview} className="h-11 w-full sm:h-9 sm:w-auto">Review{chosen.length > 0 ? ` ${chosen.length} ${chosen.length === 1 ? "line" : "lines"}` : ""}</Button>
            {chosen.length === 0 ? <span className="text-xs text-muted-foreground">Tick what came back to continue.</span> : null}
          </div>
        </>
      )}
    </div>
  );
}

const conditionWord = (individual: boolean, value: string): string => (individual ? (CONDITION_WORDS as Record<string, string>) : (BALANCE_CONDITION_WORDS as Record<string, string>))[value] ?? value;
const holderOf = (c: Candidate, holders: Record<string, HolderOf>): HolderOf => (c.unitId ? holders[c.unitId] ?? "none" : "none");
const holderRank = (h: HolderOf) => (h === "this" ? 0 : h === "other" ? 1 : 2);
