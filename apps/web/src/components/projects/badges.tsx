import { DELIVERABLE_STATUS_LABELS, FEEDBACK_STATUS_LABELS, HANDOVER_STATUS_LABELS, MILESTONE_STATUS_LABELS, PRIORITY_LABELS, TASK_STATUS_LABELS, BOOKING_STATE_LABELS, projectStatusLabel } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";

import { OsPill, type OsTone } from "@/components/os/pills";

/** Status word -> the tone of its pill: a coloured dot and the words, never colour alone. */
const TONES: Record<string, OsTone> = {
  // project
  planning: "neutral", in_progress: "cyan", ready_for_installation: "blue", on_site: "blue", on_hold: "amber", completed: "quiet", archived: "neutral",
  // task / deliverable / milestone / feedback / booking shared words
  todo: "neutral", open: "neutral", planned: "neutral", ready_for_review: "blue", ready_for_acceptance: "blue", accepted: "quiet", done: "quiet", cancelled: "neutral", deferred: "neutral",
  resolved: "quiet", declined: "neutral", tentative: "amber", confirmed: "quiet",
  // handover
  draft: "neutral", submitted: "amber", pm_assigned: "amber", clarification_requested: "red", withdrawn: "neutral",
};

export const statusTone = (status: string): OsTone => TONES[status] ?? "neutral";

function StatusPill({ status, label }: { status: string; label: string }) {
  return <OsPill tone={TONES[status] ?? "neutral"} className="whitespace-nowrap">{label}</OsPill>;
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
  return <OsPill tone={priority === "urgent" || priority === "high" ? "amber" : "neutral"}>{PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS] ?? priority} priority</OsPill>;
}

export function KindBadge({ kind, ongoing }: { kind: string; ongoing?: boolean }) {
  return <Badge variant="outline" className="whitespace-nowrap text-muted-foreground">{kind === "client" ? "Client project" : ongoing ? "Internal, ongoing" : "Internal"}</Badge>;
}

export const BlockedBadge = () => <OsPill tone="red">Blocked</OsPill>;
