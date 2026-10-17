"use client";

import { useState } from "react";
import { CheckCircle2, Circle, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Opportunity, buildHandover, fmtDate, personName, oppByRef } from "../_lib/data";
import { PLink } from "./context";
import { useOppRights } from "./sales-bits";
import { Chip, PageHeader, Panel, PermissionDenied, Restriction, useNotice } from "./ui";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Panel title={title}>{children}</Panel>;
}

export function HandoverView({ refId }: { refId: string }) {
  const opp = oppByRef(refId)!;
  const rights = useOppRights(opp);
  const { notify, node } = useNotice();
  const [prepared, setPrepared] = useState(opp.handover === "prepared");
  if (opp.stage !== "won") {
    return <PermissionDenied what="a handover package yet" who="A handover package can only be prepared after the opportunity is commercially won, with a purchase order or authorised email on record." />;
  }
  const h = buildHandover(opp);
  const gaps: string[] = [];
  if (opp.availability.state !== "confirmed") gaps.push("Technology availability is not confirmed.");
  if (h.acceptedProposal.startsWith("No proposal")) gaps.push("No accepted proposal or quote is recorded.");
  if (!opp.paymentTerms) gaps.push("Payment terms are not recorded.");
  if (opp.contacts.length === 0) gaps.push("No contacts are linked.");
  if (!opp.installStart && !opp.eventStart) gaps.push("No dates are recorded.");

  return (
    <>
      <PageHeader
        eyebrow={`${opp.ref} · Handover package`} title={opp.title}
        description="Everything the Project Manager needs to start, in one place. This is a package of facts, not a project: no tasks or team are created here."
        actions={rights.canChange ? (prepared ? <Chip tone="good" icon={CheckCircle2}>Prepared</Chip> : <Button size="sm" onClick={() => { setPrepared(true); notify("Handover package marked as prepared"); }}>Mark package as prepared</Button>) : undefined}
      />
      {!rights.canChange ? <div className="mb-4"><Restriction>Only the owner ({personName(opp.owner)}) prepares the package. You can read it.</Restriction></div> : null}
      <ol className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="Status">
        {[{ l: "Commercially won", d: true }, { l: "Handover prepared", d: prepared }, { l: "PM accepted (later release)", d: false }].map((s) => (
          <li key={s.l} className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium">{s.d ? <CheckCircle2 className="h-4 w-4 text-[hsl(var(--os-good))]" aria-hidden /> : <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />}{s.l}<span className="ml-auto text-xs font-normal text-muted-foreground">{s.d ? "Done" : "Not yet"}</span></li>
        ))}
      </ol>
      {gaps.length ? (
        <div role="alert" className="mb-6 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <p className="flex items-center gap-1.5 font-medium"><TriangleAlert className="h-4 w-4" aria-hidden />{gaps.length} {gaps.length === 1 ? "gap" : "gaps"} to resolve before the PM accepts</p>
          <ul className="mt-1 list-disc pl-6">{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Accepted scope"><p className="text-sm">{h.acceptedScope}</p><h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exclusions</h3><p className="mt-1 text-sm">{h.exclusions}</p></Section>
        <Section title="Latest accepted proposal / quote"><p className="text-sm">{h.acceptedProposal}</p></Section>
        <Section title="Confirmation"><p className="text-sm">{h.confirmation}</p></Section>
        <Section title="Promised technologies"><div className="flex flex-wrap gap-1.5">{h.technologies.map((t) => <Chip key={t}>{t}</Chip>)}</div><p className="mt-2 text-xs text-muted-foreground">Availability: {opp.availability.state === "confirmed" ? `confirmed by ${personName(opp.availability.by)}` : "not confirmed"}</p></Section>
        <Section title="Dates and place"><p className="text-sm">{h.dates}</p><p className="mt-1 text-xs text-muted-foreground">Location: {opp.location ?? "Not recorded"}</p></Section>
        <Section title="Contacts">{h.contacts.length ? <ul className="space-y-1 text-sm">{h.contacts.map((c) => <li key={c.name}><strong>{c.name}</strong> <span className="text-muted-foreground">· {c.role}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No contacts linked.</p>}</Section>
        <Section title="Payment terms"><p className="text-sm">{h.paymentTerms}</p></Section>
        <Section title="Unresolved risks">{h.risks.length ? <ul className="list-disc pl-5 text-sm">{h.risks.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="text-sm text-muted-foreground">None recorded.</p>}</Section>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Won {fmtDate(opp.closedAt)}.</p>
      <PLink href={`/os-preview/sales/opportunities/${opp.ref}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-2")}>Back to the opportunity</PLink>
      {node}
    </>
  );
}
