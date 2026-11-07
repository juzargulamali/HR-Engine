import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadError } from "@/components/workspace/states";
import { formatDate } from "@/components/sales/format";
import { describeEvent } from "@/lib/crm/clients-agencies/outreach";
import type { AccountOutreach } from "@/lib/crm/clients-agencies/outreach-data";
import { InquiryLinkControls, LogActivityButton, NextActionButton, StatusControl } from "./outreach-forms";
import { OutreachFacts, OutreachStatusBadge } from "./outreach-view";

/**
 * The account page's "Outreach" section: this account's outreach for the selected company with its controls and its append-only history. A person who may not
 * read any (neither the assignee nor a Sales lead) gets nothing here: the database returns no rows to them, and the section stays out of their page.
 */
export function OutreachSection({ items, orgId, orgName, companyId, today, canAssign, nameOf, inquiries }: {
  items: AccountOutreach[] | "error"; orgId: string; orgName: string; companyId: string; today: string; canAssign: boolean;
  nameOf: (id: string | null) => string; inquiries: { id: string; label: string }[];
}) {
  if (items === "error") return <section id="outreach" aria-label="Outreach"><LoadError what="outreach for this account" /></section>;
  if (items.length === 0 && !canAssign) return null;
  const inquiryLabel = (id: string | null) => inquiries.find((i) => i.id === id)?.label ?? "an inquiry";
  return (
    <section id="outreach" aria-labelledby="acc-outreach" className="space-y-3">
      <h2 id="acc-outreach" className="text-lg font-semibold">Outreach</h2>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">No outreach on this account for this company. Select it in Clients &amp; Agencies and choose Assign outreach.</p> : null}
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
            {o.opportunity_id ? <p className="text-sm">Inquiry: <Link className="underline-offset-2 hover:underline" href={`/sales/opportunities/${o.opportunity_id}`}>{inquiryLabel(o.opportunity_id)}</Link></p> : null}
            {o.status !== "closed" ? (
              <div className="flex flex-wrap gap-2">
                <LogActivityButton outreachId={o.id} accountName={orgName} />
                <NextActionButton outreachId={o.id} current={o.next_action} due={o.next_due} />
                <StatusControl outreachId={o.id} status={o.status} />
                {o.status !== "inquiry_raised" ? <InquiryLinkControls outreachId={o.id} orgId={orgId} companyId={companyId} inquiries={inquiries} /> : null}
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
