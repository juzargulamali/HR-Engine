import { notFound, redirect } from "next/navigation";
import { COMPLETION_EVIDENCE_TYPES, hasProjCapability } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HandoverStatusBadge } from "@/components/projects/badges";
import { Fact, Muted, Panel } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { dateRangeText, dateText, formatDateTime } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { resolutionSummary } from "../overview-helpers";
import { describeChange } from "./change-log";

export const metadata = { title: "Project history" };

const LOG_LIMIT = 100;
const ACTION_WORDS: Record<string, string> = { cancel: "Cancelled", defer: "Deferred", resolve: "Resolved", decline: "Declined" };

export default async function ProjectHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details") redirect(`/projects/${id}`);
  const { project } = view;
  const supabase = await createClient();

  const [handoverR, completionsR, logR] = await Promise.all([
    project.kind === "client" ? supabase.from("proj_handovers").select("*").eq("project_id", id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("proj_completions").select("*").eq("project_id", id).order("completed_at", { ascending: false }),
    supabase.from("proj_change_log").select("id, entity_type, entity_id, field, from_value, to_value, note, actor_id, created_at").eq("project_id", id).order("id", { ascending: false }).limit(LOG_LIMIT),
  ]);
  const handover = handoverR.data;
  const completions = completionsR.data ?? [];
  const log = logR.data ?? [];

  // Titles for the things the log mentions (they may have been renamed since; the current title is shown).
  const idsOf = (type: string) => [...new Set(log.filter((l) => l.entity_type === type).map((l) => l.entity_id))];
  const titleMap = new Map<string, string>();
  const lookups: [string, "proj_milestones" | "proj_deliverables" | "proj_plan_items" | "proj_external_dependencies", string][] = [
    ["milestone", "proj_milestones", "title"], ["deliverable", "proj_deliverables", "title"], ["plan_item", "proj_plan_items", "title"], ["external_dependency", "proj_external_dependencies", "label"],
  ];
  await Promise.all(
    lookups.map(async ([type, table, col]) => {
      const ids = idsOf(type);
      if (ids.length === 0) return;
      const { data } = await supabase.from(table).select(`id, ${col}`).in("id", ids);
      for (const row of (data ?? []) as unknown as Record<string, string>[]) titleMap.set(`${type}:${row.id}`, row[col] as string);
    }),
  );
  const ctxDescribe = { entityName: (t: string, i: string) => titleMap.get(`${t}:${i}`) ?? null, nameOf: view.nameOf };
  const canSeeAudit = hasProjCapability(ctx.grants, project.company_id, "view_audit");

  return (
    <div className="space-y-5">
      {project.kind === "client" ? (
        <Panel title="Sales handover" description="What was agreed when the Project Manager accepted the handover. It is a historical snapshot: later changes in Sales & CRM never alter it.">
          {!handover ? (
            <EmptyState dense title="No handover record" description="This project has no linked Sales handover." />
          ) : (
            <div className="space-y-4">
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Fact label="Sales reference">{handover.crm_reference}</Fact>
                <Fact label="Status"><HandoverStatusBadge status={handover.status} /></Fact>
                <Fact label="Prepared by">{view.nameOf(handover.prepared_by)}</Fact>
                <Fact label="Submitted">{handover.submitted_at ? formatDateTime(handover.submitted_at) : "—"}</Fact>
                <Fact label="Project Manager named">{handover.pm_assigned_at ? `${formatDateTime(handover.pm_assigned_at)} by ${view.nameOf(handover.pm_assigned_by)}` : "—"}</Fact>
                <Fact label="Accepted">{handover.accepted_at ? `${formatDateTime(handover.accepted_at)} by ${view.nameOf(handover.accepted_by)}` : "—"}</Fact>
                <Fact label="Revisions">{handover.revision}</Fact>
              </dl>
              <div className="border-t border-border pt-4">
                <h3 className="mb-3 text-sm font-semibold">The brief as agreed</h3>
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Fact label="Title">{handover.title}</Fact>
                  <Fact label="Client">{handover.client_name ?? "Not recorded"}</Fact>
                  <Fact label="Location">{handover.location ?? "Not recorded"}</Fact>
                  <Fact label="Site time zone">{handover.site_timezone}</Fact>
                  <Fact label="Installation starts">{dateText(handover.install_start)}</Fact>
                  <Fact label="Event">{dateRangeText(handover.event_start, handover.event_end)}</Fact>
                </dl>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div><h4 className="text-sm font-medium">Scope of work</h4><p className="mt-1 whitespace-pre-wrap text-sm">{handover.scope ?? "Not recorded."}</p></div>
                  <div><h4 className="text-sm font-medium">Exclusions</h4><p className="mt-1 whitespace-pre-wrap text-sm">{handover.exclusions ?? "None recorded."}</p></div>
                </div>
                {handover.technologies.length > 0 ? (
                  <ul className="mt-4 flex flex-wrap gap-2">{handover.technologies.map((t, i) => <li key={`${t.name}-${i}`} className="rounded-full border border-border px-2.5 py-0.5 text-sm">{t.name} × {t.qty}</li>)}</ul>
                ) : null}
                {handover.notes ? <p className="mt-4 whitespace-pre-wrap text-sm"><span className="font-medium">Notes from Sales: </span>{handover.notes}</p> : null}
              </div>
              <Muted>Commercial details are not part of this record. They stay in Sales &amp; CRM.</Muted>
            </div>
          )}
        </Panel>
      ) : null}

      <Panel title="Completion and reopening" description="Every completion is kept, including ones that were later reopened.">
        {completions.length === 0 ? (
          <EmptyState dense title="Not completed" description="A completion is recorded here, with its evidence, when the project is completed." />
        ) : (
          <ol className="space-y-5">
            {completions.map((c) => (
              <li key={c.id} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Completed {formatDateTime(c.completed_at)} by {view.nameOf(c.completed_by)}</span>
                  {c.reopened_at ? <Badge variant="outline" className="whitespace-nowrap">Reopened</Badge> : <Badge variant="outline" className="whitespace-nowrap border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">Current</Badge>}
                </div>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Fact label="Evidence">{COMPLETION_EVIDENCE_TYPES.find((e) => e.id === c.evidence_type)?.label ?? "Internal completion note"}</Fact>
                  {c.evidence_reference ? <Fact label="Reference">{c.evidence_reference}</Fact> : null}
                  {c.confirmed_on ? <Fact label="Client confirmed on">{dateText(c.confirmed_on)}</Fact> : null}
                  {c.client_contact ? <Fact label="Confirmed by">{c.client_contact}</Fact> : null}
                </dl>
                <p className="mt-3 whitespace-pre-wrap text-sm">{c.completion_note}</p>
                <p className="mt-2 text-sm text-muted-foreground">{resolutionSummary(c.resolutions)}</p>
                {c.resolutions.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {c.resolutions.map((r, i) => <li key={`${r.id}-${i}`}><span className="font-medium">{ACTION_WORDS[r.action] ?? r.action} {r.kind}:</span> <span className="text-muted-foreground">{r.note}</span></li>)}
                  </ul>
                ) : null}
                {c.reopened_at ? (
                  <p className="mt-3 border-t border-border pt-3 text-sm">
                    <span className="font-medium">Reopened {formatDateTime(c.reopened_at)} by {view.nameOf(c.reopened_by)}:</span> {c.reopen_reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Change log" description={`Dates, status, ownership and people, newest first. Showing the latest ${LOG_LIMIT} changes at most.`}>
        {log.length === 0 ? (
          <EmptyState dense title="No changes recorded yet" description="Changes to dates, status, the Project Manager and the people on the project appear here as they happen." />
        ) : (
          <ol className="divide-y divide-border">
            {log.map((l) => {
              const d = describeChange(l, ctxDescribe);
              return (
                <li key={l.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium">{d.subject}</span>
                    <span className="text-muted-foreground">{formatDateTime(l.created_at)} · {l.actor_id ? view.nameOf(l.actor_id) : "System"}</span>
                  </div>
                  <p>{d.sentence}</p>
                  {l.note ? <p className="text-muted-foreground">Reason: {l.note}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
        {log.length >= LOG_LIMIT ? <Muted className="mt-3">Older changes are not shown here.</Muted> : null}
        {canSeeAudit ? <Muted className="mt-3">You can read the full audit trail of this company&apos;s projects. It is a separate record and is not shown on this page.</Muted> : null}
      </Panel>
    </div>
  );
}
