import Link from "next/link";
import { CalendarClock, CircleAlert, TriangleAlert } from "lucide-react";
import { crmStageLabel } from "@enginious-hr/domain";
import { DueText, StageBadge } from "@/components/sales/badges";
import { formatDate, formatMoney, todayInDubai } from "@/components/sales/format";
import { OsBadge } from "@/components/os/pills";
import { InfoHint } from "@/components/ui/info-hint";
import { loadEstimateMarks } from "@/lib/crm/data";
import { handoverGuide, nextAction, stageGuide, type GuideFacts, type GuideLink, type GuideTone, type HandoverRead } from "@/lib/crm/enquiry-guide";
import { loadHandoverRead } from "@/lib/crm/handover-attention-data";
import { cn } from "@/lib/utils";
import { REOPEN_NOT_ALLOWED_NOTE } from "./closure-helpers";
import { TabLink } from "./detail-tabs";
import { primaryAction, summaryBlockers } from "./primary-action";
import { SummaryActions } from "./summary-actions";
import { buildSummaryActions, canActOnNext, stageMoves } from "./summary-props";
import { anyFailed, type OppView } from "./view";

const EDGE: Record<GuideTone, string> = {
  red: "border-l-[hsl(var(--os-red))]", amber: "border-l-[hsl(var(--os-amber))]", blue: "border-l-[hsl(var(--os-info))]", green: "border-l-[hsl(var(--os-green))]", neutral: "border-l-border",
};
const BADGE: Record<GuideTone, "red" | "amber" | "blue" | "green" | "quiet"> = { red: "red", amber: "amber", blue: "blue", green: "green", neutral: "quiet" };
const BLOCKER_TEXT = { red: "text-[hsl(var(--os-red))]", amber: "text-[hsl(var(--os-amber))]", neutral: "text-muted-foreground" } as const;
const EVIDENCE = { purchase_order: "purchase order", authorised_email: "authorised email" } as const;
const label = "text-[13px] font-semibold uppercase tracking-wide text-muted-foreground";
const textLink = "font-medium underline underline-offset-2 hover:text-foreground";

/**
 * The ONE summary at the top of an enquiry: the next action (what, who, when), the one main button for it with everything else under More, what blocks it,
 * then stage, owner, client and value, and where the enquiry stands with what moves it forward (once won: the delivery handover). Nothing below repeats it.
 * It only reads: every button opens an existing form or tab whose own rules, and the database, decide what the person may do. It states recorded facts; a
 * part whose data could not be read says so, and offers nothing that depends on it.
 */
export async function EnquiryGuide({ view }: { view: OppView }) {
  const { opp, detail, canEdit, isWon, isLost } = view;
  const { item } = detail;
  const base = `/sales/opportunities/${opp.id}`;
  const proposalsFailed = anyFailed(view, "proposals");
  // Which proposal versions are estimates (and finalised): needed to tell "a finalised estimate not yet recorded as sent" from an ordinary proposal.
  let marks: Awaited<ReturnType<typeof loadEstimateMarks>> | null = null;
  if (!proposalsFailed) { try { marks = await loadEstimateMarks(detail.proposals.map((p) => p.id)); } catch (e) { console.error("[crm] guide: estimate marks failed", e); } }
  const sendsFailed = anyFailed(view, "estimateSends");
  const sentIds = new Set(detail.estimateSends.map((s) => s.proposal_id));
  const lastSend = detail.estimateSends[0];
  const sentProposal = marks ? detail.proposals.filter((p) => !marks!.has(p.id) && (p.status === "sent" || p.status === "accepted")).sort((a, b) => b.version - a.version)[0] : undefined;
  const followUpsFailed = anyFailed(view, "followUps");
  const next = view.nextFollowUp;
  const facts: GuideFacts = {
    stage: opp.stage, stageBeforeHold: opp.stage_before_hold, holdReason: opp.hold_reason, holdReviewDate: opp.hold_review_date, lostReason: opp.lost_reason, waitingOn: opp.waiting_on,
    firstResponseAt: opp.first_response_at,
    followUps: followUpsFailed ? { failed: true } : { failed: false, next: next ? { title: next.title, dueAt: next.due_at, assigneeName: view.ctx.personName(next.assigned_to) } : null },
    sentProposal: marks ? (sentProposal ? { version: sentProposal.version, sentOn: sentProposal.sent_on } : null) : "unknown",
    sentEstimate: sendsFailed ? "unknown" : lastSend ? { reference: lastSend.reference, revision: lastSend.revision, sentOn: lastSend.sent_on } : null,
    quoteRef: anyFailed(view, "zoho") ? "unknown" : detail.zoho?.quote_ref?.trim() ? { ref: detail.zoho.quote_ref.trim(), sentOn: detail.zoho.quote_sent_on } : null,
    estimates: marks && !sendsFailed
      ? {
          finalisedUnsent: detail.proposals.filter((p) => marks!.get(p.id)?.finalised && p.status !== "superseded" && !sentIds.has(p.id)).length,
          drafts: detail.proposals.filter((p) => marks!.has(p.id) && !marks!.get(p.id)!.finalised && p.status === "draft").length,
        }
      : "unknown",
    canEdit, today: todayInDubai(),
  };
  const na = nextAction(facts);
  const guide = stageGuide(facts);
  let handoverRead: HandoverRead | null = null;
  if (isWon) handoverRead = await loadHandoverRead(opp.id);
  const handover = handoverRead ? handoverGuide(handoverRead, { ownerName: view.ownerName, canEdit }) : null;

  const moves = stageMoves(view);
  const primary = primaryAction({ opportunityId: opp.id, guide: facts, canActOnNext: canActOnNext(view), availability: item.availability, moves: moves && "options" in moves ? moves.options : null, handover });
  const blockers = summaryBlockers({ guide: facts, availability: item.availability, policy: view.policy, latestApproval: anyFailed(view, "approvals") ? "unknown" : (detail.approvals[0]?.state ?? null), ownerName: view.ownerName });
  const actions = buildSummaryActions(view, primary);
  const tone: GuideTone = handover ? handover.tone : na.tone;
  const hasNext = !!next && !followUpsFailed && !isWon && !isLost;

  // Where it stands: the handover once won, the closure once lost, the stage guidance otherwise. Recorded facts only.
  const closedNote = !view.canReopen ? REOPEN_NOT_ALLOWED_NOTE : "Reopen is under More. The closure stays in the history.";
  const standing = handover
    ? {
        headline: `Delivery handover: ${handover.state}`,
        lines: [
          `Won on ${formatDate(opp.closed_at)}${opp.evidence_type ? `, confirmed by ${EVIDENCE[opp.evidence_type]} ${opp.evidence_reference ?? ""} dated ${formatDate(opp.evidence_date)}` : ""}.`,
          ...(handover.nextOwner ? [`Next with: ${handover.nextOwner}.`] : []), ...handover.lines, closedNote,
        ],
        links: [] as GuideLink[],
      }
    : isLost ? { headline: `Lost on ${formatDate(opp.closed_at)}`, lines: [...guide.lines.filter((l) => !/^It is read-only/.test(l)), "A lost enquiry is read-only, including its contacts, until it is reopened.", closedNote], links: guide.links }
    : { headline: guide.headline, lines: guide.lines, links: guide.links };
  const links = standing.links.filter((l) => l.label !== primary?.label);
  const partyLabel = item.client && item.agency ? "Client, via agency" : item.agency && !item.client ? "Agency" : "Client";
  const partyText = item.client && item.agency ? `${item.client.name} via ${item.agency.name}` : (item.client?.name ?? item.agency?.name ?? "No client recorded");

  return (
    <section aria-label="Enquiry summary" className={cn("os-card min-w-0 space-y-4 border-l-4 p-4 sm:p-5", EDGE[tone])}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className={cn(label, "flex items-center gap-1.5")}>
            {na.tone === "red" ? <CircleAlert className="h-4 w-4" aria-hidden /> : <CalendarClock className="h-4 w-4" aria-hidden />} Next action
            <InfoHint label="Next action">The next open follow-up on this enquiry: what, who and when. Every active enquiry needs one, so it is not forgotten. The main button is chosen from what is recorded: an overdue follow-up first, then something recorded as ready but not yet done (an estimate to record as sent, a stage behind what was sent, an availability check to repeat, a first response).</InfoHint>
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <OsBadge tone={BADGE[na.tone]} dot>{na.label}</OsBadge>
            {hasNext ? <DueText dueAt={next.due_at} className="whitespace-normal text-sm" /> : null}
          </div>
          <p className="mt-1.5 break-words text-base font-semibold leading-snug">{na.title}</p>
          {na.detail ? <p className="mt-0.5 break-words text-sm text-muted-foreground">{hasNext ? <>For <span className="font-medium text-foreground">{na.detail}</span></> : na.detail}</p> : null}
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1.5 sm:items-end">
          <SummaryActions {...actions} />
          {primary ? <p className="max-w-xs text-[13px] text-muted-foreground sm:text-right">{primary.why}</p> : null}
        </div>
      </div>

      {blockers.length ? (
        <ul className="space-y-1.5 border-t border-border/70 pt-3" aria-label="What is in the way">
          {blockers.map((b) => (
            <li key={b.text} className={cn("flex gap-2 text-sm", BLOCKER_TEXT[b.tone], b.tone !== "neutral" && "font-medium")}>
              {b.tone === "neutral" ? null : <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />}
              <span className="min-w-0 break-words">{b.text}{b.tab ? <> <TabLink tab={b.tab} href={`${base}?tab=${b.tab}`} className="underline underline-offset-2">{b.linkLabel ?? "Open"}</TabLink></> : null}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="grid gap-x-8 gap-y-2 border-t border-border/70 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0"><dt className="text-muted-foreground">Stage</dt><dd className="flex flex-wrap items-center gap-x-2 gap-y-1"><StageBadge stage={opp.stage} /><span className="text-muted-foreground">since {formatDate(opp.stage_changed_at)}</span></dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Owner</dt><dd className="break-words font-medium" title={view.ownerName}>{view.ownerName}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">{partyLabel}</dt><dd className="break-words" title={partyText}>{partyText}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Value</dt><dd className="font-medium">{formatMoney(item.value, opp.currency)}</dd></div>
      </dl>

      <div className="border-t border-border/70 pt-3">
        <p className="break-words text-sm font-semibold">{standing.headline}{opp.stage === "on_hold" && opp.stage_before_hold ? <span className="font-normal text-muted-foreground"> (was {crmStageLabel(opp.stage_before_hold)})</span> : null}</p>
        {standing.lines.length ? <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">{standing.lines.map((l) => <li key={l} className="break-words">{l}</li>)}</ul> : null}
        {links.length || handover?.project ? (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {handover?.project && primary?.kind !== "open_project" ? <Link href={`/projects/${handover.project.id}`} className={textLink}>Open project {handover.project.reference}</Link> : null}
            {links.map((l) => l.tab ? <TabLink key={l.label} tab={l.tab} href={`${base}?tab=${l.tab}`} className={textLink}>{l.label}</TabLink> : <Link key={l.label} href={l.href ?? base} className={textLink}>{l.label}</Link>)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
