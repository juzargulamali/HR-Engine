import Link from "next/link";
import { OsBadge } from "@/components/os/pills";
import { ATTENTION_LABELS, type Attention, type MilestoneProgress, type PlanSummary } from "@/lib/projects/delivery-plan/insights";
import type { DpMilestone } from "@/lib/projects/delivery-plan/model";
import { milestoneProgress } from "@/lib/projects/delivery-plan/insights";
import { dateText } from "@/lib/projects/format";
import { Muted, Panel } from "@/components/projects/parts";

/** Where a row's link goes: the Breakdown with that activation open, at the line. */
export const rowHref = (projectId: string, a: Pick<Attention, "itemKey" | "lineKey">) => `/projects/${projectId}/delivery?open=${a.itemKey}#dp-${a.lineKey}`;

/**
 * The next-step summary at the top of the Project Plan: the next recorded site date, what needs attention (most urgent first, each linked to its row) and the one next
 * action. A plan with nothing to do says so only when it has something that could have been done; an empty plan says it is empty.
 */
export function PlanSummaryStrip({ projectId, summary, manage, releaseHint }: { projectId: string; summary: PlanSummary; manage: boolean; releaseHint: string | null }) {
  const kinds = (Object.keys(ATTENTION_LABELS) as Attention["kind"][]).filter((k) => summary.counts[k] > 0);
  const empty = summary.lines === 0;
  return (
    <section aria-label="Next steps" className="os-card px-4 py-3 sm:px-5" data-testid="plan-summary">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]">
        <div data-testid="summary-site">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Next site date</h2>
          {summary.nextSite ? <p className="mt-1 text-sm"><span className="font-medium">{dateText(summary.nextSite.date)}</span> <span className="text-muted-foreground">· {summary.nextSite.label}</span></p>
            : <p className="mt-1 text-sm text-muted-foreground">{summary.siteRecorded ? "The recorded site dates have passed." : "No site date recorded yet."}</p>}
        </div>
        <div data-testid="summary-attention">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</h2>
          {kinds.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">{empty ? "Nothing in the plan yet." : "Nothing is holding the plan up."}</p> : (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {kinds.map((k) => <li key={k}><OsBadge tone={k === "blocker" || k === "late_dependency" || k === "overdue" || k === "unread" ? "red" : "amber"}>{summary.counts[k]} · {ATTENTION_LABELS[k]}</OsBadge></li>)}
            </ul>
          )}
        </div>
        <div data-testid="summary-next">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Next action</h2>
          {summary.next ? (
            <p className="mt-1 text-sm"><Link href={rowHref(projectId, summary.next)} className="font-medium underline underline-offset-2">{summary.next.text}</Link></p>
          ) : summary.pendingScope > 0 && manage ? <p className="mt-1 text-sm">Bring the {summary.pendingScope} accepted technolog{summary.pendingScope === 1 ? "y" : "ies"} into the plan.</p>
            : empty ? <p className="mt-1 text-sm text-muted-foreground">{manage ? "Add the first technology or activation." : "The Project Manager is still building the plan."}</p>
            : releaseHint && manage ? <p className="mt-1 text-sm">{releaseHint}</p>
            : <p className="mt-1 text-sm text-muted-foreground">Nothing is waiting on you here.</p>}
        </div>
      </div>
      {summary.attention.length > 1 ? (
        <details className="mt-3 border-t border-border pt-2">
          <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground">All {summary.attention.length} items, most urgent first</summary>
          <ul className="mt-2 space-y-1" data-testid="summary-list">
            {summary.attention.map((a, n) => (
              <li key={`${a.lineId}-${a.kind}-${n}`} className="text-sm"><Link href={rowHref(projectId, a)} className="underline-offset-2 hover:underline">{a.text}</Link></li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** Milestones with the work they wait for: "3 of 5 complete" and the outstanding tasks. Readiness is shown apart from the milestone's own confirmation, which stays an existing action. */
export function MilestonePanel({ projectId, milestones }: { projectId: string; milestones: DpMilestone[] }) {
  const rows = milestones.map((m) => ({ m, p: milestoneProgress(m) })).filter((x) => x.p.total > 0 || x.m.status !== "accepted");
  if (rows.length === 0) return null;
  const word = (p: MilestoneProgress) => (p.confirmed ? "Confirmed" : p.ready ? "All tasks complete: ready to confirm" : p.total === 0 ? "No tasks linked yet" : "Not ready");
  return (
    <Panel title="Milestones" description="Each milestone counts the tasks linked to it. Complete tasks make it ready; confirming the milestone is a separate step on the Work page.">
      <ul className="divide-y divide-border" data-testid="plan-milestones">
        {rows.map(({ m, p }) => (
          <li key={m.id} className="space-y-1.5 py-2.5" data-testid={`milestone-${m.title}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{m.title}{m.due_date ? <span className="font-normal text-muted-foreground"> · due {dateText(m.due_date)}</span> : null}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <OsBadge tone={p.total === 0 ? "quiet" : p.ready ? "green" : "blue"}>{p.label}</OsBadge>
                <OsBadge tone={p.confirmed ? "green" : p.ready ? "amber" : "quiet"}>{word(p)}</OsBadge>
                {m.status !== "planned" && !p.confirmed ? <OsBadge tone="quiet">{m.status.replace(/_/g, " ")}</OsBadge> : null}
              </div>
            </div>
            {p.atRisk ? <p className="text-[13px] text-[hsl(var(--os-red))]">At risk: {p.atRisk}.</p> : null}
            {p.outstanding.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {p.outstanding.map((o) => (
                  <li key={o.key} className="break-words">
                    {o.planned ? o.title : <Link href={`/projects/${projectId}/work?task=${o.key}`} className="underline-offset-2 hover:underline">{o.title}</Link>}
                    <span className="text-muted-foreground"> · {o.planned ? "not released yet" : o.status.replace(/_/g, " ")}{o.blocked ? ", blocked" : ""}{o.who ? ` · ${o.who}` : ""}{o.due ? ` · due ${dateText(o.due)}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <Muted className="mt-2">Open the <Link href={`/projects/${projectId}/work?ms=1#milestone-list`} className="underline underline-offset-2">milestone list</Link> to confirm one.</Muted>
    </Panel>
  );
}
