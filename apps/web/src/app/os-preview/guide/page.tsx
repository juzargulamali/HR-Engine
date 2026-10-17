"use client";

import { MODULES, ROLES, ROLE_IDS } from "../_lib/modules";
import { SAMPLE_NOW_LABEL } from "../_lib/data";
import { PLink, usePreview } from "../_components/context";
import { Chip, PageHeader, Panel } from "../_components/ui";

const GLOSSARY: { term: string; meaning: string }[] = [
  { term: "Commercially won", meaning: "A purchase order or an authorised email is on record. Nothing else counts." },
  { term: "Equipment availability confirmed", meaning: "Someone checked the technology is free for the dates and quantities listed. It is not a stock reservation and it is not commercial confirmation. If the dates, technologies or quantities change, the check needs repeating." },
  { term: "Due / Overdue", meaning: "One deadline per action, in Dubai time. Overdue means past that time. When it was created or completed is in the details." },
  { term: "Multiple project assignments", meaning: "Office and workshop staff can work on several projects in a day. This is normal and never a warning. Only confirmed site bookings block overlapping time." },
  { term: "No allocation recorded", meaning: "Nothing is recorded for that day. It does not mean idle or absent." },
  { term: "Approval requirements not configured", meaning: "Nobody has decided yet whether approval is needed. It does not mean no approval is needed. Recording that something was sent is not an approval." },
  { term: "Actual incurred cost", meaning: "A cost that has happened, whether or not it is paid. An advance is cash issued, not a cost. A receipt, a card transaction and an accounting entry can describe one expense; it counts once." },
  { term: "Customer collections", meaning: "Money received from the customer. Invoiced is what we billed. Supplier payments are money we paid out." },
];

export default function Guide() {
  const { href } = usePreview();
  return (
    <>
      <PageHeader eyebrow="Design preview" title="Preview guide" description="How to look around, and what the words mean." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="This preview">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Everything is fictional sample data. Nothing is saved, sent or connected to a live record.</li>
            <li>People &amp; HR is the existing app and is not redrawn. Modules marked “Soon” are sample layouts.</li>
            <li>Phone numbers and emails are made up. Copy, Call and Email only act on your own device when you press them.</li>
          </ul>
        </Panel>
        <Panel title="Sample time">
          <p className="text-sm font-semibold">{SAMPLE_NOW_LABEL}</p>
          <p className="mt-1 text-sm text-muted-foreground">Every date, count, greeting and “overdue” label uses this one fixed time, never your device&apos;s clock. All deadlines are shown in Dubai time (UTC+4).</p>
        </Panel>
        <Panel title="Preview as" description="Changes what you see. It does not sign you in as anyone." className="lg:col-span-2" flush>
          <ul className="divide-y divide-border/70">
            {ROLE_IDS.map((r) => (
              <li key={r} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><div className="min-w-[12rem] flex-1"><p className="font-semibold">{ROLES[r].label}</p><p className="text-muted-foreground">{ROLES[r].personLabel} · {ROLES[r].description}</p></div><PLink href={`/os-preview/my-day?role=${r}`} className="font-medium text-[hsl(var(--os-link))] hover:underline">Open this view</PLink></li>
            ))}
          </ul>
        </Panel>
        <Panel title="Modules" flush className="lg:col-span-2">
          <ul className="divide-y divide-border/70">
            {MODULES.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"><div className="min-w-[12rem] flex-1"><p className="font-medium">{m.label}</p><p className="text-muted-foreground">{m.blurb}</p></div><Chip tone={m.status === "existing" ? "good" : m.status === "coming" ? "neutral" : "info"}>{m.status === "existing" ? "Existing app" : m.status === "coming" ? "Coming soon" : "Designed here"}</Chip></li>
            ))}
          </ul>
        </Panel>
        <Panel title="Try this" className="lg:col-span-2">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Opportunities: sort by installation date, or choose “Installation soon, not fully confirmed”.</li>
            <li>New enquiry: type “Northwind” in the agency field to see the duplicate warning.</li>
            <li>An opportunity: press Complete follow-up, then change the dates on Scope &amp; Dates to see the equipment check need repeating.</li>
            <li>Show a state on any Sales page from the <PLink href="/os-preview/states" className="text-[hsl(var(--os-link))] underline underline-offset-2">states page</PLink>.</li>
          </ul>
        </Panel>
        <Panel title="Words used" className="lg:col-span-2">
          <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {GLOSSARY.map((g) => <div key={g.term}><dt className="text-sm font-semibold">{g.term}</dt><dd className="mt-0.5 text-sm text-muted-foreground">{g.meaning}</dd></div>)}
          </dl>
        </Panel>
      </div>
      <p className="mt-4 text-xs text-muted-foreground"><a href={href("/os-preview/my-day")} className="hover:underline">Back to My Day</a></p>
    </>
  );
}
