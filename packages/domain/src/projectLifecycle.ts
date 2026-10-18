/**
 * Project lifecycle, labels and the rules the UI offers. Mirrors proj_set_status / proj_complete_project in
 * supabase/migrations/20261120000200_proj_projects_handover_functions.sql and ...500_proj_feedback_plans_files_completion.sql.
 * No progress is ever derived from elapsed time: progress is "accepted required milestones / required milestones" only.
 */

export const PROJECT_STATUSES = ["planning", "in_progress", "ready_for_installation", "on_site", "on_hold", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectKind = "client" | "internal";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planning",
  in_progress: "In progress",
  ready_for_installation: "Ready for installation",
  on_site: "On site",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};
export const projectStatusLabel = (s: string) => PROJECT_STATUS_LABELS[s as ProjectStatus] ?? s;

const RANK: Partial<Record<ProjectStatus, number>> = { planning: 1, in_progress: 2, ready_for_installation: 3, on_site: 4 };

export interface StatusMove {
  to: ProjectStatus | "resume";
  label: string;
  needsReason: boolean;
  needsReviewDate: boolean;
}

/** The live states a project of this kind can be in, in order. Internal projects skip installation and show states. */
export const liveStatusesFor = (kind: ProjectKind): ProjectStatus[] => (kind === "client" ? ["planning", "in_progress", "ready_for_installation", "on_site"] : ["planning", "in_progress"]);

/**
 * Moves offered from `status`. Forward one step is free; going back or skipping needs a reason; holding needs a reason and a
 * review date; Completed has its own action (it needs evidence); Archived only follows Completed.
 */
export function allowedStatusMoves(kind: ProjectKind, status: string): StatusMove[] {
  const live = liveStatusesFor(kind);
  if (status === "completed") return [{ to: "archived", label: "Archive", needsReason: false, needsReviewDate: false }];
  if (status === "archived") return [];
  if (status === "on_hold") return [{ to: "resume", label: "Resume", needsReason: false, needsReviewDate: false }];
  const from = RANK[status as ProjectStatus];
  if (from === undefined) return [];
  const moves: StatusMove[] = live
    .filter((s) => s !== status)
    .map((s) => ({
      to: s,
      label: `Move to ${projectStatusLabel(s)}`,
      needsReason: RANK[s] !== from + 1,
      needsReviewDate: false,
    }));
  moves.push({ to: "on_hold", label: "Put on hold", needsReason: true, needsReviewDate: true });
  return moves;
}

export const isFinishedProject = (status: string) => status === "completed" || status === "archived";

/** Progress with its stated basis. Returns null when there is nothing to measure (never an invented percentage). */
export function milestoneProgress(accepted: number, total: number): { accepted: number; total: number; percent: number; basis: string } | null {
  if (!total || total <= 0) return null;
  const a = Math.max(0, Math.min(accepted, total));
  return { accepted: a, total, percent: Math.round((a / total) * 100), basis: `${a} of ${total} required milestone${total === 1 ? "" : "s"} accepted` };
}

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

export const HANDOVER_STATUSES = ["draft", "submitted", "pm_assigned", "clarification_requested", "accepted", "withdrawn"] as const;
export const HANDOVER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Waiting for a Project Manager",
  pm_assigned: "Waiting for the PM to accept",
  clarification_requested: "Clarification requested",
  accepted: "Accepted: project created",
  withdrawn: "Withdrawn",
};

export const MILESTONE_STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  in_progress: "In progress",
  ready_for_acceptance: "Ready for acceptance",
  accepted: "Accepted",
  cancelled: "Cancelled",
  deferred: "Deferred",
};
export const DELIVERABLE_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  accepted: "Accepted",
  cancelled: "Cancelled",
  deferred: "Deferred",
};
export const FEEDBACK_STATUS_LABELS: Record<string, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved", declined: "Declined", deferred: "Deferred" };
export const BOOKING_STATE_LABELS: Record<string, string> = { tentative: "Tentative", confirmed: "Confirmed", cancelled: "Cancelled" };
export const DEPENDENCY_KIND_LABELS: Record<string, string> = {
  structure_ready: "Structure ready",
  power_network: "Power / network",
  access_permitted: "Access permitted",
  standbuilder_complete: "Standbuilder work complete",
  other: "Other",
};
export const CONFIRMATION_LABELS: Record<string, string> = { pending: "Not yet confirmed", confirmed: "Confirmed", not_possible: "Not possible" };

export const COMPLETION_EVIDENCE_TYPES = [
  { id: "email_reference", label: "E-mail reference", hint: "Date, sender and subject of the client's confirming e-mail." },
  { id: "signed_handover", label: "Signed handover", hint: "Reference of the signed handover document." },
  { id: "uploaded_confirmation", label: "Uploaded confirmation", hint: "A file you added to Documents as completion evidence." },
] as const;

/** One unfinished item the PM must decide on before completion. */
export type CompletionItemKind = "task" | "deliverable" | "milestone" | "feedback" | "booking";
export function completionActionsFor(kind: CompletionItemKind): { id: string; label: string }[] {
  if (kind === "feedback") return [{ id: "resolve", label: "Resolve" }, { id: "decline", label: "Decline" }, { id: "defer", label: "Defer" }];
  if (kind === "booking") return [{ id: "cancel", label: "Cancel booking" }];
  return [{ id: "cancel", label: "Cancel" }, { id: "defer", label: "Defer" }];
}
