import { AVAILABILITY_LABELS, commercialApprovalLabel, crmStageLabel, daysOverdue, followUpTiming, type ApprovalPolicy, type ApprovalState, type AvailabilityDisplay } from "@enginious-hr/domain";
import { OsBadge, type OsTone } from "@/components/os/pills";
import { cn } from "@/lib/utils";
import { formatDateTime } from "./format";

// Early stages are plain, work in progress is blue, a decision is teal, a pause is amber; won is green and lost is quiet. The words always say the stage.
const STAGE_TONE: Record<string, OsTone> = {
  new: "neutral", qualified: "cyan", proposal_prep: "blue", proposal_sent: "blue", quote_sent: "blue", negotiation: "cyan",
  on_hold: "amber", won: "green", lost: "quiet",
};

export function StageBadge({ stage }: { stage: string }) {
  return (
    <OsBadge tone={STAGE_TONE[stage] ?? "neutral"} dot={stage !== "lost"} className="whitespace-nowrap">
      {crmStageLabel(stage)}
    </OsBadge>
  );
}

const AVAILABILITY_TONE: Record<AvailabilityDisplay, OsTone> = {
  unverified: "quiet", awaiting: "blue", confirmed: "green", unavailable: "red", needs_recheck: "amber",
};

export function AvailabilityBadge({ state }: { state: AvailabilityDisplay }) {
  return (
    <OsBadge tone={AVAILABILITY_TONE[state]} dot={state !== "unverified"} className="whitespace-nowrap">
      {AVAILABILITY_LABELS[state]}
    </OsBadge>
  );
}

/** Never reads "Approved" unless a founder recorded it under a configured policy. */
export function ApprovalBadge({ policy, latest }: { policy: ApprovalPolicy; latest: { state: ApprovalState } | null }) {
  const { label, tone } = commercialApprovalLabel(policy, latest);
  const t: OsTone = tone === "positive" ? "green" : tone === "warning" ? "amber" : "quiet";
  return (
    <OsBadge tone={t} dot={t !== "quiet"} className="whitespace-nowrap">
      {label}
    </OsBadge>
  );
}

/** Due moment with its state in words (never colour alone). */
export function DueText({ dueAt, className }: { dueAt: string; className?: string }) {
  const timing = followUpTiming(dueAt);
  const days = daysOverdue(dueAt);
  return (
    <span className={cn("whitespace-nowrap max-sm:whitespace-normal", timing === "overdue" && "font-medium text-[hsl(var(--os-red))]", timing === "due_today" && "font-medium text-[hsl(var(--os-amber))]", className)}>
      {formatDateTime(dueAt)}
      {timing === "overdue" ? ` · overdue${days > 0 ? ` ${days}d` : ""}` : timing === "due_today" ? " · due today" : ""}
    </span>
  );
}
