import Link from "next/link";
import { ArrowRight, CalendarClock, CircleAlert, Clock3, FolderKanban, History, MessageSquare, Truck } from "lucide-react";
import { NewFollowUpButton } from "@/components/sales/follow-up-dialogs";
import { DueText } from "@/components/sales/badges";
import { todayInDubai } from "@/components/sales/format";
import { OsBadge } from "@/components/os/pills";
import { buttonVariants } from "@/components/ui/button";
import { loadEstimateMarks } from "@/lib/crm/data";
import { handoverGuide, nextAction, stageGuide, type GuideFacts, type GuideLink, type GuideTone, type HandoverRead } from "@/lib/crm/enquiry-guide";
import { loadHandoverRead } from "@/lib/crm/handover-attention-data";
import { cn } from "@/lib/utils";
import { TabLink } from "./detail-tabs";
import { timelineItems } from "./timeline";
import { anyFailed, type OppView } from "./view";

const EDGE: Record<GuideTone, string> = {
  red: "border-l-[hsl(var(--os-red))]", amber: "border-l-[hsl(var(--os-amber))]", blue: "border-l-[hsl(var(--os-info))]", green: "border-l-[hsl(var(--os-green))]", neutral: "border-l-border",
};
const BADGE: Record<GuideTone, "red" | "amber" | "blue" | "green" | "quiet"> = { red: "red", amber: "amber", blue: "blue", green: "green", neutral: "quiet" };
const card = (tone: GuideTone) => cn("os-card min-w-0 border-l-4 p-4", EDGE[tone]);
const heading = "flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * The guide under the enquiry's header: the next action (who, when), where the enquiry stands and what moves it forward (or, once won, the delivery handover),
 * and the latest activity with a way into the full history. It only reads: every link goes to an existing tab or page, whose own rules decide what the person
 * may do. It states recorded facts; a section whose data could not be read says so.
 */
export async function EnquiryGuide({ view, currentUserId }: { view: OppView; currentUserId: string }) {
  const { opp, detail, canEdit, isWon, isActive } = view;
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

  const timelineFailed = anyFailed(view, "activities", "events");
  const latest = timelineFailed ? [] : timelineItems({ opportunityId: opp.id, activities: detail.activities, events: detail.events, followUps: followUpsFailed ? [] : detail.followUps, firstResponseAt: opp.first_response_at }, view.ctx.personName).slice(0, 3);

  const link = (l: GuideLink) => {
    const cls = cn(buttonVariants({ variant: l.primary ? "default" : "outline", size: "sm" }));
    return l.tab ? <TabLink key={l.label} tab={l.tab} href={`${base}?tab=${l.tab}`} className={cls}>{l.label}</TabLink> : <Link key={l.label} href={l.href ?? base} className={cls}>{l.label}</Link>;
  };

  return (
    <section aria-label="Where this enquiry stands" className="grid gap-3 lg:grid-cols-3">
      {/* 1. The next action */}
      <div className={card(na.tone)}>
        <h2 className={heading}>{na.tone === "red" ? <CircleAlert className="h-4 w-4" aria-hidden /> : <CalendarClock className="h-4 w-4" aria-hidden />} Next action</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <OsBadge tone={BADGE[na.tone]} dot>{na.label}</OsBadge>
          {next && !followUpsFailed ? <DueText dueAt={next.due_at} className="whitespace-normal text-sm" /> : null}
        </div>
        <p className="mt-1.5 break-words text-base font-semibold leading-snug">{na.title}</p>
        {na.detail ? <p className="mt-0.5 break-words text-sm text-muted-foreground">{next && !followUpsFailed ? <>Owner of this action: <span className="font-medium text-foreground">{na.detail}</span></> : na.detail}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {na.missing && isActive ? <NewFollowUpButton opportunityId={opp.id} people={view.people} canAssign={canEdit || view.canAssign} currentUserId={currentUserId} /> : null}
          {next && !followUpsFailed ? <TabLink tab="overview" href={`${base}?tab=overview`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Complete or reschedule</TabLink> : null}
          {next && !followUpsFailed && opp.stage !== "lost" ? <TabLink tab="activity" href={`${base}?tab=activity`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Log an update</TabLink> : null}
        </div>
      </div>

      {/* 2. Won: the delivery handover. Otherwise: where it stands and what moves it forward. */}
      {handover ? (
        <div className={card(handover.tone)}>
          <h2 className={heading}><Truck className="h-4 w-4" aria-hidden /> Delivery handover</h2>
          <div className="mt-2"><OsBadge tone={BADGE[handover.tone]} dot>{handover.state}</OsBadge></div>
          {handover.nextOwner ? <p className="mt-1.5 text-sm">Next with: <span className="font-semibold">{handover.nextOwner}</span></p> : null}
          <ul className="mt-1.5 space-y-1 text-sm">{handover.lines.map((l) => <li key={l} className="break-words">{l}</li>)}</ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {handover.project ? <Link href={`/projects/${handover.project.id}`} className={cn(buttonVariants({ size: "sm" }))}><FolderKanban className="h-4 w-4" aria-hidden /> Open project {handover.project.reference}</Link> : null}
            {handover.action ? <Link href={`${base}/handover`} className={cn(buttonVariants({ variant: handover.action.primary ? "default" : "outline", size: "sm" }))}>{handover.action.label}</Link> : null}
          </div>
        </div>
      ) : (
        <div className={card(guide.tone)}>
          <h2 className={heading}><ArrowRight className="h-4 w-4" aria-hidden /> Where it stands</h2>
          <p className="mt-2 break-words text-base font-semibold leading-snug">{guide.headline}</p>
          <ul className="mt-1.5 space-y-1 text-sm">{guide.lines.map((l) => <li key={l} className="break-words">{l}</li>)}</ul>
          {guide.links.length ? <div className="mt-3 flex flex-wrap gap-2">{guide.links.map(link)}</div> : null}
        </div>
      )}

      {/* 3. The latest activity */}
      <div className={card("neutral")}>
        <h2 className={heading}><Clock3 className="h-4 w-4" aria-hidden /> Latest activity</h2>
        {timelineFailed ? (
          <p role="alert" className="mt-2 text-sm text-destructive">Could not load the activity. It is not empty: reload to try again.</p>
        ) : latest.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing has been recorded yet.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {latest.map((t) => (
              <li key={t.id} className="flex gap-2 text-sm">
                {t.type === "staff" ? <MessageSquare className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--os-info))]" aria-hidden /> : <History className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />}
                <span className="min-w-0"><span className="line-clamp-2 break-words">{t.type === "staff" ? `${t.label}: ` : ""}{t.text}</span><span className="block text-muted-foreground">{t.who} · {t.when}</span></span>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-3"><TabLink tab="activity" href={`${base}?tab=activity`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Open the full activity and comments</TabLink></div>
      </div>
    </section>
  );
}
