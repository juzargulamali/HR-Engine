"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { PanelLink } from "@/components/workspace/panel-link";
import { SidePanel } from "@/components/workspace/side-panel";
import { withParams } from "@/components/workspace/url-state";
import { REQUEST_CODE, SAMPLE_ITEMS, fmtDay, type EquipmentLine, type Project } from "../_lib/sample";
import { useConcept } from "../_lib/store";
import { Badge, EmptyNote, Notice } from "./bits";

const short = (l: EquipmentLine) => (l.draft ? 0 : Math.max(0, l.requested - l.reserved));

/** What the project asked for and where it stands, in four separate steps. Availability, reservation and dispatch stay distinct. */
export function EquipmentView({ project, lines, here }: { project: Project; lines: EquipmentLine[]; here: string }) {
  const { addEquipmentRequest, notify } = useConcept();
  const sp = useSearchParams();
  const pathname = usePathname();
  const eq = sp.get("eq");
  const real = lines.filter((l) => !l.draft);
  const sum = (k: "requested" | "reserved" | "dispatched" | "returned") => real.reduce((n, l) => n + l[k], 0);
  const totalShort = real.reduce((n, l) => n + short(l), 0);
  const code = REQUEST_CODE[project.id];
  const [asking, setAsking] = useState(false);
  const [item, setItem] = useState(SAMPLE_ITEMS[0]!);
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const eqHref = (v: string) => withParams(pathname, sp, { eq: v, task: null, ms: null });
  const line = lines.find((l) => l.id === eq) ?? null;
  const q = Number(qty);
  const qtyOk = Number.isInteger(q) && q > 0 && q <= 500;

  const stats: [string, number, boolean?][] = [["Requested", sum("requested")], ["Reserved", sum("reserved")], ["Dispatched", sum("dispatched")], ["Returned", sum("returned")], ["Short", totalShort, totalShort > 0]];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{code ? <>Request <PanelLink href={eqHref("request")} className="rounded-sm font-medium text-foreground underline underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{code}</PanelLink> · {real.length} {real.length === 1 ? "item" : "items"}</> : "No request has been made for this project."}</p>
        <Button type="button" onClick={() => setAsking(true)}>Request equipment</Button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5" aria-label="Equipment summary">
        {stats.map(([label, n, warn]) => (
          <div key={label} className={`rounded-lg bg-card px-4 py-3 ${warn ? "ring-1 ring-[hsl(var(--cx-amber)/0.6)]" : ""}`}>
            <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">{warn ? <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--cx-amber))]" aria-hidden /> : null}{label}</dt>
            <dd className="font-heading text-2xl font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[13px] text-muted-foreground">Units, not stock levels: availability is checked in Inventory. Requested, reserved, dispatched and returned are four separate steps.</p>

      <div className="mt-4">
        {lines.length === 0 ? <EmptyNote title="No equipment requested" action={<Button type="button" onClick={() => setAsking(true)}>Request equipment</Button>}>Request what the project needs. The request goes to the warehouse team in the live app.</EmptyNote> : (
          <>
            <div className="hidden overflow-clip rounded-lg bg-card lg:block">
              <table className="cx-table">
                <caption className="sr-only">Equipment lines</caption>
                <colgroup><col style={{ width: "30%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "11%" }} /><col style={{ width: "10%" }} /><col style={{ width: "29%" }} /></colgroup>
                <thead><tr><th scope="col">Item</th><th scope="col">Requested</th><th scope="col">Reserved</th><th scope="col">Dispatched</th><th scope="col">Returned</th><th scope="col">State</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} data-selected={eq === l.id}>
                      <td><PanelLink href={eqHref(l.id)} className="cx-trunc rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span title={l.item}>{l.item}</span></PanelLink></td>
                      <td className="tabular-nums">{l.requested}</td><td className="tabular-nums">{l.draft ? "–" : l.reserved}</td><td className="tabular-nums">{l.draft ? "–" : l.dispatched}</td><td className="tabular-nums">{l.draft ? "–" : l.returned}</td>
                      <td><LineState l={l} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-2.5 lg:hidden" aria-label="Equipment lines">
              {lines.map((l) => (
                <li key={l.id} className="rounded-lg bg-card p-4">
                  <PanelLink href={eqHref(l.id)} className="block break-words font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{l.item}</PanelLink>
                  <p className="mt-1 text-sm text-muted-foreground">Requested {l.requested}{l.draft ? "" : ` · Reserved ${l.reserved} · Dispatched ${l.dispatched} · Returned ${l.returned}`}</p>
                  <div className="mt-2"><LineState l={l} /></div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <Modal open={asking} onClose={() => setAsking(false)} title="Request equipment" description="Sample only: this makes a draft line in this tab. Nothing is sent to the warehouse.">
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (!qtyOk) return; setBusy(true); const ok = await addEquipmentRequest(project.id, item, q); setBusy(false); if (ok) { setAsking(false); setQty("1"); } }} noValidate>
          <div><label htmlFor="cx-eq-item" className="mb-1 block text-sm font-medium">Item</label><Select id="cx-eq-item" value={item} onChange={(e) => setItem(e.target.value)}>{SAMPLE_ITEMS.map((i) => <option key={i}>{i}</option>)}</Select></div>
          <div><label htmlFor="cx-eq-qty" className="mb-1 block text-sm font-medium">How many</label><Input id="cx-eq-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} aria-invalid={!qtyOk} aria-describedby="cx-eq-qty-h" /><p id="cx-eq-qty-h" className={`mt-1 text-[13px] ${qtyOk ? "text-muted-foreground" : "text-destructive"}`}>{qtyOk ? "A whole number." : "Enter a whole number from 1 to 500."}</p></div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAsking(false)}>Cancel</Button><Button type="submit" disabled={busy || !qtyOk}>{busy ? "Saving…" : "Add draft line"}</Button></div>
        </form>
      </Modal>

      {eq === "request" && code ? (
        <SidePanel title={`Request ${code}`} subtitle={`${project.ref} · Equipment request`} closeHref={withParams(pathname, sp, {}, ["eq"])}>
          <div className="space-y-5 text-sm">
            <table className="w-full text-left">
              <thead><tr className="text-[13px] text-muted-foreground"><th className="py-1.5 pr-2 font-medium">Item</th><th className="px-2 font-medium">Req.</th><th className="px-2 font-medium">Res.</th><th className="px-2 font-medium">Disp.</th><th className="pl-2 font-medium">Ret.</th></tr></thead>
              <tbody>{real.map((l) => <tr key={l.id} className="border-t border-border/60"><td className="py-2 pr-2">{l.item}</td><td className="px-2 tabular-nums">{l.requested}</td><td className="px-2 tabular-nums">{l.reserved}</td><td className="px-2 tabular-nums">{l.dispatched}</td><td className="pl-2 tabular-nums">{l.returned}</td></tr>)}</tbody>
            </table>
            {totalShort > 0 ? <Notice tone="warn" title={`Short by ${totalShort}`}>{real.filter((l) => short(l) > 0).map((l) => `${l.item}: ${short(l)}`).join("; ")}. Someone decides whether to buy, rent or move stock; this concept does not decide for them.</Notice> : null}
            <p className="text-muted-foreground"><span className="font-semibold text-foreground">Requested</span> is what the project asked for. <span className="font-semibold text-foreground">Reserved</span> is stock set aside. <span className="font-semibold text-foreground">Dispatched</span> is handed over. <span className="font-semibold text-foreground">Returned</span> is back in the warehouse.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => notify("info", "The full request page lives in the live app’s Inventory. It is not part of this concept.")}>Open the full request</Button>
          </div>
        </SidePanel>
      ) : line ? (
        <SidePanel title={line.item} subtitle={`${project.ref} · Equipment line`} closeHref={withParams(pathname, sp, {}, ["eq"])}>
          <div className="space-y-5 text-sm">
            <LineState l={line} />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {([["Requested", line.requested], ["Reserved", line.draft ? "–" : line.reserved], ["Dispatched", line.draft ? "–" : line.dispatched], ["Returned", line.draft ? "–" : line.returned]] as const).map(([k, v]) => <div key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-heading text-xl font-semibold tabular-nums">{v}</dd></div>)}
            </dl>
            {line.dueBack ? <p>Due back: <span className="font-medium">{fmtDay(line.dueBack)}</span></p> : null}
            {line.shortNote ? <Notice tone="warn" title="Shortage">{line.shortNote}</Notice> : null}
            {line.draft ? <Notice title="Draft, not sent">You added this line in the concept. In the live app, sending the request is a separate step.</Notice> : null}
            <Notice>Reserving and dispatching happen in Inventory. This concept only shows where each step stands, so nothing here reserves or dispatches stock.</Notice>
          </div>
        </SidePanel>
      ) : null}
      
    </div>
  );
}

function LineState({ l }: { l: EquipmentLine }) {
  if (l.draft) return <Badge tone="blue">Draft: not sent</Badge>;
  const s = short(l);
  if (s > 0) return <span className="inline-flex items-center gap-1.5 text-sm"><AlertTriangle className="h-3.5 w-3.5 flex-none text-[hsl(var(--cx-amber))]" aria-hidden /><span className="font-semibold text-[hsl(var(--cx-amber))]">Short by {s}</span></span>;
  if (l.dispatched > 0) return <span className="text-sm text-muted-foreground">Dispatched{l.dueBack ? ` · due back ${fmtDay(l.dueBack)}` : ""}</span>;
  return <span className="text-sm text-muted-foreground">Reserved in full</span>;
}
