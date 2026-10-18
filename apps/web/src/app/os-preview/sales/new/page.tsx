"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { COMPANIES, OPPORTUNITIES, ORGS, SOURCES, TODAY, isOpen, personName, stageLabel, type CompanyId } from "../../_lib/data";
import { PLink, usePreview } from "../../_components/context";
import { Field, PageHeader, Panel, StateGate, StageChip } from "../../_components/ui";

interface Form { title: string; source: string; party: string; contact: string; action: string; date: string; company: CompanyId; eventStart: string; budget: string; place: string; techs: string }
const EMPTY: Form = { title: "", source: "", party: "", contact: "", action: "", date: "", company: "uae", eventStart: "", budget: "", place: "", techs: "" };

export default function NewEnquiry() {
  const { roleDef } = usePreview();
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [override, setOverride] = useState("");
  const [saved, setSaved] = useState<null | { ref: string }>(null);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const duplicates = useMemo(() => {
    const needle = f.party.trim().toLowerCase();
    if (needle.length < 4) return [];
    const orgIds = ORGS.filter((o) => o.name.toLowerCase().includes(needle) || needle.includes(o.name.toLowerCase())).map((o) => o.id);
    return OPPORTUNITIES.filter((o) => isOpen(o) && ((o.agencyId && orgIds.includes(o.agencyId)) || (o.endClientId && orgIds.includes(o.endClientId))));
  }, [f.party]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!f.title.trim()) err.title = "Describe the requirement in a few words.";
    if (!f.source) err.source = "Choose where the enquiry came from.";
    if (!f.party.trim() && !f.contact.trim()) err.party = "Give an agency or end-client name, or a contact name. One is enough.";
    if (!f.action.trim()) err.action = "Every open opportunity needs a next action.";
    if (!f.date) err.date = "Choose when the next action is due.";
    else if (f.date < TODAY) err.date = "The next action date cannot be in the past.";
    if (duplicates.length && !override.trim()) err.override = "A similar opportunity exists. Explain why this is a separate one, or open the existing one instead.";
    setErrors(err);
    if (Object.keys(err).length) { document.getElementById("form-errors")?.focus(); return; }
    setSaved({ ref: "OPP-2026-0055" });
  }

  if (saved) {
    return (
      <>
        <PageHeader eyebrow="Sales & CRM" title="New enquiry" />
        <div role="status" className="rounded-lg border border-success/40 bg-success/10 p-6">
          <p className="flex items-center gap-2 font-heading text-lg font-semibold text-[hsl(var(--os-good))]"><CheckCircle2 className="h-5 w-5" aria-hidden />Enquiry recorded (preview only)</p>
          <p className="mt-2 text-sm">It would be created as <strong>{saved.ref}</strong> in stage <strong>New enquiry</strong>, owned by <strong>{personName(roleDef.person)}</strong> as its creator, with the next action “{f.action}” on {f.date}.</p>
          <p className="mt-1 text-xs text-muted-foreground">Preview only: nothing was saved.</p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => { setF(EMPTY); setOverride(""); setSaved(null); }}>Record another</Button>
            <PLink href="/os-preview/sales/opportunities" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Back to opportunities</PLink>
          </div>
        </div>
      </>
    );
  }

  const errKeys = Object.keys(errors);
  return (
    <>
      <PageHeader eyebrow="Sales & CRM" title="New enquiry" description="Five things are required. Leave anything you do not know blank." />
      <StateGate what="the enquiry form" emptyTitle="Nothing to show" emptyText="This form has no empty state.">
        <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            {errKeys.length ? (
              <div id="form-errors" tabIndex={-1} role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-[hsl(var(--os-bad))] outline-none">
                <p className="flex items-center gap-1.5 font-medium"><TriangleAlert className="h-4 w-4" aria-hidden />Please fix {errKeys.length} {errKeys.length === 1 ? "thing" : "things"} before saving:</p>
                <ul className="mt-1 list-disc pl-6">{errKeys.map((k) => <li key={k}>{errors[k]}</li>)}</ul>
              </div>
            ) : null}

            <Panel title="Required">
              <div className="space-y-4">
                <Field label="Requirement" htmlFor="e-title" required error={errors.title} hint="Title or one-line brief, for example “LED tunnel for a mall activation”."><Input id="e-title" value={f.title} onChange={set("title")} /></Field>
                <Field label="Source" htmlFor="e-source" required error={errors.source} ><Select id="e-source" value={f.source} onChange={set("source")}><option value="">Choose a source…</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
                <fieldset aria-describedby="who-help" className="rounded-md border border-border p-3.5">
                  <legend className="px-1 text-sm font-medium">Who is it from? <span className="text-xs font-normal text-muted-foreground">(required: at least one)</span></legend>
                  <p id="who-help" className="mb-3 text-xs text-muted-foreground">Give an agency or end-client name, or a contact name. One is enough.</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Agency or end-client name" htmlFor="e-party" tag="(either this…)"><Input id="e-party" value={f.party} onChange={set("party")} aria-invalid={!!errors.party} aria-describedby={errors.party ? "who-error" : undefined} /></Field>
                    <Field label="Contact name" htmlFor="e-contact" tag="(…or this)"><Input id="e-contact" value={f.contact} onChange={set("contact")} aria-invalid={!!errors.party} aria-describedby={errors.party ? "who-error" : undefined} /></Field>
                  </div>
                  {errors.party ? <p id="who-error" role="alert" className="mt-3 flex items-center gap-1 text-xs text-[hsl(var(--os-bad))]"><CircleAlert className="h-3.5 w-3.5" aria-hidden />{errors.party}</p> : null}
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Next action" htmlFor="e-action" required error={errors.action}><Input id="e-action" value={f.action} onChange={set("action")} placeholder="Call to qualify" /></Field>
                  <Field label="Next action date" htmlFor="e-date" required error={errors.date}><Input id="e-date" type="date" value={f.date} onChange={set("date")} /></Field>
                </div>
              </div>
            </Panel>

            {duplicates.length ? (
              <section role="region" aria-label="Possible duplicate" className="rounded-lg border border-warning/50 bg-warning/10 p-4">
                <h2 className="flex items-center gap-1.5 font-heading text-sm font-semibold text-foreground"><TriangleAlert className="h-4 w-4" aria-hidden />Possible duplicate</h2>
                <p className="mt-1 text-sm">We found open opportunities for the same agency or client. Records are never merged automatically.</p>
                <ul className="mt-2 space-y-1.5">
                  {duplicates.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm"><PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="font-medium underline-offset-2 hover:underline">{o.ref} · {o.title}</PLink><StageChip stage={o.stage} /><span className="text-xs text-muted-foreground">Owner {personName(o.owner)} · {stageLabel(o.stage)}</span></li>
                  ))}
                </ul>
                <div className="mt-3"><Field label="Why is this a separate opportunity?" htmlFor="e-override" required error={errors.override} hint="This reason is kept in the history."><Textarea id="e-override" rows={2} value={override} onChange={(e) => setOverride(e.target.value)} /></Field></div>
              </section>
            ) : null}

            <Panel title="Add now if you know it">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Owning company" htmlFor="e-company"><Select id="e-company" value={f.company} onChange={set("company")}>{(Object.keys(COMPANIES) as CompanyId[]).map((c) => <option key={c} value={c}>{COMPANIES[c].name.replace(" (sample entity)", "")} · {COMPANIES[c].currency}</option>)}</Select></Field>
                <Field label="Installation date" htmlFor="e-event"><Input id="e-event" type="date" value={f.eventStart} onChange={set("eventStart")} /></Field>
                <Field label="Budget (as stated)" htmlFor="e-budget" hint="Free text, e.g. “about 150k”."><Input id="e-budget" value={f.budget} onChange={set("budget")} /></Field>
                <Field label="Event location" htmlFor="e-place"><Input id="e-place" value={f.place} onChange={set("place")} /></Field>
                <div className="sm:col-span-2"><Field label="Technologies requested" htmlFor="e-tech" hint="Separate with commas."><Input id="e-tech" value={f.techs} onChange={set("techs")} /></Field></div>
              </div>
            </Panel>
            <div className="flex gap-2">
              <Button type="submit">Record enquiry</Button>
              <PLink href="/os-preview/sales/opportunities" className={cn(buttonVariants({ variant: "ghost" }))}>Cancel</PLink>
            </div>
          </div>

          <aside aria-label="What happens next" className="space-y-4 lg:sticky lg:top-28 lg:self-start">
            <Panel title="What happens next">
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>You become the owner. Only a founder can reassign it.</li>
                <li>It starts as a new enquiry with its own reference.</li>
                <li>Your next action appears in your follow-ups.</li>
              </ul>
            </Panel>
          </aside>
        </form>
      </StateGate>
    </>
  );
}
