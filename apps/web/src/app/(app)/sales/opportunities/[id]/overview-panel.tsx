import { crmSourceLabel, isCommerciallyWon } from "@enginious-hr/domain";
import { ApprovalBadge, AvailabilityBadge, DueText } from "@/components/sales/badges";
import { formatDate, formatDateTime, formatMoney } from "@/components/sales/format";
import { Badge } from "@/components/ui/badge";
import { ContactsPanel } from "./contacts-panel";
import { FollowUpsPanel } from "./follow-ups-panel";
import { Fact, Muted, Panel, SubHeading } from "./parts";
import type { OppView } from "./view";

const EVIDENCE = { purchase_order: "Purchase order", authorised_email: "Authorised email" } as const;

/** The first tab: what this is, who is involved, what happens next and where it stands. */
export function OverviewPanel({ view }: { view: OppView }) {
  const { opp, detail, ctx, policy } = view;
  const { item } = detail;
  const won = isCommerciallyWon({ stage: opp.stage, evidenceReference: opp.evidence_reference });
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel title="Brief">
          {opp.brief ? <p className="whitespace-pre-wrap break-words text-sm">{opp.brief}</p> : <Muted>No brief recorded.</Muted>}
        </Panel>
        <Panel title="Who is involved" description="The agency and the end client are separate relationships.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <SubHeading>Agency</SubHeading>
              <p className="mt-1 break-words text-sm font-medium">{item.agency ? item.agency.name : "No agency (direct client)"}</p>
              {item.agency?.place ? <p className="break-words text-xs text-muted-foreground">{item.agency.place}</p> : null}
            </div>
            <div className="min-w-0">
              <SubHeading>End client</SubHeading>
              <p className="mt-1 break-words text-sm font-medium">{item.client ? item.client.name : "Not recorded"}</p>
              {item.client?.place ? <p className="break-words text-xs text-muted-foreground">{item.client.place}</p> : null}
            </div>
          </div>
          <div className="mt-5"><SubHeading>Contacts</SubHeading><div className="mt-2"><ContactsPanel contacts={detail.contacts} /></div></div>
        </Panel>
        <FollowUpsPanel view={view} />
      </div>
      <div className="space-y-6">
        <Panel title="Where it stands">
          <dl className="space-y-4">
            <Fact label="Commercial confirmation">
              {won ? (
                <>
                  <Badge variant="success">Commercially won</Badge>
                  <span className="mt-1 block text-xs text-muted-foreground">{opp.evidence_type ? EVIDENCE[opp.evidence_type] : "Evidence"} {opp.evidence_reference}, dated {formatDate(opp.evidence_date)}</span>
                </>
              ) : opp.stage === "lost" ? (
                <Badge variant="secondary">Lost</Badge>
              ) : (
                <>
                  <Badge variant="outline">Not won yet</Badge>
                  <span className="mt-1 block text-xs text-muted-foreground">Winning needs a purchase order or an authorised email. A proposal being sent or accepted is not a win, and nor is an equipment check.</span>
                </>
              )}
            </Fact>
            <Fact label="Equipment availability"><AvailabilityBadge state={item.availability} /></Fact>
            <Fact label="Commercial approval">
              <ApprovalBadge policy={policy} latest={detail.approvals[0] ? { state: detail.approvals[0].state } : null} />
            </Fact>
          </dl>
        </Panel>
        <Panel title="Key facts">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Value">{formatMoney(item.value, opp.currency)}</Fact>
            <Fact label="Budget as stated">{opp.budget_note ?? "Not known"}</Fact>
            <Fact label="Source">{crmSourceLabel(opp.source)}</Fact>
            <Fact label="Owner">{view.ownerName}</Fact>
            <Fact label="Created">{formatDate(opp.created_at)} by {ctx.personName(opp.created_by)}</Fact>
            <Fact label="First response">{opp.first_response_at ? formatDateTime(opp.first_response_at) : "None recorded yet"}</Fact>
            <Fact label="In this stage since">{formatDate(opp.stage_changed_at)}</Fact>
            {item.nextFollowUp ? <Fact label="Next action">{item.nextFollowUp.title}<br /><DueText dueAt={item.nextFollowUp.due_at} className="text-xs" /></Fact> : null}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
