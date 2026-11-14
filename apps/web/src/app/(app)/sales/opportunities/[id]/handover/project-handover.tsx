import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { HandoverBrief } from "@/components/projects/handover-brief";
import { HandoverStatusBadge } from "@/components/projects/badges";
import { Muted } from "@/components/projects/parts";
import { formatDate, formatDateTime } from "@/components/sales/format";
import { HANDOVER_STATUS_LABELS } from "@enginious-hr/domain";
import { LoadError } from "@/components/workspace/states";
import { isNotInstalled } from "@/lib/projects/errors";
import { createClient } from "@/lib/supabase/server";
import type { ProjHandoverRow, ProjHandoverStatusRow } from "@/types/projects";
import { Panel } from "../parts";
import { HandoverReadiness } from "./handover-readiness";
import { ProjectHandoverForm, WithdrawProjectHandoverForm, type BriefValues } from "./project-handover-forms";
import { handoverReadiness } from "./readiness";

export interface ProjectHandoverState {
  installed: boolean;
  /** The read itself failed (not "not installed" and not "nothing prepared yet"): nothing about the handover is known, so nothing is offered. */
  failed?: boolean;
  status: ProjHandoverStatusRow | null;
  row: ProjHandoverRow | null;
}

/** Reads the Projects handover for an opportunity. A missing table or function reads as "not installed"; any OTHER failure is `failed` (never "nothing prepared yet"). */
export async function loadProjectHandover(opportunityId: string): Promise<ProjectHandoverState> {
  try {
    const supabase = await createClient();
    const [statusRes, rowRes] = await Promise.all([
      supabase.rpc("proj_handover_for_opportunity", { p_opportunity_id: opportunityId }),
      supabase.from("proj_handovers").select("*").eq("crm_opportunity_id", opportunityId).neq("status", "withdrawn").maybeSingle(),
    ]);
    if (isNotInstalled(statusRes.error) || isNotInstalled(rowRes.error)) return { installed: false, status: null, row: null };
    if (statusRes.error || rowRes.error) {
      console.error("[crm] project handover read failed", statusRes.error?.message ?? rowRes.error?.message);
      return { installed: true, failed: true, status: null, row: null };
    }
    return { installed: true, status: statusRes.data?.[0] ?? null, row: (rowRes.data as ProjHandoverRow | null) ?? null };
  } catch (e) {
    console.error("[crm] project handover read threw", e);
    return { installed: true, failed: true, status: null, row: null };
  }
}

const NEXT: Record<string, string> = {
  draft: "Not submitted yet. Nobody in delivery is told until you submit it.",
  submitted: "Submitted. A founder, an Operations Manager or someone who can assign Project Managers names the Project Manager next.",
  pm_assigned: "The Project Manager has it and will accept it or ask you to clarify.",
  clarification_requested: "The Project Manager asked a question. Update the brief if needed, then resubmit.",
  accepted: "Accepted. The project exists; this brief is kept as the agreed snapshot and can no longer be edited.",
};

/** What the page knows about the enquiry that the brief does not carry: the linked event edition, how many contacts it has (null = could not be read) and its own open points. */
export interface HandoverFacts { edition: string | null; contactCount: number | null; salesGaps?: readonly string[] }

/**
 * The Projects handover as Sales sees it, in the order the work happens: where it stands and who acts next, the project once it exists, whether it is ready and what it
 * carries, then the brief. The read-only brief is the SAME component the Project Manager reads under Projects, Handovers (`HandoverBrief`), so the two sides show the same
 * details in the same order; the edit form follows that order too. One primary button at a time: Save and submit (or resubmit) while it is with Sales, Open the project
 * once accepted. Withdraw is secondary, with what it does in words.
 */
export function ProjectHandoverPanel({
  state, opportunityId, canEdit, defaults, personName, facts,
}: { state: ProjectHandoverState; opportunityId: string; canEdit: boolean; defaults: BriefValues; personName: (id: string | null) => string; facts?: HandoverFacts }) {
  if (!state.installed) {
    return (
      <Panel title="Project handover (Projects & Tasks)">
        <Muted>Projects &amp; Tasks is not installed in this environment yet, so a project handover cannot be prepared here. The Sales handover above is unaffected.</Muted>
      </Panel>
    );
  }
  if (state.failed) {
    return (
      <Panel title="Project handover (Projects & Tasks)">
        <LoadError what="the project handover" retryHref={`/sales/opportunities/${opportunityId}/handover`} note="It is not empty: it could not be read, so nothing can be saved, submitted or withdrawn here until it loads." />
      </Panel>
    );
  }
  const { status, row } = state;
  const st = status?.status ?? null;
  const editable = canEdit && (!st || ["draft", "submitted", "clarification_requested"].includes(st));
  const values: BriefValues = row
    ? {
        title: row.title, clientName: row.client_name ?? "", location: row.location ?? "", siteTimezone: row.site_timezone, installStart: row.install_start ?? "",
        eventStart: row.event_start ?? "", eventEnd: row.event_end ?? "", scope: row.scope ?? "", exclusions: row.exclusions ?? "", notes: row.notes ?? "", technologies: row.technologies, risks: (row.risks ?? []).filter((r): r is string => typeof r === "string"),
      }
    : defaults;
  // Ready / what transfers: from the saved brief when there is one (that is what will be submitted), otherwise from the enquiry's facts the form opens with. Shown to
  // whoever can read the brief; someone who sees only its status (not the preparer, not a founder) is not shown values that may not be the saved ones.
  const phase = st === "accepted" ? "accepted" : st === "submitted" || st === "pm_assigned" ? "submitted" : "preparing";
  const readiness = row || (!st && canEdit)
    ? handoverReadiness({
        brief: values, saved: Boolean(row), formatDate,
        // A saved brief carries its own copy of the edition (taken by the database); before the first save the enquiry's linked edition is what will be copied.
        edition: row ? (row.edition_snapshot ? (row.edition_snapshot.label ?? row.edition_snapshot.event_name ?? "Edition without a name") : null) : (facts?.edition ?? null),
        contactCount: facts ? facts.contactCount : null, salesGaps: facts?.salesGaps,
      })
    : null;
  const projectHref = status?.project_id ? `/projects/${status.project_id}` : null;
  // Once it is with Projects the brief itself is the thing to read, and editing is the exception: the form is tucked behind one click so the page has no second primary button.
  const waiting = st === "submitted";

  return (
    <Panel
      title="Project handover (Projects & Tasks)"
      description="The delivery brief for the Project Manager. Submitting it starts delivery: the Project Manager accepts it, which creates the project."
      actions={st ? <HandoverStatusBadge status={st} /> : null}
    >
      <div className="space-y-5">
        {st ? (
          <div className="space-y-1 text-sm" data-testid="handover-next">
            <p className="font-medium">{NEXT[st] ?? HANDOVER_STATUS_LABELS[st]}</p>
            {status?.pm_name ? <p className="text-muted-foreground">Project Manager: {status.pm_name}</p> : null}
            {row?.submitted_at ? <p className="text-muted-foreground">Submitted {formatDateTime(row.submitted_at)} by {personName(row.prepared_by)}.</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No project handover has been prepared yet.{canEdit ? " Review the brief below (taken from this opportunity's non-commercial facts), then save and submit it." : ""}</p>
        )}
        {status?.clarification_note && st === "clarification_requested" ? <Alert variant="warning" role="status">The Project Manager asked: “{status.clarification_note}”</Alert> : null}
        {st === "accepted" && projectHref ? (
          <div className="flex flex-wrap items-center gap-3" data-testid="handover-project">
            <Link href={projectHref} className={buttonVariants({ size: "sm" })}>
              Open {status?.project_reference ?? "the project"}
            </Link>
            <span className="text-sm text-muted-foreground">One project exists for this enquiry. Submitting or accepting again opens this same project, never a second one.</span>
          </div>
        ) : null}

        {readiness ? <HandoverReadiness readiness={readiness} phase={phase} /> : null}

        {editable ? (
          <>
            {row ? (
              <details open={waiting} data-testid="handover-brief-preview">
                <summary className="cursor-pointer text-sm font-medium">{waiting ? "The brief, as the Project Manager sees it" : "Preview the saved brief, as the Project Manager will see it"}</summary>
                <div className="mt-3 space-y-2">
                  <p className="text-sm"><span className="text-muted-foreground">Project name: </span><span className="break-words font-medium">{row.title}</span></p>
                  <HandoverBrief h={row} />
                </div>
              </details>
            ) : null}
            {waiting ? (
              <details data-testid="handover-edit-submitted">
                <summary className="cursor-pointer text-sm font-medium">Edit the submitted brief</summary>
                <div className="mt-3 space-y-3">
                  <Muted>It is submitted and waiting. Changes you save are seen by whoever picks it up; nobody is notified again.</Muted>
                  <ProjectHandoverForm key={`${row!.id}-${row!.version}`} opportunityId={opportunityId} version={row!.version} values={values} existing submitMode={null} />
                </div>
              </details>
            ) : (
              <ProjectHandoverForm key={row ? `${row.id}-${row.version}` : "new"} opportunityId={opportunityId} version={row?.version ?? null} values={values} existing={Boolean(row)} submitMode={!st || st === "draft" ? "submit" : st === "clarification_requested" ? "resubmit" : null} />
            )}
            {row ? <WithdrawProjectHandoverForm handoverId={row.id} opportunityId={opportunityId} /> : null}
          </>
        ) : row ? (
          <details open data-testid="handover-brief-preview">
            <summary className="cursor-pointer text-sm font-medium">{st === "accepted" ? "The accepted brief (kept as agreed, read-only)" : "The brief, as the Project Manager sees it"}</summary>
            <div className="mt-3 space-y-2">
              <p className="text-sm"><span className="text-muted-foreground">Project name: </span><span className="break-words font-medium">{row.title}</span></p>
              <HandoverBrief h={row} />
            </div>
          </details>
        ) : st ? (
          <Muted>The brief itself is visible to the person who prepared it and to founders.</Muted>
        ) : !canEdit ? (
          <Muted>Only the opportunity&apos;s owner or a Sales founder can prepare the project handover.</Muted>
        ) : null}
      </div>
    </Panel>
  );
}
