import Link from "next/link";
import { OsBadge } from "@/components/os/pills";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/components/sales/format";
import { outreachRowState } from "@/lib/crm/clients-agencies/outreach";
import type { OutreachListRow } from "@/lib/crm/clients-agencies/outreach-data";
import { cn } from "@/lib/utils";
import { LogActivityButton, NextActionButton } from "./outreach-forms";
import { lastContactText, OutreachStatusBadge } from "./outreach-view";

/** The people recorded at the account, in a few words: outreach holds no contact of its own, so these are the account's. */
export function contactsText(contacts: OutreachListRow["contacts"]): { text: string; missing: boolean; failed: boolean } {
  if (contacts === null) return { text: "Could not load", missing: false, failed: true };
  if (contacts.length === 0) return { text: "None recorded", missing: true, failed: false };
  const first = contacts[0]!;
  const more = contacts.length - 1;
  return { text: `${first.name}${first.role_title ? ` (${first.role_title})` : ""}${more > 0 ? ` and ${more} more` : ""}`, missing: false, failed: false };
}

/**
 * One outreach in the list: the account, who to speak to, whose it is, what happens next and by when, together, with where it stands in words
 * and colour (lib/crm/clients-agencies/outreach.ts `outreachRowState`) and the one action that moves it on. Everything else is on the account page,
 * which the account name opens at its Outreach section.
 */
export function OutreachRow({ o, today, ownerName, companyId }: { o: OutreachListRow; today: string; ownerName: string; companyId: string }) {
  const state = outreachRowState(o, today);
  const accountHref = `/sales/accounts/${o.organisation_id}?company=${companyId}#outreach`;
  const contact = contactsText(o.contacts);
  return (
    <li className={cn("os-card p-3 sm:p-4", state.overdue && "border-[hsl(var(--os-red)/0.55)]")} data-testid="outreach-row" data-state={state.overdue ? "overdue" : state.waiting ? "waiting" : state.tone}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={accountHref} title={o.accountName} className="min-w-0 break-words text-base font-semibold underline-offset-2 hover:underline">{o.accountName}</Link>
            <OutreachStatusBadge status={o.status} />
            {state.dueDate ? <OsBadge tone={state.tone} className="whitespace-nowrap">{state.label}</OsBadge> : null}
          </div>
          <dl className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
            <div className="min-w-0"><dt className="inline text-muted-foreground">Contact: </dt><dd className={cn("inline break-words", contact.missing && "text-muted-foreground", contact.failed && "text-destructive")}>{contact.text}</dd></div>
            <div className="min-w-0"><dt className="inline text-muted-foreground">Owner: </dt><dd className="inline break-words">{ownerName}</dd></div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="inline text-muted-foreground">Next action: </dt>
              <dd className="inline break-words">
                {state.dueDate === null ? (
                  o.status === "closed" ? <span className="text-muted-foreground">None: closed{o.closed_reason ? ` (${o.closed_reason})` : ""}</span> : <span className="text-muted-foreground">None: an enquiry was raised</span>
                ) : o.next_action ? (
                  <><span className="font-medium">{o.next_action}</span> <span className={cn(state.overdue && "font-medium text-[hsl(var(--os-red))]")}>· due {formatDate(state.dueDate)}</span></>
                ) : (
                  <><span className="font-medium text-[hsl(var(--os-amber))]">None set</span> <span className={cn(state.overdue && "font-medium text-[hsl(var(--os-red))]")}>· target date {formatDate(state.dueDate)}</span></>
                )}
              </dd>
            </div>
            <div className="min-w-0 sm:col-span-2 text-muted-foreground"><dt className="inline">Last contact: </dt><dd className="inline">{lastContactText(o)}</dd>{o.objective ? <><dt className="ml-3 inline">Objective: </dt><dd className="inline break-words">{o.objective}</dd></> : null}</div>
          </dl>
        </div>
        <div className="flex shrink-0 items-center">
          {state.action === "log" ? <LogActivityButton outreachId={o.id} accountName={o.accountName} />
            : state.action === "set_next" ? <NextActionButton outreachId={o.id} current={o.next_action} due={o.next_due} accountName={o.accountName} primary />
            : state.action === "open_enquiry" ? <Link href={`/sales/opportunities/${o.opportunity_id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open the enquiry<span className="sr-only"> raised from {o.accountName}</span></Link>
            : <Link href={accountHref} className={buttonVariants({ variant: "outline", size: "sm" })}>Open account<span className="sr-only"> {o.accountName}</span></Link>}
        </div>
      </div>
    </li>
  );
}
