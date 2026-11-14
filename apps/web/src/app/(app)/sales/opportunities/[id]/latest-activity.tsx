import { History, MessageSquare } from "lucide-react";
import { TabLink } from "./detail-tabs";
import { Muted, Panel } from "./parts";
import { timelineItems } from "./timeline";
import { anyFailed, type OppView } from "./view";

/** The three newest timeline entries, with the way into the full history. Built by the same function as the timeline, so a completed follow-up appears once here too. */
export function LatestActivity({ view }: { view: OppView }) {
  const { opp, detail } = view;
  const failed = anyFailed(view, "activities", "events");
  const latest = failed ? [] : timelineItems({ opportunityId: opp.id, activities: detail.activities, events: detail.events, followUps: anyFailed(view, "followUps") ? [] : detail.followUps, firstResponseAt: opp.first_response_at }, view.ctx.personName).slice(0, 3);
  return (
    <Panel title="Latest activity" actions={<TabLink tab="activity" href={`/sales/opportunities/${opp.id}?tab=activity`} className="text-sm font-medium underline underline-offset-2">Open the full history</TabLink>}>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">Could not load the activity. It is not empty: reload to try again.</p>
      ) : latest.length === 0 ? (
        <Muted>Nothing has been recorded yet.</Muted>
      ) : (
        <ol className="space-y-2.5">
          {latest.map((t) => (
            <li key={t.id} className="flex gap-2 text-sm">
              {t.type === "staff" ? <MessageSquare className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--os-info))]" aria-hidden /> : <History className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />}
              <span className="min-w-0"><span className="line-clamp-2 break-words" title={t.text}>{t.type === "staff" && !t.id.startsWith("fd-") ? `${t.label}: ` : ""}{t.text}</span><span className="block text-muted-foreground">{t.who} · {t.when}</span></span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
