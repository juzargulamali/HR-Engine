import Link from "next/link";
import { ClipboardList, Flag } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { InfoHint } from "@/components/ui/info-hint";
import { Muted } from "@/components/projects/parts";
import { dateText } from "@/lib/projects/format";
import type { MilestoneSummary, OutputLine, OutputSummary } from "@/lib/projects/work-summary";

/**
 * Two compact cards on Work. Milestones: progress (accepted of total), what is next and what is overdue, each a link; when there are none the Project Manager gets a small Add milestone action
 * and everyone else a short line. Task outputs: the real expected outputs with their review state (most urgent first) and a link to each version, plus the counts as filters. A read that failed
 * says so: it is never shown as zero.
 */
export function WorkSummary({ projectId, milestones, milestonesHref, outputs, outputLines, outputsMore, outputsFailed, canManage, addMilestone }: {
  projectId: string; milestones: MilestoneSummary; milestonesHref: string; outputs: OutputSummary | null; outputLines: OutputLine[]; outputsMore: number; outputsFailed: boolean; canManage: boolean;
  /** The Add milestone button (a client dialog), passed in by the page for the Project Manager only. */
  addMilestone?: React.ReactNode;
}) {
  const reg = `/projects/${projectId}/delivery?view=deliverables`;
  const chip = "rounded-md border border-border px-2 py-1 text-[13px] underline-offset-2 hover:underline";
  const pct = milestones.total === 0 ? 0 : Math.round((milestones.accepted / milestones.total) * 100);
  return (
    <section aria-label="Milestones and task outputs" className="grid items-start gap-3 lg:grid-cols-2" data-testid="work-summary">
      <div className="os-card space-y-1.5 p-4" data-testid="summary-milestones">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold"><Flag className="h-4 w-4 text-accent" aria-hidden /> Milestones<InfoHint label="milestones">A milestone is a checkpoint the project is accepted against. Tasks never need one, and progress counts accepted required milestones only.</InfoHint></h2>
          {milestones.total === 0 && canManage && addMilestone ? <span data-testid="summary-add-milestone">{addMilestone}</span> : null}
        </div>
        {milestones.total === 0 ? (
          <div data-testid="summary-milestones-empty"><Muted>{canManage ? "No milestones yet." : "No milestones yet. The Project Manager adds them."}</Muted></div>
        ) : (
          <>
            <p className="text-sm" data-testid="summary-milestone-progress">
              <Link href={milestonesHref} className="font-medium underline-offset-4 hover:underline">{milestones.accepted} of {milestones.total} accepted</Link>
              {milestones.overdue > 0 ? <span className="text-[hsl(var(--os-red))]" data-testid="summary-milestone-overdue"> · {milestones.overdue} overdue</span> : null}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${milestones.accepted} of ${milestones.total} milestones accepted`}>
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            {milestones.next ? <p className="break-words text-[13px] text-muted-foreground">Next: <Link href={milestonesHref} className="underline-offset-2 hover:underline">{milestones.next.title}</Link>{milestones.next.due ? `, due ${dateText(milestones.next.due)}` : ", no due date"}</p> : <p className="text-[13px] text-muted-foreground">Every milestone is accepted.</p>}
          </>
        )}
      </div>
      <div className="os-card space-y-1.5 p-4" data-testid="summary-outputs">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold"><ClipboardList className="h-4 w-4 text-accent" aria-hidden /> Task outputs<InfoHint label="task outputs">An expected output is what a task must produce. Each version handed in is tracked and reviewed, and a required output blocks Ready for review and Done until it is approved.</InfoHint></h2>
        {outputsFailed ? <Muted>⚠ The task outputs could not be loaded. Reload to try again; the tasks below are unaffected.</Muted> : !outputs || outputs.total === 0 ? (
          <Muted>No task has an expected output yet. {canManage ? "Open a task and choose Set expected output." : "The Project Manager or a team lead sets them."}</Muted>
        ) : (
          <>
            <ul className="divide-y divide-border" data-testid="summary-output-lines">
              {outputLines.map((l) => (
                <li key={l.taskId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5" data-testid={`summary-output-${l.taskId}`}>
                  <Link href={l.href} className="min-w-0 break-words text-sm font-medium underline-offset-2 hover:underline">{l.title}<span className="font-normal text-muted-foreground"> · {l.output}</span></Link>
                  <OsBadge tone={l.tone} dot>{l.stateText}{l.version ? ` · v${l.version}` : ""}</OsBadge>
                </li>
              ))}
            </ul>
            <p className="text-[13px]"><Link href={reg} className="font-medium underline-offset-4 hover:underline">{outputsMore > 0 ? `${outputsMore} more, ` : ""}all {outputs.total} {outputs.total === 1 ? "output" : "outputs"}</Link></p>
            <p className="flex flex-wrap gap-1.5" data-testid="summary-output-counts">
              <Link href={`${reg}&f=missing`} className={chip}>Missing {outputs.counts.missing}</Link>
              <Link href={`${reg}&f=awaiting`} className={chip}>Outputs awaiting approval {outputs.counts.awaiting}</Link>
              <Link href={`${reg}&f=changes`} className={chip}>Changes requested {outputs.counts.changes}</Link>
              <Link href={`${reg}&f=approved`} className={chip}>Approved {outputs.counts.approved}</Link>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
