import { OsBadge, type OsTone } from "@/components/os/pills";
import { formatDate } from "@/components/sales/format";
import { dueOn, isOverdue, OUTREACH_KIND_LABEL, OUTREACH_OUTCOME_LABEL, OUTREACH_STATUS_LABEL } from "@/lib/crm/clients-agencies/outreach";
import type { CrmOutreachRow, CrmOutreachStatus } from "@/types/crm";

const TONE: Record<CrmOutreachStatus, OsTone> = { not_started: "neutral", in_progress: "blue", waiting_for_reply: "amber", meeting_booked: "cyan", inquiry_raised: "green", closed: "quiet" };

export const OutreachStatusBadge = ({ status }: { status: CrmOutreachStatus }) => <OsBadge tone={TONE[status]} dot className="whitespace-nowrap">{OUTREACH_STATUS_LABEL[status]}</OsBadge>;

export const lastContactText = (o: CrmOutreachRow): string =>
  o.last_contact_on ? `${formatDate(o.last_contact_on)} · ${OUTREACH_KIND_LABEL[o.last_contact_kind ?? "call"]}${o.last_outcome ? ` · ${OUTREACH_OUTCOME_LABEL[o.last_outcome]}` : ""}` : "No contact logged yet";

/** The facts a lead or salesperson needs without opening the account: objective, target, last contact and latest outcome, next action and due date, overdue marker. */
export function OutreachFacts({ o, today }: { o: CrmOutreachRow; today: string }) {
  const overdue = isOverdue(o, today);
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2"><dt className="inline text-muted-foreground">Objective: </dt><dd className="inline">{o.objective ?? "None recorded"}</dd></div>
      <div><dt className="inline text-muted-foreground">Target date: </dt><dd className="inline">{formatDate(o.target_date)}</dd></div>
      <div><dt className="inline text-muted-foreground">Last contact: </dt><dd className="inline">{lastContactText(o)}</dd></div>
      <div className="sm:col-span-2">
        <dt className="inline text-muted-foreground">Next action: </dt>
        <dd className="inline">
          {o.next_action ? `${o.next_action} · due ${formatDate(o.next_due)}` : `None set (target date ${formatDate(dueOn(o))})`}
          {overdue ? <OsBadge tone="red" className="ml-2 whitespace-nowrap">Overdue</OsBadge> : null}
        </dd>
      </div>
      {o.status === "closed" && o.closed_reason ? <div className="sm:col-span-2"><dt className="inline text-muted-foreground">Closed because: </dt><dd className="inline">{o.closed_reason}</dd></div> : null}
    </dl>
  );
}
