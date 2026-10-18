import { History, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/components/sales/format";
import { AddActivityForm } from "./add-activity-form";
import { describeHistoryEvent } from "./closure-helpers";
import { ClosureHistory } from "./closure-history";
import { buildTimeline, describeEvent } from "./helpers";
import { Muted, Panel } from "./parts";
import type { OppView } from "./view";

const KIND_LABEL = { call: "Call", email: "Email", meeting: "Meeting", note: "Note", client_response: "Client response" } as const;

/** What people did (calls, notes, client replies) and what changed on the record (stage, owner, value…), newest first, in one list. */
export function ActivityPanel({ view }: { view: OppView }) {
  const { detail, ctx, opp, isLost } = view;
  const timeline = buildTimeline(detail.activities, detail.events);
  return (
    <div className="space-y-6">
      {isLost ? (
        <Muted>A lost opportunity can no longer be updated until it is reopened. The history below is kept.</Muted>
      ) : (
        <Panel title="Log an activity" description="Anyone with Sales access can add to the timeline.">
          <AddActivityForm opportunityId={opp.id} />
        </Panel>
      )}
      <ClosureHistory view={view} />
      <Panel title="Timeline" description="Activities and changes to the record together.">
        {timeline.length === 0 ? (
          <Muted>Nothing has been recorded yet.</Muted>
        ) : (
          <ol className="divide-y divide-border/70">
            {timeline.map((t) =>
              t.kind === "activity" ? (
                <li key={t.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <MessageSquare className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{KIND_LABEL[t.activity.kind]}</Badge>
                      {t.activity.is_internal ? <Badge variant="secondary">Internal note</Badge> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{t.activity.body}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{ctx.personName(t.activity.created_by)} · {formatDateTime(t.at)}</p>
                  </div>
                </li>
              ) : (
                <li key={t.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <History className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{describeHistoryEvent(t.event) ?? describeEvent(t.event, ctx.personName)}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{t.event.actor_id ? ctx.personName(t.event.actor_id) : "System"} · {formatDateTime(t.at)}</p>
                  </div>
                </li>
              ),
            )}
          </ol>
        )}
      </Panel>
    </div>
  );
}
