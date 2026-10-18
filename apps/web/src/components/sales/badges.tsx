import { AVAILABILITY_LABELS, commercialApprovalLabel, crmStageLabel, daysOverdue, followUpTiming, type ApprovalPolicy, type ApprovalState, type AvailabilityDisplay } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDateTime } from "./format";

const STAGE_TONE: Record<string, string> = {
  won: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  lost: "border-border bg-secondary text-muted-foreground",
  on_hold: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
};

export function StageBadge({ stage }: { stage: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", STAGE_TONE[stage])}>
      {crmStageLabel(stage)}
    </Badge>
  );
}

const AVAILABILITY_TONE: Record<AvailabilityDisplay, string> = {
  unverified: "text-muted-foreground",
  awaiting: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  confirmed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  unavailable: "border-destructive/40 bg-destructive/10 text-destructive",
  needs_recheck: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
};

export function AvailabilityBadge({ state }: { state: AvailabilityDisplay }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", AVAILABILITY_TONE[state])}>
      {AVAILABILITY_LABELS[state]}
    </Badge>
  );
}

/** Never reads "Approved" unless a founder recorded it under a configured policy. */
export function ApprovalBadge({ policy, latest }: { policy: ApprovalPolicy; latest: { state: ApprovalState } | null }) {
  const { label, tone } = commercialApprovalLabel(policy, latest);
  const cls = tone === "positive" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : tone === "warning" ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", cls)}>
      {label}
    </Badge>
  );
}

/** Due moment with its state in words (never colour alone). */
export function DueText({ dueAt, className }: { dueAt: string; className?: string }) {
  const timing = followUpTiming(dueAt);
  const days = daysOverdue(dueAt);
  return (
    <span className={cn("whitespace-nowrap", timing === "overdue" && "font-medium text-destructive", timing === "due_today" && "font-medium text-amber-800 dark:text-amber-300", className)}>
      {formatDateTime(dueAt)}
      {timing === "overdue" ? ` · overdue${days > 0 ? ` ${days}d` : ""}` : timing === "due_today" ? " · due today" : ""}
    </span>
  );
}
