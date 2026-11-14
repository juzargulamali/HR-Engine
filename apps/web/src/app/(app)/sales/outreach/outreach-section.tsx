import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadError } from "@/components/workspace/states";
import { formatDate } from "@/components/sales/format";
import { describeEvent } from "@/lib/crm/clients-agencies/outreach";
import { latestOutreachNote, outreachEnquiryHref } from "@/lib/crm/clients-agencies/outreach-enquiry";
import type { AccountOutreach } from "@/lib/crm/clients-agencies/outreach-data";
import { InquiryLinkControls, LogActivityButton, NextActionButton, StatusControl } from "./outreach-forms";
import { OutreachFacts, OutreachStatusBadge } from "./outreach-view";

/**
 * The account page's "Outreach" section: this account's outreach for the selected company with its controls and its append-only history. A person who may not
 * read any (neither the assignee nor a Sales lead) gets nothing here: the database returns no rows to them, and the section stays out of their page.
 */
export function OutreachSection({ items, orgId, orgName, companyId, today, canAssign, nameOf, inquiries, onlyContactId = null }: {
  items: AccountOutreach[] | "error"; orgId: string; orgName: string; companyId: string; today: string; canAssign: boolean;
  nameOf: (id: string | null) => string; inquiries: { id: string; label: string }[];
  /** The account's one recorded contact, when it has exactly one: carried into a new enquiry. Outreach itself holds no contact. */
  onlyContactId?: string | null;
}) {
  if (items === "error") return <section id="outreach" aria-label="Outreach"><LoadError what="outreach for this account" /></section>;
  if (items.length === 0 && !canAssign) return null;
  const inquiryLabel = (id: string | null) => inquiries.find((i) => i.id === id)?.label ?? "an inquiry";
  return (
    <section id="outreach" aria-labelledby="acc-outreach" className="space-y-3">
      <h2 id="acc-outreach" className="text-lg font-semibold">Outreach</h2>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">No outreach on this account for this company. <Link href={`/sales/accounts?company=${companyId}&q=${encodeURIComponent(orgName)}`} className="underline underline-offset-2">Select it in Clients &amp; Agencies</Link> and choose Assign outreach.</p> : null}
      {items.map(({ outreach: o, events }) => (
        <Card key={o.id} data-outreach={o.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Assigned to {nameOf(o.assigned_to)} <span className="font-normal text-muted-foreground">· by {nameOf(o.assigned_by)}, {formatDate(o.assigned_at)}</span></CardTitle>
              <OutreachStatusBadge status={o.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <OutreachFacts o={o} today={today} />
            {/* One outreach raises one enquiry: once it is linked (opportunity_id, set by crm_outreach_link_inquiry) the create button is replaced by the way to it. */}
            {o.opportunity_id ? <p className="text-sm" data-testid="outreach-enquiry-linked"><span className="font-medium">Enquiry already created:</span> <Link className="underline underline-offset-2" href={`/sales/opportunities/${o.opportunity_id}`}>open {inquiryLabel(o.opportunity_id)}</Link></p> : null}
            {o.status !== "closed" ? (
              <div className="flex flex-wrap gap-2">
                <LogActivityButton outreachId={o.id} accountName={orgName} />
                <NextActionButton outreachId={o.id} current={o.next_action} due={o.next_due} />
                <StatusControl outreachId={o.id} status={o.status} />
                {o.status !== "inquiry_raised" && !o.opportunity_id ? (
                  <InquiryLinkControls
                    outreachId={o.id} inquiries={inquiries}
                    createHref={outreachEnquiryHref({ companyId, orgId, orgName, outreachId: o.id, objective: o.objective, contactId: onlyContactId, latestNote: latestOutreachNote(events) })}
                  />
                ) : null}
              </div>
            ) : null}
            <div>
              <h3 className="text-sm font-medium">History</h3>
              <ol className="mt-1 divide-y divide-border text-sm" aria-label="Outreach history, newest first">
                {[...events].reverse().map((e) => (
                  <li key={e.id} className="grid gap-0.5 py-1.5 sm:grid-cols-[8rem_minmax(0,1fr)]">
                    <span className="text-muted-foreground">{formatDate(e.occurred_on)}</span>
                    <span className="min-w-0 break-words">{describeEvent(e, (id) => (id ? nameOf(id) : "someone"), inquiryLabel)} <span className="text-muted-foreground">· {nameOf(e.created_by)}</span></span>
                  </li>
                ))}
              </ol>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
