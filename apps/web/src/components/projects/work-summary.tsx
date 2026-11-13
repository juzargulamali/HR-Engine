import Link from "next/link";
import { ClipboardList, Flag } from "lucide-react";
import { Muted } from "@/components/projects/parts";
import { dateText } from "@/lib/projects/format";
import type { MilestoneSummary, OutputSummary } from "@/lib/projects/work-summary";

/**
 * Two compact cards on Work: Milestones and Task outputs. Each number links to the records behind it (the milestone list, the Deliverables view filtered to that state). An empty card says what
 * the Project Manager can do next. A read that failed says so: it is never shown as zero.
 */
export function WorkSummary({ projectId, milestones, milestonesHref, outputs, outputsFailed, canManage }: {
  projectId: string; milestones: MilestoneSummary; milestonesHref: string; outputs: OutputSummary | null; outputsFailed: boolean; canManage: boolean;
}) {
  const reg = `/projects/${projectId}/delivery?view=deliverables`;
  const chip = "rounded-md border border-border px-2 py-1 text-[13px] underline-offset-2 hover:underline";
  return (
    <section aria-label="Milestones and task outputs" className="grid items-start gap-3 sm:grid-cols-2" data-testid="work-summary">
      <div className="os-card space-y-1.5 p-4" data-testid="summary-milestones">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold"><Flag className="h-4 w-4 text-accent" aria-hidden /> Milestones</h2>
        {milestones.total === 0 ? (
          <Muted>No milestones yet. {canManage ? <>Add one so the work has a checkpoint to be accepted against: <Link href={milestonesHref} className="underline underline-offset-2">open Milestones</Link> and choose Add milestone.</> : "The Project Manager adds milestones to give the work checkpoints."}</Muted>
        ) : (
          <>
            <p className="text-sm"><Link href={milestonesHref} className="font-medium underline-offset-4 hover:underline">{milestones.accepted} of {milestones.total} accepted</Link>{milestones.overdue > 0 ? <span className="text-[hsl(var(--os-red))]"> · {milestones.overdue} overdue</span> : null}</p>
            {milestones.next ? <p className="break-words text-[13px] text-muted-foreground">Next: {milestones.next.title}{milestones.next.due ? `, due ${dateText(milestones.next.due)}` : ", no due date"}</p> : <p className="text-[13px] text-muted-foreground">Every milestone is accepted.</p>}
          </>
        )}
      </div>
      <div className="os-card space-y-1.5 p-4" data-testid="summary-outputs">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold"><ClipboardList className="h-4 w-4 text-accent" aria-hidden /> Task outputs</h2>
        {outputsFailed ? <Muted>The task outputs could not be loaded. Reload to try again; the tasks below are unaffected.</Muted> : !outputs || outputs.total === 0 ? (
          <Muted>No task has an expected output yet. {canManage ? "Open a task and choose Set expected output so what it must produce, and each version handed in, can be tracked and reviewed." : "The Project Manager or a team lead sets what each task must produce."}</Muted>
        ) : (
          <>
            <p className="text-sm"><Link href={reg} className="font-medium underline-offset-4 hover:underline">{outputs.total} {outputs.total === 1 ? "output" : "outputs"}</Link> across the tasks</p>
            <p className="flex flex-wrap gap-1.5" data-testid="summary-output-counts">
              <Link href={`${reg}&f=missing`} className={chip}>Missing {outputs.counts.missing}</Link>
              <Link href={`${reg}&f=awaiting`} className={chip}>Awaiting review {outputs.counts.awaiting}</Link>
              <Link href={`${reg}&f=changes`} className={chip}>Changes requested {outputs.counts.changes}</Link>
              <Link href={`${reg}&f=approved`} className={chip}>Approved {outputs.counts.approved}</Link>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
