import Link from "next/link";
import { redirect } from "next/navigation";
import { canDecideScope, canSeeCommercialEffects, isFinishedProject } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedbackStatusBadge } from "@/components/projects/badges";
import { Fact, Muted, Panel } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView, memberOptions } from "@/lib/projects/data";
import { dateText, formatDate, formatDateTime, isOverdue, todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { CommercialForm, DecideScopeChangeForm, ProposeScopeChangeForm, RecordFeedbackForm, UpdateFeedbackForm, WithdrawScopeChangeForm } from "./feedback-forms";

export const metadata = { title: "Feedback & changes" };

const SCOPE_STATUS: Record<string, string> = { proposed: "Proposed", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" };

export default async function ChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) return null;
  if (view.level !== "details") redirect(`/projects/${id}`);
  const { project } = view;
  const supabase = await createClient();
  const seeCommercial = canSeeCommercialEffects(ctx.grants, project.company_id);
  const canDecide = canDecideScope(ctx.grants, project.company_id);
  const finished = isFinishedProject(project.status);

  const [fb, sc, ms, dl, tk, handover, commercial] = await Promise.all([
    supabase.from("proj_feedback").select("*").eq("project_id", id).order("received_on", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("proj_scope_changes").select("*").eq("project_id", id).order("proposed_at", { ascending: false }),
    supabase.from("proj_milestones").select("id, title").eq("project_id", id).order("sort_order"),
    supabase.from("proj_deliverables").select("id, title").eq("project_id", id).order("title"),
    supabase.from("proj_tasks").select("id, title").eq("project_id", id).order("title"),
    project.handover_id ? supabase.from("proj_handovers").select("scope, accepted_at, crm_reference").eq("id", project.handover_id).maybeSingle() : Promise.resolve({ data: null }),
    seeCommercial ? supabase.from("proj_scope_change_commercial").select("*").eq("project_id", id) : Promise.resolve({ data: [] }),
  ]);
  const feedback = fb.data ?? [];
  const changes = sc.data ?? [];
  const milestones = (ms.data ?? []).map((m) => ({ id: m.id, label: m.title }));
  const deliverables = (dl.data ?? []).map((d) => ({ id: d.id, label: d.title }));
  const tasks = (tk.data ?? []).map((t) => ({ id: t.id, label: t.title }));
  const commercialBy = new Map((commercial.data ?? []).map((c) => [c.scope_change_id, c]));
  const people = memberOptions(view);
  const base = `/projects/${id}`;
  const today = todayIso();

  const targetLabel = (type: string, tid: string | null) => {
    if (type === "project" || !tid) return <span>The project as a whole</span>;
    if (type === "task") { const t = tasks.find((x) => x.id === tid); return <Link className="underline" href={`${base}/work/tasks/${tid}`}>Task: {t?.label ?? "removed"}</Link>; }
    if (type === "milestone") return <Link className="underline" href={`${base}/work`}>Milestone: {milestones.find((x) => x.id === tid)?.label ?? "removed"}</Link>;
    return <Link className="underline" href={`${base}/work`}>Deliverable: {deliverables.find((x) => x.id === tid)?.label ?? "removed"}</Link>;
  };

  return (
    <div className="space-y-6">
      <Alert role="note">Nothing here approves scope, price or a deadline by itself: not a chat message, not an attachment, not feedback being recorded. A scope change is approved only by someone with scope approval, with a reason, on this page.</Alert>

      <Panel
        title="Client feedback"
        description="What the client asked for, who is responsible and how it was resolved. A correction fixes something against what was agreed; a proposed change needs a scope decision below."
        actions={view.canManage && !finished ? <RecordFeedbackForm projectId={id} today={today} milestones={milestones} deliverables={deliverables} tasks={tasks} people={people} /> : null}
      >
        {feedback.length === 0 ? (
          <EmptyState dense title="No client feedback recorded" description={view.canManage ? "Record feedback when the client asks for a correction or a change, so it has a person responsible and a decision." : "The Project Manager records client feedback here."} />
        ) : (
          <ul className="space-y-3">
            {feedback.map((f) => {
              const open = f.status === "open" || f.status === "in_progress";
              const canUpdate = !finished && (view.canManage || (f.responsible_user_id === ctx.userId && view.standing.isMember));
              const linked = changes.find((c) => c.id === f.scope_change_id);
              return (
                <li key={f.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <FeedbackStatusBadge status={f.status} />
                    <Badge variant="outline" className="whitespace-nowrap">{f.kind === "in_scope_correction" ? "Correction to what was agreed" : "Proposed change"}</Badge>
                    {isOverdue(f.due_date, open) ? <Badge variant="outline" className="border-destructive/40 text-destructive">Overdue</Badge> : null}
                    <span className="ml-auto flex gap-2">
                      {canUpdate ? <UpdateFeedbackForm projectId={id} feedbackId={f.id} version={f.version} status={f.status} resolution={f.resolution} evidenceNote={f.evidence_note} responsibleUserId={f.responsible_user_id} dueDate={f.due_date} canReassign={view.canManage} people={people} /> : null}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">{f.request_text}</p>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Fact label="From">{f.source}</Fact>
                    <Fact label="Received">{formatDate(f.received_on)}</Fact>
                    <Fact label="About">{targetLabel(f.target_type, f.target_id)}</Fact>
                    <Fact label="Responsible">{f.responsible_user_id ? view.nameOf(f.responsible_user_id) : "Nobody yet"}</Fact>
                    <Fact label="Deadline">{dateText(f.due_date)}</Fact>
                    {f.resolution ? <Fact label={`Resolution${f.resolved_at ? ` (${formatDateTime(f.resolved_at)})` : ""}`} className="sm:col-span-2">{f.resolution}</Fact> : null}
                    {f.evidence_note ? <Fact label="Evidence">{f.evidence_note}</Fact> : null}
                    {linked ? <Fact label="Scope change">{linked.title} ({SCOPE_STATUS[linked.status] ?? linked.status})</Fact> : null}
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Scope"
        description="The original agreed scope is kept exactly as it was handed over. Approved changes replace the current scope; the original and every decision stay on record."
        actions={view.canManage && !finished ? <ProposeScopeChangeForm projectId={id} currentScope={view.details?.scope ?? null} feedback={feedback.filter((f) => f.kind === "proposed_change" && !f.scope_change_id).map((f) => ({ id: f.id, label: `${formatDate(f.received_on)}: ${f.request_text.slice(0, 60)}` }))} /> : null}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Original agreed scope</h3>
            {project.kind === "client" ? (
              handover.data ? (
                <>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{handover.data.scope ?? "No scope was written in the handover."}</p>
                  <Muted className="mt-1">From the accepted handover{handover.data.accepted_at ? `, ${formatDateTime(handover.data.accepted_at)}` : ""}. It cannot be edited.</Muted>
                </>
              ) : <Muted className="mt-1">The handover record is not available to you.</Muted>
            ) : <Muted className="mt-1">An internal project has no handover. Its scope is edited directly and every edit is kept in the history.</Muted>}
          </div>
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Current scope</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{view.details?.scope ?? "No scope written."}</p>
          </div>
        </div>
      </Panel>

      <Panel title="Scope change proposals" description={seeCommercial ? "You have commercial access, so the cost effect of each proposal is shown." : "Cost effects are recorded in a restricted area and are visible only to people with commercial access."}>
        {changes.length === 0 ? (
          <EmptyState dense title="No scope changes proposed" description="When the client asks for something outside the agreed scope, the Project Manager proposes a change here so it can be decided." />
        ) : (
          <ul className="space-y-3">
            {changes.map((c) => {
              const cost = commercialBy.get(c.id);
              const proposed = c.status === "proposed";
              return (
                <li key={c.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={c.status === "approved" ? "border-emerald-500/40 text-emerald-800 dark:text-emerald-300" : c.status === "proposed" ? "border-amber-500/40 text-amber-800 dark:text-amber-300" : "text-muted-foreground"}>{SCOPE_STATUS[c.status] ?? c.status}</Badge>
                    <h3 className="text-sm font-semibold">{c.title}</h3>
                    <span className="ml-auto flex flex-wrap gap-2">
                      {proposed && canDecide && !finished ? <DecideScopeChangeForm projectId={id} scopeChangeId={c.id} /> : null}
                      {proposed && view.canManage && !finished ? <WithdrawScopeChangeForm projectId={id} scopeChangeId={c.id} /> : null}
                      {seeCommercial && !finished ? <CommercialForm projectId={id} scopeChangeId={c.id} currency={cost?.currency ?? null} amount={cost?.amount ?? null} note={cost?.note ?? null} /> : null}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Fact label="Proposed scope" className="sm:col-span-2"><span className="whitespace-pre-wrap">{c.proposed_scope}</span></Fact>
                    <Fact label="Effect on dates">{c.effect_on_dates ?? "Not stated"}</Fact>
                    <Fact label="Proposed">{view.nameOf(c.proposed_by)}, {formatDateTime(c.proposed_at)}</Fact>
                    {c.decided_at ? <Fact label="Decision">{c.status === "approved" ? "Approved" : "Rejected"} by {view.nameOf(c.decided_by)}, {formatDateTime(c.decided_at)}</Fact> : null}
                    {c.decision_note ? <Fact label="Reason">{c.decision_note}</Fact> : null}
                    {seeCommercial ? <Fact label="Cost effect">{cost ? `${cost.currency ?? ""} ${cost.amount ?? ""} ${cost.note ?? ""}`.trim() || "Recorded without detail" : "Not recorded"}</Fact> : null}
                  </dl>
                  {proposed && !canDecide ? <Muted className="mt-2">Waiting for someone with scope approval to decide.</Muted> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
