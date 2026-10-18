import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { HandoverBrief } from "@/components/projects/handover-brief";
import { HandoverStatusBadge } from "@/components/projects/badges";
import { Muted } from "@/components/projects/parts";
import { formatDateTime } from "@/components/sales/format";
import { HANDOVER_STATUS_LABELS } from "@enginious-hr/domain";
import { isNotInstalled } from "@/lib/projects/errors";
import { createClient } from "@/lib/supabase/server";
import type { ProjHandoverRow, ProjHandoverStatusRow } from "@/types/projects";
import { Panel } from "../parts";
import { ProjectHandoverForm, SubmitProjectHandoverForm, WithdrawProjectHandoverForm, type BriefValues } from "./project-handover-forms";

export interface ProjectHandoverState {
  installed: boolean;
  status: ProjHandoverStatusRow | null;
  row: ProjHandoverRow | null;
}

/** Reads the Projects handover for an opportunity. A missing table or function reads as "not installed", never as an error page. */
export async function loadProjectHandover(opportunityId: string): Promise<ProjectHandoverState> {
  try {
    const supabase = await createClient();
    const [statusRes, rowRes] = await Promise.all([
      supabase.rpc("proj_handover_for_opportunity", { p_opportunity_id: opportunityId }),
      supabase.from("proj_handovers").select("*").eq("crm_opportunity_id", opportunityId).neq("status", "withdrawn").maybeSingle(),
    ]);
    if (isNotInstalled(statusRes.error) || isNotInstalled(rowRes.error)) return { installed: false, status: null, row: null };
    return { installed: true, status: statusRes.data?.[0] ?? null, row: (rowRes.data as ProjHandoverRow | null) ?? null };
  } catch {
    return { installed: false, status: null, row: null };
  }
}

const NEXT: Record<string, string> = {
  draft: "Not submitted yet. Nobody in delivery is told until you submit it.",
  submitted: "Submitted. A founder names the Project Manager next.",
  pm_assigned: "The Project Manager has it and will accept it or ask you to clarify.",
  clarification_requested: "The Project Manager asked a question. Update the brief if needed, then resubmit.",
  accepted: "Accepted. The project exists; this brief is kept as the agreed snapshot and can no longer be edited.",
};

export function ProjectHandoverPanel({
  state, opportunityId, canEdit, defaults, personName,
}: { state: ProjectHandoverState; opportunityId: string; canEdit: boolean; defaults: BriefValues; personName: (id: string | null) => string }) {
  if (!state.installed) {
    return (
      <Panel title="Project handover (Projects & Tasks)">
        <Muted>Projects &amp; Tasks is not installed in this environment yet, so a project handover cannot be prepared here. The Sales handover above is unaffected.</Muted>
      </Panel>
    );
  }
  const { status, row } = state;
  const st = status?.status ?? null;
  const editable = canEdit && (!st || ["draft", "submitted", "clarification_requested"].includes(st));
  const values: BriefValues = row
    ? {
        title: row.title, clientName: row.client_name ?? "", location: row.location ?? "", siteTimezone: row.site_timezone, installStart: row.install_start ?? "",
        eventStart: row.event_start ?? "", eventEnd: row.event_end ?? "", scope: row.scope ?? "", exclusions: row.exclusions ?? "", notes: row.notes ?? "", technologies: row.technologies,
      }
    : defaults;

  return (
    <Panel
      title="Project handover (Projects & Tasks)"
      description="The delivery brief for the Project Manager. Submitting it starts delivery: the Project Manager accepts it, which creates the project."
      actions={st ? <HandoverStatusBadge status={st} /> : null}
    >
      <div className="space-y-5">
        {st ? (
          <div className="space-y-1 text-sm">
            <p>{NEXT[st] ?? HANDOVER_STATUS_LABELS[st]}</p>
            {status?.pm_name ? <p className="text-muted-foreground">Project Manager: {status.pm_name}</p> : null}
            {row?.submitted_at ? <p className="text-muted-foreground">Submitted {formatDateTime(row.submitted_at)} by {personName(row.prepared_by)}.</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No project handover has been prepared yet.{canEdit ? " Review the brief below (taken from this opportunity's non-commercial facts), save it, then submit it." : ""}</p>
        )}
        {status?.clarification_note && st === "clarification_requested" ? <Alert variant="warning" role="status">The Project Manager asked: “{status.clarification_note}”</Alert> : null}
        {st === "accepted" && status?.project_id ? (
          <Link href={`/projects/${status.project_id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Open {status.project_reference ?? "the project"}
          </Link>
        ) : null}

        {editable ? (
          <>
            <ProjectHandoverForm key={row ? `${row.id}-${row.version}` : "new"} opportunityId={opportunityId} version={row?.version ?? null} values={values} existing={Boolean(row)} />
            {row && (st === "draft" || st === "clarification_requested") ? <div className="border-t border-border pt-4"><SubmitProjectHandoverForm handoverId={row.id} opportunityId={opportunityId} resubmit={st === "clarification_requested"} /></div> : null}
            {row && st === "submitted" ? <Muted>It is submitted and waiting. Changes you save are seen by whoever picks it up.</Muted> : null}
            {row ? <WithdrawProjectHandoverForm handoverId={row.id} opportunityId={opportunityId} /> : null}
          </>
        ) : row ? (
          <details open={st === "accepted"}>
            <summary className="cursor-pointer text-sm font-medium">Delivery brief</summary>
            <div className="mt-3"><HandoverBrief h={row} /></div>
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
