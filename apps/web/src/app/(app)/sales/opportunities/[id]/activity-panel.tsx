import { AddActivityForm } from "./add-activity-form";
import { ClosureHistory } from "./closure-history";
import { planNextProps } from "./helpers";
import { Muted, Panel } from "./parts";
import { LoadError } from "@/components/workspace/states";
import { TIMELINE_READ_LIMIT, timelineItems } from "./timeline";
import { TimelineList } from "./timeline-list";
import { anyFailed, planNextInput, type OppView } from "./view";

/** What people did (calls, notes, client replies) and what changed on the record (stage, owner, value…), newest first, in one list. */
export function ActivityPanel({ view, showForm = true }: { view: OppView; showForm?: boolean }) {
  const { detail, ctx, opp, isLost } = view;
  const timelineFailed = anyFailed(view, "activities", "events");
  // Follow-ups are part of the story (planned, completed, cancelled). If they could not be read the timeline still shows, and says they are missing.
  const followUpsMissing = anyFailed(view, "followUps");
  const timeline = timelineFailed ? [] : timelineItems({ opportunityId: opp.id, activities: detail.activities, events: detail.events, followUps: followUpsMissing ? [] : detail.followUps, firstResponseAt: opp.first_response_at }, ctx.personName);
  const mayBeCut = detail.activities.length >= TIMELINE_READ_LIMIT || detail.events.length >= TIMELINE_READ_LIMIT;
  // The "log an activity" form plans the next follow-up from the follow-ups: without them it is not offered (and says why).
  const followUpsFailed = anyFailed(view, "followUps");
  const next = followUpsFailed ? null : planNextProps(planNextInput(view));
  const retry = `/sales/opportunities/${opp.id}?tab=activity`;
  return (
    <div className="space-y-6">
      {isLost ? (
        <Muted>A lost opportunity can no longer be updated until it is reopened. The history below is kept.</Muted>
      ) : !showForm ? null : next === null ? (
        <Panel title="Log an activity"><LoadError what="the follow-ups" retryHref={retry} note="An activity cannot be logged here until they load, because logging one can plan the next step." /></Panel>
      ) : (
        <Panel title="Log an activity" description="Anyone with Sales access can add to the timeline. Log a call and plan the next step here, in one go.">
          <AddActivityForm opportunityId={opp.id} {...next} />
        </Panel>
      )}
      <ClosureHistory view={view} />
      <Panel title="Timeline" id="timeline" description="Everything recorded on this enquiry, newest first: what people wrote, and what the app recorded (stage changes, follow-ups, estimates and proposals recorded as sent, handover).">
        {timelineFailed ? (
          <LoadError what="the timeline" retryHref={retry} note="It is not empty: the activities or the history could not be read." />
        ) : (
          <>
            {followUpsMissing ? <p role="alert" className="mb-3 text-sm text-destructive">Could not load the follow-ups, so follow-ups planned or completed are missing from this timeline.</p> : null}
            {mayBeCut ? <p role="status" className="mb-3 text-sm text-[hsl(var(--os-amber))]">This enquiry has a very long history: the oldest entries may not be shown.</p> : null}
            <TimelineList items={timeline} />
          </>
        )}
      </Panel>
    </div>
  );
}
