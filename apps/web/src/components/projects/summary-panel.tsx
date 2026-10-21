import { projectStatusLabel } from "@enginious-hr/domain";
import { HandoverStatusBadge } from "@/components/projects/badges";
import { Fact } from "@/components/projects/parts";
import { dateRangeText, formatDateTime } from "@/lib/projects/format";

export interface SummaryFacts {
  reference: string;
  companyName: string;
  kind: string;
  isOngoing: boolean;
  status: string;
  pmName: string;
  startDate: string | null;
  endDate: string | null;
}

/**
 * The authorised summary of a project and nothing else: what the directory shows to someone who is not working on it. Used by the
 * directory's side panel and by the project page of a summary-only viewer, so the two can never disagree about what is shown.
 * Details, tasks, discussion, files and milestones are not passed in, so they cannot be shown by mistake.
 */
export function SummaryPanel({ facts, handover }: { facts: SummaryFacts; handover?: { status: string; crm_reference: string; accepted_at: string | null } | null }) {
  return (
    <div className="space-y-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label="Reference">{facts.reference}</Fact>
        <Fact label="Company">{facts.companyName}</Fact>
        <Fact label="Type">{facts.kind === "client" ? "Client project" : facts.isOngoing ? "Internal project, ongoing" : "Internal project"}</Fact>
        <Fact label="Status">{projectStatusLabel(facts.status)}</Fact>
        <Fact label="Project Manager">{facts.pmName}</Fact>
        <Fact label="Dates">{dateRangeText(facts.startDate, facts.endDate)}</Fact>
      </dl>
      {handover ? (
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Sales handover</h3>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Sales reference">{handover.crm_reference}</Fact>
            <Fact label="Handover status"><HandoverStatusBadge status={handover.status} /></Fact>
            <Fact label="Accepted by the Project Manager">{handover.accepted_at ? formatDateTime(handover.accepted_at) : "Not yet"}</Fact>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
