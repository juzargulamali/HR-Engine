import Link from "next/link";
import { canActOnFollowUp } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { DueText, StageBadge } from "@/components/sales/badges";
import { formatDate } from "@/components/sales/format";
import { AddUpdateButton } from "@/components/sales/add-update-button";
import { CompleteFollowUpButton, NewFollowUpButton } from "@/components/sales/follow-up-dialogs";
import { LoadError } from "@/components/workspace/states";
import { SidePanel } from "@/components/workspace/side-panel";
import { parseRecordId } from "@/components/workspace/url-state";
import { getCrmContext } from "@/lib/crm/context";
import { loadOpportunityDetail, loadOrganisations } from "@/lib/crm/data";
import { crmStageLabel } from "@enginious-hr/domain";
import { ActivityPanel } from "../opportunities/[id]/activity-panel";
import { buildContactPicker, type ContactPickerData } from "../opportunities/[id]/contact-helpers";
import { CommercialPanel } from "../opportunities/[id]/commercial-panel";
import { DetailTabs, type DetailTab } from "../opportunities/[id]/detail-tabs";
import { FilesPanel } from "../opportunities/[id]/files-panel";
import { isOnlyOpenFollowUp } from "../opportunities/[id]/helpers";
import { ProposalsPanel } from "../opportunities/[id]/proposals-panel";
import { ScopePanel } from "../opportunities/[id]/scope-panel";
import { buildOppView, type OppView } from "../opportunities/[id]/view";
import { buildEnquiryActions } from "./actions-props";
import { EnquiryActions } from "./enquiry-actions";
import { PanelOverview } from "./panel-overview";

/**
 * One enquiry beside a list (Follow-ups and Enquiries open it with ?open=<id>). It loads exactly what the full page loads, through
 * the signed-in person's own session, so a record they cannot see is simply "not found", and shows it in a compact form. Everything
 * heavy (scope, commercial, proposals, files) is one tab away; the full page stays one click away too.
 */
export async function EnquirySidePanel({ openId, closeHref }: { openId: string; closeHref: string }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const id = parseRecordId(openId);
  const shell = (title: string, children: React.ReactNode, subtitle?: string, fullPageHref?: string) => (
    <SidePanel title={title} subtitle={subtitle} closeHref={closeHref} fullPageHref={fullPageHref}>{children}</SidePanel>
  );
  if (!id) return shell("Enquiry not found", <Alert role="status">That link does not point to an enquiry.</Alert>);
  let detail: Awaited<ReturnType<typeof loadOpportunityDetail>>;
  try {
    detail = await loadOpportunityDetail(ctx, id);
  } catch (e) {
    console.error("[crm] enquiry panel load failed", e);
    return shell("Enquiry", <LoadError what="this enquiry" retryHref={`/sales/opportunities?open=${id}`} />);
  }
  if (!detail) return shell("Enquiry not found", <Alert role="status">This enquiry does not exist, or you do not have access to it.</Alert>);

  const view = buildOppView(ctx, detail);
  const picker = view.canChangeContacts
    ? await (async () => {
        const all = await loadOrganisations();
        return buildContactPicker(all.organisations, detail.contacts.map((c) => c.contact.id), detail.item.agency?.id ?? detail.item.client?.id ?? null, all.unassignedContacts);
      })().catch(() => null)
    : null;
  const { opp } = view;
  return shell(
    opp.title,
    <EnquiryPanelBody view={view} picker={picker} />,
    `${opp.reference}${ctx.companies.length > 1 ? ` · ${detail.item.companyName}` : ""}`,
    `/sales/opportunities/${opp.id}`,
  );
}

function EnquiryPanelBody({ view, picker }: { view: OppView; picker: ContactPickerData | null }) {
  const { opp, detail, ctx, isHold, isWon, isLost, isActive, isOpen } = view;
  const next = view.nextFollowUp;
  const ref = { companyId: opp.company_id, ownerId: opp.owner_id };
  const canAct = next ? canActOnFollowUp(ctx.grants, { assignedTo: next.assigned_to }, ref, ctx.userId) : false;
  const onlyOpen = next ? isOnlyOpenFollowUp(detail.followUps, next.id, opp.stage) : false;
  const clientLine = detail.item.client && detail.item.agency ? `${detail.item.client.name} via ${detail.item.agency.name}` : (detail.item.client?.name ?? detail.item.agency?.name ?? "No client recorded");

  const tabs: DetailTab[] = [
    { id: "overview", label: "Overview", content: <PanelOverview view={view} picker={picker} /> },
    { id: "updates", label: "Updates", content: <ActivityPanel view={view} showForm={false} /> },
    { id: "proposals", label: "Proposals & files", content: <div className="space-y-6"><ProposalsPanel view={view} /><FilesPanel view={view} /></div> },
    { id: "details", label: "Scope & dates", content: <ScopePanel view={view} compact /> },
    { id: "commercial", label: "Commercial", content: <CommercialPanel view={view} compact /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <StageBadge stage={opp.stage} />
        <span><span className="text-muted-foreground">Owner </span><span className="font-medium">{view.ownerName}</span></span>
        <span className="min-w-0 break-words text-muted-foreground">{clientLine}</span>
      </div>

      {isHold ? <Alert variant="warning" role="status">On hold: {opp.hold_reason}. Review on {formatDate(opp.hold_review_date)}. It returns to {opp.stage_before_hold ? crmStageLabel(opp.stage_before_hold) : "its earlier stage"} when resumed (More actions, Resume).</Alert> : null}
      {isWon ? <Alert variant="success" role="status">Won on {formatDate(opp.closed_at)}. <Link href={`/sales/opportunities/${opp.id}/handover`} className="font-medium underline">Open the handover package</Link>.</Alert> : null}
      {isLost ? <Alert role="status">Lost on {formatDate(opp.closed_at)}: {opp.lost_reason}. It is read-only until reopened.</Alert> : null}
      {isOpen && !view.canEdit ? <Alert role="status">Only the owner ({view.ownerName}) or a founder can move, edit or close this. You can add updates, files and follow-ups.</Alert> : null}

      <section aria-label="Next action" className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Next action</h3>
        {next ? (
          <>
            <p className="mt-1 break-words text-base font-semibold">{next.title}</p>
            <p className="mt-0.5 text-sm"><DueText dueAt={next.due_at} /> <span className="text-muted-foreground">· {ctx.personName(next.assigned_to)}</span></p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canAct ? <CompleteFollowUpButton label="Complete follow-up" followUp={{ id: next.id, title: next.title, opportunityId: opp.id, isOnlyOpen: onlyOpen }} /> : <p className="text-sm text-muted-foreground">Only the assignee, the owner or a founder can complete it.</p>}
              {isOpen ? <NewFollowUpButton label="Schedule next action" opportunityId={opp.id} people={view.people} canAssign={view.canEdit || view.canAssign} currentUserId={ctx.userId} /> : null}
            </div>
          </>
        ) : isActive ? (
          <>
            <p className="mt-1 text-sm font-medium text-amber-800 dark:text-amber-300">No next action is scheduled. Every active enquiry needs one, so it is not forgotten.</p>
            <div className="mt-3"><NewFollowUpButton label="Schedule next action" opportunityId={opp.id} people={view.people} canAssign={view.canEdit || view.canAssign} currentUserId={ctx.userId} /></div>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{isHold ? "None while it is on hold. Resuming asks for one." : "Closed: no further follow-ups."}</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Enquiry actions">
        {!isLost ? <AddUpdateButton opportunityId={opp.id} /> : null}
        <EnquiryActions {...buildEnquiryActions(view)} />
      </div>

      <DetailTabs tabs={tabs} initial="overview" />
    </div>
  );
}
