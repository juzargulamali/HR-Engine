"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LOST_REASONS, TODAY, type Opportunity, fmtDate, oppByRef } from "../_lib/data";
import { PLink } from "./context";
import { ClientLine, useOppRights } from "./sales-bits";
import { Field, PageHeader, Panel, PermissionDenied, Restriction } from "./ui";

export function CloseForm({ refId }: { refId: string }) {
  const opp = oppByRef(refId)!;
  const rights = useOppRights(opp);
  const [outcome, setOutcome] = useState<"won" | "lost">("won");
  const [evType, setEvType] = useState("Purchase order");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  if (opp.stage === "won" || opp.stage === "lost") {
    return (
      <>
        <PageHeader eyebrow={opp.ref} title="Already closed" />
        <Panel>
          <p className="text-sm">This opportunity is <strong>{opp.stage === "won" ? "won" : "lost"}</strong> ({fmtDate(opp.closedAt)}). {opp.stage === "won" && opp.evidence ? `Evidence: ${opp.evidence.type}, ${opp.evidence.reference}.` : `Reason: ${opp.lostReason}.`}</p>
          <p className="mt-2 text-sm text-muted-foreground">Reopening or correcting a closed opportunity is limited to the owner or a founder, and is recorded.</p>
          <PLink href={`/os-preview/sales/opportunities/${opp.ref}`} className="mt-3 inline-block text-sm font-medium text-[hsl(var(--os-link))] hover:underline">Back to the opportunity</PLink>
        </Panel>
      </>
    );
  }
  if (!rights.canChange) return <PermissionDenied what="closing this opportunity" who={rights.reason ?? ""} />;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (outcome === "won") {
      if (!ref.trim()) x.ref = "Enter the purchase order number, or the sender and subject of the authorised email.";
      if (!date) x.date = "Enter the date on the evidence.";
      else if (date > TODAY) x.date = "The evidence date cannot be in the future.";
    } else if (!reason) x.reason = "Choose why it was lost.";
    setErr(x);
    if (Object.keys(x).length === 0) setDone(true);
  }

  if (done) {
    return (
      <>
        <PageHeader eyebrow={opp.ref} title={outcome === "won" ? "Marked as won (preview)" : "Marked as lost (preview)"} />
        <div role="status" className="rounded-lg border border-success/40 bg-success/10 p-5">
          <p className="flex items-center gap-2 font-medium text-[hsl(var(--os-good))]"><CheckCircle2 className="h-5 w-5" aria-hidden />{outcome === "won" ? "Commercially won. The handover package is the next step." : "Lost. The reason is kept for reporting."}</p>
          <p className="mt-1 text-xs text-muted-foreground">Preview only: nothing was saved.</p>
          <div className="mt-3 flex gap-2">
            {outcome === "won" ? <PLink href={`/os-preview/sales/opportunities/${opp.ref}/handover`} className={cn(buttonVariants({ size: "sm" }))}>Prepare handover package</PLink> : null}
            <PLink href={`/os-preview/sales/opportunities/${opp.ref}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Back to the opportunity</PLink>
          </div>
        </div>
      </>
    );
  }

  const errKeys = Object.keys(err);
  return (
    <>
      <PageHeader eyebrow={opp.ref} title="Mark Won or Lost" description={opp.title} />
      <form noValidate onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {errKeys.length ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-[hsl(var(--os-bad))]"><p className="font-medium">Please fix {errKeys.length} {errKeys.length === 1 ? "thing" : "things"}:</p><ul className="mt-1 list-disc pl-6">{errKeys.map((k) => <li key={k}>{err[k]}</li>)}</ul></div> : null}
          <Panel title="Outcome">
            <fieldset className="flex flex-wrap gap-3">
              <legend className="sr-only">Outcome</legend>
              {(["won", "lost"] as const).map((o) => (
                <label key={o} className={cn("flex min-w-[9rem] cursor-pointer items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium", outcome === o ? "border-accent bg-accent/10" : "border-border")}>
                  <input type="radio" name="outcome" checked={outcome === o} onChange={() => { setOutcome(o); setErr({}); }} />{o === "won" ? "Won" : "Lost"}
                </label>
              ))}
            </fieldset>
          </Panel>
          {outcome === "won" ? (
            <Panel title="Evidence of the win" description="A purchase order, or an authorised email.">
              <div className="space-y-4">
                <Field label="Evidence type" htmlFor="c-type" required><Select id="c-type" value={evType} onChange={(e) => setEvType(e.target.value)}><option>Purchase order</option><option>Authorised email</option></Select></Field>
                <Field label={evType === "Purchase order" ? "PO number" : "Sender and subject"} htmlFor="c-ref" required error={err.ref}><Input id="c-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
                <Field label="Date on the evidence" htmlFor="c-date" required error={err.date}><Input id="c-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              </div>
            </Panel>
          ) : (
            <Panel title="Why was it lost?">
              <div className="space-y-4">
                <Field label="Reason" htmlFor="c-reason" required error={err.reason}><Select id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Choose a reason…</option>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
                <Field label="Note" htmlFor="c-note"><Textarea id="c-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
            </Panel>
          )}
          <div className="flex gap-2"><Button type="submit">{outcome === "won" ? "Confirm as won" : "Confirm as lost"}</Button><PLink href={`/os-preview/sales/opportunities/${opp.ref}`} className={cn(buttonVariants({ variant: "ghost" }))}>Cancel</PLink></div>
        </div>
        <aside aria-label="About closing" className="space-y-4">
          <Panel title="You are closing"><p className="text-sm font-medium">{opp.title}</p><p className="text-xs text-muted-foreground"><ClientLine o={opp} /></p></Panel>
          <Restriction>Only the owner or a founder can do this. It is recorded in the history.</Restriction>
        </aside>
      </form>
    </>
  );
}
