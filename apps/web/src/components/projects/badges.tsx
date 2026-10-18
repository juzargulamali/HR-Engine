import { DELIVERABLE_STATUS_LABELS, FEEDBACK_STATUS_LABELS, HANDOVER_STATUS_LABELS, MILESTONE_STATUS_LABELS, PRIORITY_LABELS, TASK_STATUS_LABELS, BOOKING_STATE_LABELS, projectStatusLabel } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const GREEN = "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
const AMBER = "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300";
const SKY = "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300";
const RED = "border-destructive/40 bg-destructive/10 text-destructive";
const GREY = "border-border bg-secondary text-muted-foreground";

const TONES: Record<string, string> = {
  // project
  planning: SKY, in_progress: SKY, ready_for_installation: SKY, on_site: SKY, on_hold: AMBER, completed: GREEN, archived: GREY,
  // task / deliverable / milestone / feedback / booking shared words
  todo: "", open: "", planned: "", ready_for_review: AMBER, ready_for_acceptance: AMBER, accepted: GREEN, done: GREEN, cancelled: GREY, deferred: GREY,
  resolved: GREEN, declined: GREY, tentative: AMBER, confirmed: GREEN,
  // handover
  draft: "", submitted: AMBER, pm_assigned: AMBER, clarification_requested: RED, withdrawn: GREY,
};

/** Every status shows its words, never colour alone. */
function StatusPill({ status, label }: { status: string; label: string }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap", TONES[status])}>{label}</Badge>;
}

export const ProjectStatusBadge = ({ status }: { status: string }) => <StatusPill status={status} label={projectStatusLabel(status)} />;
export const TaskStatusBadge = ({ status }: { status: string }) => <StatusPill status={status} label={TASK_STATUS_LABELS[status as keyof typeof TASK_STATUS_LABELS] ?? status} />;
export const MilestoneStatusBadge = ({ status }: { status: string }) => <StatusPill status={status} label={MILESTONE_STATUS_LABELS[status] ?? status} />;
export const DeliverableStatusBadge = ({ status }: { status: string }) => <StatusPill status={status} label={DELIVERABLE_STATUS_LABELS[status] ?? status} />;
export const FeedbackStatusBadge = ({ status }: { status: string }) => <StatusPill status={status} label={FEEDBACK_STATUS_LABELS[status] ?? status} />;
export const BookingStateBadge = ({ state }: { state: string }) => <StatusPill status={state} label={BOOKING_STATE_LABELS[state] ?? state} />;
export const HandoverStatusBadge = ({ status }: { status: string }) => <StatusPill status={status} label={HANDOVER_STATUS_LABELS[status] ?? status} />;

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "normal") return null;
  return <Badge variant="outline" className={cn("whitespace-nowrap", priority === "urgent" ? RED : priority === "high" ? AMBER : GREY)}>{PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS] ?? priority} priority</Badge>;
}

export function KindBadge({ kind, ongoing }: { kind: string; ongoing?: boolean }) {
  return <Badge variant="outline" className="whitespace-nowrap text-muted-foreground">{kind === "client" ? "Client project" : ongoing ? "Internal, ongoing" : "Internal"}</Badge>;
}

export const BlockedBadge = () => <Badge variant="outline" className={cn("whitespace-nowrap", RED)}>Blocked</Badge>;
