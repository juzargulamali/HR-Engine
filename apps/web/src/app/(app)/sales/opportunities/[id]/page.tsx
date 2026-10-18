import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { crmAllowedMoves, crmStageLabel } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { DueText, StageBadge } from "@/components/sales/badges";
import { formatDate, formatMoney, todayInDubai } from "@/components/sales/format";
import { NewFollowUpButton } from "@/components/sales/follow-up-dialogs";
import { getCrmContext } from "@/lib/crm/context";
import { loadOpportunityDetail, loadOrganisations } from "@/lib/crm/data";
import { cn } from "@/lib/utils";
import { ActivityPanel } from "./activity-panel";
import { AssignOwnerButton } from "./assign-owner";
import { HANDOVER_REOPENED_NOTICE, REOPEN_NOT_ALLOWED_NOTE } from "./closure-helpers";
import { buildContactPicker } from "./contact-helpers";
import { CommercialPanel } from "./commercial-panel";
import { DetailTabs, type DetailTab } from "./detail-tabs";
import { EditDetailsButton } from "./edit-details";
import { FilesPanel } from "./files-panel";
import { stageMoveRequirement } from "./helpers";
import { OverviewPanel } from "./overview-panel";
import { ProposalsPanel } from "./proposals-panel";
import { ReopenButton } from "./reopen-dialog";
import { ScopePanel, toEditable } from "./scope-panel";
import { HoldButton, MoveStageButton, ResumeButton } from "./stage-actions";
import { buildOppView } from "./view";

export const metadata = { title: "Opportunity" };

const EVIDENCE = { purchase_order: "purchase order", authorised_email: "authorised email" } as const;
const LINK_OUTLINE = cn(buttonVariants({ variant: "outline", size: "sm" }));

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const detail = await loadOpportunityDetail(ctx, id);
  if (!detail) notFound();

  const view = buildOppView(ctx, detail);
  const { item } = detail;
  const { opp, canEdit, isActive, isHold, isWon, isLost, isOpen } = view;
  const next = view.nextFollowUp;
  const hasSentProposal = detail.proposals.some((p) => p.status === "sent" || p.status === "accepted");
  const hasQuoteRef = !!detail.zoho?.quote_ref?.trim();
  const moveOptions = crmAllowedMoves(opp.stage).map((to) => ({ id: to, label: crmStageLabel(to), requirement: stageMoveRequirement(to, { hasSentProposal, hasQuoteRef }) }));
  const holdReviewPassed = !!opp.hold_review_date && opp.hold_review_date < todayInDubai();
  const partyLabel = item.client ? "Client" : item.agency ? "Agency" : "Client";
  const clientLine = item.client && item.agency ? `${item.client.name} via ${item.agency.name}` : (item.client?.name ?? item.agency?.name ?? "No client recorded");

  // Everyone who could be added as a contact is loaded only for people who may change contacts (saves the query for everyone else).
  const picker = view.canChangeContacts
    ? await (async () => {
        const all = await loadOrganisations();
        return buildContactPicker(all.organisations, detail.contacts.map((c) => c.contact.id), item.agency?.id ?? item.client?.id ?? null, all.unassignedContacts);
      })()
    : null;
  const handoverKeptAfterReopen = !!detail.handover && opp.stage !== "won";
  const reopenNote = !view.canReopen ? REOPEN_NOT_ALLOWED_NOTE : null;

  const tabs: DetailTab[] = [
    { id: "overview", label: "Overview", content: <OverviewPanel view={view} picker={picker} /> },
    { id: "scope", label: "Scope & dates", content: <ScopePanel view={view} /> },
    { id: "activity", label: "Activity & history", content: <ActivityPanel view={view} /> },
    { id: "proposals", label: "Proposals & files", content: <div className="space-y-6"><ProposalsPanel view={view} /><FilesPanel view={view} /></div> },
    { id: "commercial", label: "Commercial", content: <CommercialPanel view={view} /> },
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link href="/sales/opportunities" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Opportunities
        </Link>
        <div>
          <p className="text-sm text-muted-foreground">{opp.reference} · {item.companyName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-2xl font-semibold">{opp.title}</h1>
            <StageBadge stage={opp.stage} />
          </div>
          <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">{partyLabel}</dt><dd className="break-words">{clientLine}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Owner</dt><dd className="break-words font-medium">{view.ownerName}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Value</dt><dd className="font-medium">{formatMoney(item.value, opp.currency)}</dd></div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Next action</dt>
              <dd className="break-words">
                {next ? <>{next.title} <span className="block text-xs"><DueText dueAt={next.due_at} /></span></> : <span className="text-muted-foreground">{isOpen ? (isHold ? "None (on hold)" : "None scheduled") : "Closed"}</span>}
              </dd>
            </div>
          </dl>
        </div>

        {isHold ? (
          <Alert variant="warning" role="status">
            <p><strong>On hold.</strong> Reason: {opp.hold_reason}. Review date {formatDate(opp.hold_review_date)}{holdReviewPassed ? " (the date has passed: decide whether to resume or close it)" : ""}. It returns to {opp.stage_before_hold ? crmStageLabel(opp.stage_before_hold) : "its earlier stage"} when resumed.</p>
            {canEdit ? <div className="mt-2"><ResumeButton opportunityId={opp.id} version={opp.version} returnsTo={opp.stage_before_hold} /></div> : null}
          </Alert>
        ) : null}
        {isWon ? (
          <Alert variant="success" role="status">
            <p><strong>Won</strong> on {formatDate(opp.closed_at)}{opp.evidence_type ? `, confirmed by ${EVIDENCE[opp.evidence_type]} ${opp.evidence_reference ?? ""} dated ${formatDate(opp.evidence_date)}` : ""}.</p>
            <p className="mt-1"><Link href={`/sales/opportunities/${opp.id}/handover`} className="font-medium underline">Open the handover package</Link></p>
            {reopenNote ? <p className="mt-1 text-xs">{reopenNote}</p> : <p className="mt-1 text-xs">If it was recorded by mistake or has changed, use Reopen. The win stays in the history.</p>}
          </Alert>
        ) : null}
        {isLost ? (
          <Alert role="status">
            <p><strong>Lost</strong> on {formatDate(opp.closed_at)}. Reason: {opp.lost_reason}. A lost opportunity is read-only, including its contacts, until it is reopened.</p>
            {reopenNote ? <p className="mt-1 text-xs">{reopenNote}</p> : <p className="mt-1 text-xs">Use Reopen if it was recorded by mistake or the client is back. The loss stays in the history.</p>}
          </Alert>
        ) : null}
        {handoverKeptAfterReopen ? (
          <Alert variant="warning" role="status">
            <p>{HANDOVER_REOPENED_NOTICE}</p>
            <p className="mt-1"><Link href={`/sales/opportunities/${opp.id}/handover`} className="font-medium underline">See the handover record as it was</Link></p>
          </Alert>
        ) : null}
        {isActive && !next ? (
          <Alert variant="warning">
            <p><strong>No next action is scheduled.</strong> Every active opportunity needs one, so it is not forgotten.</p>
            <div className="mt-2"><NewFollowUpButton opportunityId={opp.id} people={view.people} canAssign={canEdit || view.canAssign} currentUserId={ctx.userId} /></div>
          </Alert>
        ) : null}
        {isOpen && !canEdit ? <Alert role="status">Only the owner ({view.ownerName}) or a founder can change the stage, edit the details or close this opportunity. You can add notes, files and follow-ups.</Alert> : null}

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Opportunity actions">
          {canEdit && isActive ? (
            <>
              <MoveStageButton opportunityId={opp.id} version={opp.version} stage={opp.stage} options={moveOptions} />
              <HoldButton opportunityId={opp.id} version={opp.version} />
            </>
          ) : null}
          {canEdit && isOpen ? (
            <>
              {isActive ? <Link href={`/sales/opportunities/${opp.id}/close?outcome=won`} className={LINK_OUTLINE}>Close as won</Link> : null}
              <Link href={`/sales/opportunities/${opp.id}/close?outcome=lost`} className={LINK_OUTLINE}>Close as lost</Link>
            </>
          ) : null}
          {view.editMode ? <EditDetailsButton data={toEditable(view)} mode={view.editMode} availabilityWillNeedRecheck={item.availability === "confirmed" || item.availability === "unavailable"} /> : null}
          {view.canAssign && isOpen ? <AssignOwnerButton opportunityId={opp.id} currentOwnerId={opp.owner_id} currentOwnerName={view.ownerName} people={view.people} /> : null}
          {view.canReopen ? <ReopenButton opportunityId={opp.id} version={opp.version} outcome={isWon ? "won" : "lost"} stageBeforeClose={opp.stage_before_close} hasHandover={!!detail.handover} /> : null}
          {isWon ? <Link href={`/sales/opportunities/${opp.id}/handover`} className={LINK_OUTLINE}>Handover package</Link> : null}
        </div>
      </header>

      <DetailTabs tabs={tabs} initial={tab ?? "overview"} />
    </div>
  );
}
