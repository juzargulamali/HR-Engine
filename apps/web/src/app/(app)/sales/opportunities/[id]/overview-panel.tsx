import { crmSourceLabel, isCommerciallyWon } from "@enginious-hr/domain";
import { Suspense } from "react";
import { EventFact } from "./event-fact";
import { TabLink } from "./detail-tabs";
import { ApprovalBadge, AvailabilityBadge } from "@/components/sales/badges";
import { formatDate, formatDateTime } from "@/components/sales/format";
import { Badge } from "@/components/ui/badge";
import type { ContactPickerData } from "./contact-helpers";
import { ContactsPanel } from "./contacts-panel";
import { FollowUpsPanel } from "./follow-ups-panel";
import { dateRangeText } from "./helpers";
import { LatestActivity } from "./latest-activity";
import { OpsPlanningSection } from "./ops-planning-panel";
import { OutreachOrigin } from "./outreach-origin";
import { Fact, Muted, Panel, SubHeading } from "./parts";
import { LoadError } from "@/components/workspace/states";
import { anyFailed, type OppView } from "./view";

const EVIDENCE = { purchase_order: "Purchase order", authorised_email: "Authorised email" } as const;
const NOT_CONFIRMED = <span className="text-muted-foreground">Not confirmed</span>;

/**
 * The first tab, in the order the work is done: the next actions (complete, reschedule, log an activity), who is involved (agency and end client are separate
 * relationships), the contacts and the brief; beside them the event, the key dates and where the commercial side stands. Stage, owner, value and the main
 * next action are in the summary above the tabs and are not repeated here.
 */
/** `picker` (everyone who could be added as a contact) is supplied only to people who may change contacts. */
export function OverviewPanel({ view, picker = null }: { view: OppView; picker?: ContactPickerData | null }) {
  const { opp, detail, ctx, policy } = view;
  const { item } = detail;
  const won = isCommerciallyWon({ stage: opp.stage, evidenceReference: opp.evidence_reference });
  const commercial = `/sales/opportunities/${opp.id}?tab=commercial`;
  const scope = `/sales/opportunities/${opp.id}?tab=scope`;
  const show = dateRangeText(opp.event_start, opp.event_end, formatDate);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <FollowUpsPanel view={view} withLog />
        <Panel title="Who is involved" hint="The agency and the end client are separate relationships: an agency can bring several end clients, and a client can come directly.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <SubHeading>Agency</SubHeading>
              <p className="mt-1 break-words text-sm font-medium">{item.agency ? item.agency.name : "No agency (direct client)"}</p>
              {item.agency?.place ? <p className="break-words text-sm text-muted-foreground">{item.agency.place}</p> : null}
            </div>
            <div className="min-w-0">
              <SubHeading>End client</SubHeading>
              <p className="mt-1 break-words text-sm font-medium">{item.client ? item.client.name : "Not recorded"}</p>
              {item.client?.place ? <p className="break-words text-sm text-muted-foreground">{item.client.place}</p> : null}
            </div>
          </div>
          <div className="mt-5"><SubHeading>Contacts</SubHeading><div className="mt-2">{anyFailed(view, "contacts") ? <LoadError what="the contacts" retryHref={`/sales/opportunities/${opp.id}`} note="Contacts cannot be added or changed until they load." /> : <ContactsPanel contacts={detail.contacts} manage={{ view, picker }} />}</div></div>
        </Panel>
        <Panel title="Brief">
          {opp.brief ? <p className="whitespace-pre-wrap break-words text-sm">{opp.brief}</p> : <Muted>No brief recorded.</Muted>}
        </Panel>
        {/* What Sales tells Operations about this enquiry, and what Operations recorded back. Its own read, so it never holds up the rest of the tab. */}
        <Suspense fallback={<Panel title="Operations planning"><Muted>Loading the Operations planning details…</Muted></Panel>}>
          <OpsPlanningSection view={view} />
        </Suspense>
      </div>
      <div className="space-y-6">
        <Panel title="Event and key dates" actions={<TabLink tab="scope" href={scope} className="text-sm font-medium underline underline-offset-2">Scope &amp; dates</TabLink>}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Event / Exhibition" className="col-span-2"><Suspense fallback="…"><EventFact editionId={opp.event_edition_id} /></Suspense></Fact>
            <Fact label="Installation starts">{opp.install_start ? formatDate(opp.install_start) : NOT_CONFIRMED}</Fact>
            <Fact label="Show">{show ?? NOT_CONFIRMED}</Fact>
            <Fact label="Location" className="col-span-2">{opp.location ?? <span className="text-muted-foreground">Not recorded</span>}</Fact>
            <Fact label="Budget as stated">{opp.budget_note ?? "Not known"}</Fact>
            <Fact label="Source">{crmSourceLabel(opp.source)}</Fact>
            <Fact label="Created">{formatDate(opp.created_at)} by {ctx.personName(opp.created_by)}</Fact>
            <Fact label="First response" hint="The first call, email or meeting logged on this enquiry. A note or a client response does not set it.">{opp.first_response_at ? formatDateTime(opp.first_response_at) : "None recorded yet"}</Fact>
            <Suspense fallback={null}><OutreachOrigin opportunityId={opp.id} companyId={opp.company_id} /></Suspense>
          </dl>
        </Panel>
        <Panel title="Commercial status" hint="Three separate facts, each with its own state and action on the Commercial tab. Winning needs a purchase order or an authorised email: a proposal being sent or accepted is not a win, and nor is an equipment check. A check is a dated answer, not a stock reservation, and winning an enquiry reserves nothing."
          actions={<TabLink tab="commercial" href={commercial} className="text-sm font-medium underline underline-offset-2">Commercial</TabLink>}>
          <dl className="space-y-3">
            <Fact label="Commercial confirmation">
              {won ? (
                <>
                  <Badge variant="success">Commercially won</Badge>
                  <span className="mt-1 block text-sm text-muted-foreground">{opp.evidence_type ? EVIDENCE[opp.evidence_type] : "Evidence"} {opp.evidence_reference}, dated {formatDate(opp.evidence_date)}</span>
                </>
              ) : opp.stage === "lost" ? <Badge variant="secondary">Lost</Badge> : <Badge variant="outline">Not won yet</Badge>}
            </Fact>
            <Fact label="Equipment availability">
              <AvailabilityBadge state={item.availability} />
              {/* When it was checked and the window it covered, as recorded. A change to the dates, quantities or equipment makes it stale: that stays visible. */}
              {(opp.availability_state === "confirmed" || opp.availability_state === "unavailable") && opp.availability_at ? (
                <span className="mt-1 block text-sm text-muted-foreground">Checked {formatDate(opp.availability_at)} by {ctx.personName(opp.availability_by)}.</span>
              ) : null}
              {item.availability === "needs_recheck" ? <span className="mt-1 block text-sm font-medium text-[hsl(var(--os-amber))]">The dates, quantities or equipment changed after that check. <TabLink tab="commercial" href={commercial} className="underline underline-offset-2">Recheck availability</TabLink></span> : null}
            </Fact>
            <Fact label="Commercial approval">
              {anyFailed(view, "approvals") ? <span className="text-sm text-destructive">Could not load the approval history.</span> : <ApprovalBadge policy={policy} latest={detail.approvals[0] ? { state: detail.approvals[0].state } : null} />}
            </Fact>
          </dl>
        </Panel>
        <LatestActivity view={view} />
      </div>
    </div>
  );
}
