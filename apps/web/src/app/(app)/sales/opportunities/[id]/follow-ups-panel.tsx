import { canActOnFollowUp } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { CancelFollowUpButton, CompleteFollowUpButton, NewFollowUpButton, RescheduleFollowUpButton } from "@/components/sales/follow-up-dialogs";
import { DueText } from "@/components/sales/badges";
import { formatDateTime } from "@/components/sales/format";
import { isOnlyOpenFollowUp } from "./helpers";
import { Muted, Panel } from "./parts";
import type { OppView } from "./view";

const KIND_LABEL = { call: "Call", email: "Email", meeting: "Meeting", proposal: "Proposal work", other: "Other" } as const;

/** The next actions on this opportunity. Completing the last one of an active opportunity forces a next step or a hold (dialog and database agree). */
export function FollowUpsPanel({ view }: { view: OppView }) {
  const { detail, ctx, opp, isOpen, isActive } = view;
  const ref = { companyId: opp.company_id, ownerId: opp.owner_id };
  const open = view.openFollowUps;
  const closed = detail.followUps.filter((f) => f.status !== "open").sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at));
  return (
    <Panel
      title="Follow-ups"
      description="What happens next, and who does it."
      actions={isOpen ? <NewFollowUpButton opportunityId={opp.id} people={view.people} canAssign={view.canEdit || view.canAssign} currentUserId={ctx.userId} /> : undefined}
    >
      {open.length === 0 ? (
        <Muted>{isOpen ? (isActive ? "No open follow-up. Add one so this opportunity is not forgotten." : "No open follow-ups.") : "A closed opportunity has no follow-ups."}</Muted>
      ) : (
        <ul className="divide-y divide-border/70">
          {open.map((f) => {
            const mine = canActOnFollowUp(ctx.grants, { assignedTo: f.assigned_to }, ref, ctx.userId);
            const onlyOpen = isOnlyOpenFollowUp(detail.followUps, f.id, opp.stage);
            return (
              <li key={f.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 break-words text-sm font-medium">{f.title}</p>
                  <Badge variant="outline">{KIND_LABEL[f.kind]}</Badge>
                </div>
                <p className="text-sm text-muted-foreground"><DueText dueAt={f.due_at} /> · assigned to {ctx.personName(f.assigned_to)}</p>
                {mine ? (
                  <div className="flex flex-wrap gap-1.5">
                    <CompleteFollowUpButton followUp={{ id: f.id, title: f.title, opportunityId: opp.id, isOnlyOpen: onlyOpen }} />
                    <RescheduleFollowUpButton followUp={{ id: f.id, title: f.title, opportunityId: opp.id }} />
                    {onlyOpen ? null : <CancelFollowUpButton followUp={{ id: f.id, title: f.title, opportunityId: opp.id }} />}
                  </div>
                ) : <p className="text-sm text-muted-foreground">Only the assignee, the owner or a founder can change this.</p>}
                {onlyOpen && mine ? <p className="text-sm text-muted-foreground">This is the only next action. Completing it asks for the next one, or to put the opportunity on hold.</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      {closed.length > 0 ? (
        <details className="mt-4 border-t border-border/70 pt-3">
          <summary className="cursor-pointer text-sm font-medium">Finished follow-ups ({closed.length})</summary>
          <ul className="mt-2 space-y-2">
            {closed.map((f) => (
              <li key={f.id} className="text-sm">
                <p className="break-words">{f.title} <span className="text-muted-foreground">· {f.status === "done" ? `done ${formatDateTime(f.completed_at)}` : "cancelled"}</span></p>
                {f.outcome ? <p className="break-words text-sm text-muted-foreground">{f.status === "done" ? "Outcome" : "Reason"}: {f.outcome}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}
