import Link from "next/link";
import { Download } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Muted } from "@/components/projects/parts";
import { AssignReviewerDialog, DecideDialog, ExpectedOutputDialog, LinkFeedbackDialog, OpenOutputButton, SubmitVersionDialog } from "@/components/projects/deliverables/output-forms";
import {
  fileLabel, formatAt, groupByActivation, NEEDS_REVIEWER_HELP, nextOutputAction, OUTPUT_STATE_LABELS, OUTPUT_STATE_TONE, quantityText, REGISTER_FILTERS, registerCounts, reviewStateWord,
  type FileRef, type OutputVersion, type Register, type RegisterFilter, type RegisterRow,
} from "@/lib/projects/phase2/model";

export const OutputStateBadge = ({ state }: { state: RegisterRow["state"] }) => <OsBadge tone={OUTPUT_STATE_TONE[state]} dot>{OUTPUT_STATE_LABELS[state]}</OsBadge>;

function FileLine({ f }: { f: FileRef }) {
  if (!f) return <span className="text-muted-foreground">No file</span>;
  if (!f.accessible) return <span className="text-muted-foreground" data-testid="output-file-restricted">{fileLabel(f)}</span>;
  return <span className="inline-flex flex-wrap items-center gap-x-2"><span className="break-words">{fileLabel(f)}</span><OpenOutputButton fileId={f.id!} kind={f.kind ?? "file"} url={f.url} label="Open" /></span>;
}

/** The two moments are written side by side and never merged: when the version was attached, and (separately) when it was approved. Both in the project's time zone, named. */
function Times({ v, tz }: { v: OutputVersion; tz: string | null }) {
  return (
    <dl className="grid gap-x-6 gap-y-0.5 text-[13px] sm:grid-cols-2">
      <div><dt className="inline text-muted-foreground">Attached: </dt><dd className="inline" data-testid="output-attached-at">{formatAt(v.attached_at, tz)}</dd><span className="text-muted-foreground"> by {v.submitted_by_name ?? "someone"}</span></div>
      {v.approved_at ? <div><dt className="inline text-muted-foreground">Approved: </dt><dd className="inline" data-testid="output-approved-at">{formatAt(v.approved_at, tz)}</dd><span className="text-muted-foreground"> by {v.approved_by_name ?? "someone"}</span></div>
        : v.decided_at ? <div><dt className="inline text-muted-foreground">Changes requested: </dt><dd className="inline">{formatAt(v.decided_at, tz)}</dd><span className="text-muted-foreground"> by {v.decided_by_name ?? "someone"}</span></div> : <div className="text-muted-foreground">Not reviewed yet</div>}
    </dl>
  );
}

function VersionBody({ v, row, tz, linkFeedback }: { v: OutputVersion; row: Pick<RegisterRow, "output_qty">; tz: string | null; linkFeedback?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">Version {v.version_no}</span><OsBadge tone={v.status === "approved" ? "green" : v.status === "changes_requested" ? "amber" : v.status === "awaiting" ? (v.needs_reviewer ? "red" : "blue") : "quiet"} data-testid={`output-version-state-${v.version_no}`}>{reviewStateWord(v)}</OsBadge>{quantityText(row, v) ? <span className="text-[13px] text-muted-foreground">{quantityText(row, v)}</span> : null}</div>
      <Times v={v} tz={tz} />
      <p className="text-[13px]"><FileLine f={v.file} /></p>
      {v.snapshot ? <p className="text-[13px]"><span className="text-muted-foreground">Snapshot: </span><FileLine f={v.snapshot} /></p> : null}
      {v.mutable_link ? <p className="text-[13px] text-[hsl(var(--os-amber))]" data-testid="output-mutable-note">This is a link to a document that can change after approval. The approval is of what it showed when it was submitted; use a snapshot or a version-specific link to retrieve that exact material.</p> : null}
      {v.note ? <p className="whitespace-pre-wrap break-words text-[13px]"><span className="text-muted-foreground">Submitter&apos;s note: </span>{v.note}</p> : null}
      {v.decision_note ? <p className="whitespace-pre-wrap break-words text-[13px]"><span className="text-muted-foreground">Reviewer&apos;s feedback: </span>{v.decision_note}</p> : null}
      {v.feedback.length > 0 ? <ul className="space-y-0.5 text-[13px]" data-testid="output-feedback">{v.feedback.map((f) => <li key={f.id} className="break-words"><span className="text-muted-foreground">Client feedback ({f.source}, {f.status.replace("_", " ")}): </span>{f.text}</li>)}</ul> : null}
      {linkFeedback}
    </div>
  );
}

/** A compact version history: the newest first, each with its own review, times and feedback. Older versions stay readable. */
export function VersionHistory({ row, tz }: { row: RegisterRow; tz: string | null }) {
  if (row.versions.length === 0) return null;
  return (
    <details className="rounded-md border border-border px-3 py-2" data-testid={`output-history-${row.task_id}`}>
      <summary className="cursor-pointer text-[13px] font-medium">Version history ({row.versions.length})</summary>
      <ol className="mt-2 space-y-3">{row.versions.map((v) => <li key={v.id} className="border-l-2 border-border pl-3" data-testid={`output-version-${v.version_no}`}><VersionBody v={v} row={row} tz={tz} /></li>)}</ol>
    </details>
  );
}

export interface OutputFlags { canDefine: boolean; canSubmit: boolean; viewerIsAssignee: boolean; canReview: boolean; readOnly: boolean }

/** The expected output beside the action the assignee needs to take: what is expected, what is missing, the current version with its times, and the buttons that apply to this person. */
export function TaskOutputSection({ projectId, task, row, tz, files, flags, focusVersionId }: {
  focusVersionId?: string; projectId: string; task: { id: string; version: number; status: string }; row: RegisterRow | null; tz: string | null; files: { id: string; name: string; kind: "file" | "link" }[] | null; flags: OutputFlags;
}) {
  if (!row) {
    if (!flags.canDefine || flags.readOnly) return null;
    return <section aria-label="Expected output" className="rounded-md border border-dashed border-border p-3" data-testid="task-output"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">No expected output set for this task.</p><ExpectedOutputDialog projectId={projectId} taskId={task.id} taskVersion={task.version} current={null} /></div></section>;
  }
  const cur = row.current;
  const open = !["done", "cancelled", "deferred"].includes(task.status);
  // Whether THIS reader may decide the current version is the database's answer (`can_decide`): the screen shows what the database would allow.
  const focus = focusVersionId && cur ? row.versions.find((v) => v.id === focusVersionId) ?? null : null;
  const mayDecide = cur ? (cur.can_decide ?? flags.canReview) : flags.canReview;
  return (
    <section aria-label="Expected output" className="space-y-2 rounded-md border border-border p-3" data-testid="task-output">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Expected output</h3>
        <span className="text-sm">{row.output_qty && row.output_qty > 1 ? `${row.output_qty} × ` : ""}{row.output_label}</span>
        <OsBadge tone={row.output_required ? "blue" : "quiet"}>{row.output_required ? "Required" : "Optional"}</OsBadge>
        <OutputStateBadge state={row.state} />
      </div>
      <p className="text-sm font-medium" data-testid="task-output-next">{nextOutputAction(row, { isAssignee: flags.viewerIsAssignee, isReviewer: mayDecide })}</p>
      {focus && cur && focus.id !== cur.id ? <Alert variant="warning" role="status" data-testid="output-version-stale">Version {focus.version_no} is no longer the current one: version {cur.version_no} was submitted after it. What is shown and reviewed here is version {cur.version_no}; a link to an older version never approves a newer one.</Alert> : null}
      {cur?.needs_reviewer ? <Alert variant="warning" role="status" data-testid="output-needs-reviewer"><p className="font-medium">Needs an Operations reviewer</p><p className="text-[13px]">{NEEDS_REVIEWER_HELP} <Link href="/people-access" className="underline">Open People &amp; Access</Link>.</p></Alert> : null}
      {cur ? <VersionBody v={cur} row={row} tz={tz} /> : null}
      {!flags.readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          {flags.canSubmit && open ? <SubmitVersionDialog projectId={projectId} taskId={task.id} label={row.output_label} expected={row.output_qty ?? 1} nextNo={(cur?.version_no ?? 0) + 1} files={files} /> : null}
          {mayDecide && cur && cur.status === "awaiting" && cur.is_current !== false ? <DecideDialog projectId={projectId} versionId={cur.id} versionNo={cur.version_no} label={row.output_label} /> : null}
          {cur && cur.status === "awaiting" && cur.can_assign ? <AssignReviewerDialog projectId={projectId} versionId={cur.id} versionNo={cur.version_no} current={cur.reviewer_id ?? ""} eligible={cur.eligible_reviewers ?? []} /> : null}
          {flags.canDefine && open ? <ExpectedOutputDialog projectId={projectId} taskId={task.id} taskVersion={task.version} current={{ label: row.output_label, qty: row.output_qty, required: row.output_required }} /> : null}
        </div>
      ) : null}
      {row.versions.length > 1 ? <VersionHistory row={row} tz={tz} /> : null}
    </section>
  );
}

/** The Deliverables view of Project Plan: the same records as the task panel, grouped by activation, with filters, a compact version history and the export. */
export function RegisterView({ projectId, register, filter, rows, isReviewer, feedback, activations, hrefFor }: {
  projectId: string; register: Register; filter: RegisterFilter; rows: RegisterRow[]; isReviewer: (r: RegisterRow) => boolean;
  feedback: { id: string; name: string }[]; activations: { id: string; name: string }[]; hrefFor: (f: RegisterFilter) => string;
}) {
  const counts = registerCounts(register.rows);
  const groups = groupByActivation(rows);
  return (
    <div className="space-y-4" data-testid="deliverables-register">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">Every task with an expected output, from the same records as the task panel. Times are shown in the project&apos;s time zone and always name it. Open and Download follow each file&apos;s own access: a restricted file shows as restricted to anyone but the Project Manager.</p>
        <a href={`/api/projects/${projectId}/deliverables/export`} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="deliverables-export"><Download className="h-4 w-4" aria-hidden /> Export register (CSV)</a>
      </div>
      <nav aria-label="Filter deliverables" className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1 w-fit">
        {REGISTER_FILTERS.map((f) => <Link key={f.key} href={hrefFor(f.key)} aria-current={filter === f.key ? "page" : undefined} data-testid={`deliverables-filter-${f.key}`} className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${filter === f.key ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{f.label}<span className="text-[12px] text-muted-foreground">{counts[f.key]}</span></Link>)}
      </nav>
      {register.rows.length === 0 ? (
        <EmptyState title="No expected outputs yet" description="Set an expected output on a task (one moodboard, three videos, an app build) and it appears here with its versions and reviews." />
      ) : rows.length === 0 ? (
        <Muted>Nothing matches this filter.</Muted>
      ) : groups.map((g) => (
        <section key={g.key} aria-label={g.title} className="os-card" data-testid={`deliverables-group-${g.key}`}>
          <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">{g.title}</h3>
          <ul className="divide-y divide-border/70">
            {g.rows.map((r) => (
              <li key={r.task_id} className="space-y-1.5 px-4 py-3" data-testid={`deliverable-${r.task_id}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="min-w-0 break-words text-sm font-medium">{r.output_qty && r.output_qty > 1 ? `${r.output_qty} × ` : ""}{r.output_label}</p>
                  <OutputStateBadge state={r.state} />
                  {r.output_required ? <OsBadge tone="blue">Required</OsBadge> : null}
                  {r.current ? <span className="text-[13px] text-muted-foreground">Version {r.current.version_no}{quantityText(r, r.current) ? ` · ${quantityText(r, r.current)}` : ""}</span> : null}
                </div>
                <p className="break-words text-[13px] text-muted-foreground">Task: <Link href={`/projects/${projectId}/work?task=${r.task_id}`} className="underline-offset-4 hover:underline">{r.task_title}</Link> · Owner {r.assignee_name ?? "not named"}{r.milestone ? ` · Milestone ${r.milestone.title}` : ""}</p>
                {r.current ? <VersionBody v={r.current} row={r} tz={register.tz} linkFeedback={(r.current?.can_decide ?? isReviewer(r)) ? <LinkFeedbackDialog projectId={projectId} versionId={r.current.id} feedback={feedback} activations={activations} /> : null} /> : null}
                <p className="text-[13px] font-medium">{nextOutputAction(r, { isAssignee: false, isReviewer: isReviewer(r) })}</p>
                {r.versions.length > 1 ? <VersionHistory row={r} tz={register.tz} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
