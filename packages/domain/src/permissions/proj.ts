/**
 * Projects & Tasks permission mirrors. Projects access is its own grant table (proj_company_grants), deliberately NOT
 * user_roles and NOT crm_company_grants: an HR role, a Sales grant, an employee record or an e-mail domain confers no
 * Projects access, and a Projects grant confers no HR or Sales access. Project roles (PM, temporary leader, department
 * head, member) are Projects concepts and never HR concepts: none of them changes attendance, Recovery Leave, the reporting
 * line or confidential HR access. Each function mirrors the SQL it names in
 * supabase/migrations/20261120000*_proj_*.sql: the database is the real gate; these only decide what the UI offers.
 */

export const PROJ_CAPABILITIES = [
  "founder",
  "assign_pm",
  "manage_access",
  "approve_scope",
  "view_commercial",
  "view_audit",
  "reopen_project",
  "override_site_conflict",
] as const;
export type ProjCapability = (typeof PROJ_CAPABILITIES)[number];

export const PROJ_CAPABILITY_LABELS: Record<ProjCapability, { label: string; description: string }> = {
  founder: { label: "Founder", description: "Everything below, for this company: see and manage every project, assign Project Managers, delegate, read the audit trail." },
  assign_pm: { label: "Assign Project Managers", description: "Name the Project Manager of a handover or project, and create internal projects." },
  manage_access: { label: "Manage Projects access", description: "Give and withdraw Projects access for this company (cannot hand out founder rights)." },
  approve_scope: { label: "Decide scope changes", description: "Approve or reject a proposed change to the agreed scope of a client project." },
  view_commercial: { label: "See commercial effects", description: "Read the cost effect recorded against a scope change. Not shown to anyone else." },
  view_audit: { label: "Read the Projects audit trail", description: "See who changed what in this company's projects, including member-only fields." },
  reopen_project: { label: "Reopen completed projects", description: "Reopen a completed project, with a reason. The completion record stays in the history." },
  override_site_conflict: { label: "Confirm overlapping site bookings", description: "Confirm a booking that overlaps another, with a recorded reason." },
};

export interface ProjGrant {
  companyId: string;
  capabilities: readonly ProjCapability[];
}

/** proj_has_access */
export const hasProjAccess = (grants: readonly ProjGrant[], companyId: string) => grants.some((g) => g.companyId === companyId);

/** proj_has_capability: 'founder' implies every capability. */
export function hasProjCapability(grants: readonly ProjGrant[], companyId: string, capability: ProjCapability): boolean {
  return grants.some((g) => g.companyId === companyId && (g.capabilities.includes("founder") || g.capabilities.includes(capability)));
}

/** proj_is_founder */
export const isProjFounder = (grants: readonly ProjGrant[], companyId: string) =>
  grants.some((g) => g.companyId === companyId && g.capabilities.includes("founder"));

export const isAnyProjFounder = (grants: readonly ProjGrant[]) => grants.some((g) => g.capabilities.includes("founder"));
export const hasAnyProjAccess = (grants: readonly ProjGrant[]) => grants.length > 0;
export const projCompanyIds = (grants: readonly ProjGrant[]) => [...new Set(grants.map((g) => g.companyId))];

/** proj_grant_access / proj_revoke_access (founder or manage_access; founder / manage_access rights themselves need a founder). */
export const canManageProjAccess = (grants: readonly ProjGrant[], companyId: string) => hasProjCapability(grants, companyId, "manage_access");
export const canGrantProjFounderRights = (grants: readonly ProjGrant[], companyId: string) => isProjFounder(grants, companyId);

/** proj_assign_handover_pm / proj_assign_pm / proj_create_internal_project */
export const canAssignPm = (grants: readonly ProjGrant[], companyId: string) => hasProjCapability(grants, companyId, "assign_pm");
export const canDecideScope = (grants: readonly ProjGrant[], companyId: string) => hasProjCapability(grants, companyId, "approve_scope");
export const canSeeCommercialEffects = (grants: readonly ProjGrant[], companyId: string) => hasProjCapability(grants, companyId, "view_commercial");
export const canReopenProject = (grants: readonly ProjGrant[], companyId: string) => hasProjCapability(grants, companyId, "reopen_project");
export const canOverrideSiteConflict = (grants: readonly ProjGrant[], companyId: string) => hasProjCapability(grants, companyId, "override_site_conflict");
export const canReadProjAudit = (grants: readonly ProjGrant[], companyId: string) => hasProjCapability(grants, companyId, "view_audit");

export type ProjectMemberRole = "pm" | "acting_pm" | "member";

/** What the signed-in person is to one project: everything the helpers proj_can_* evaluate in the database. */
export interface ProjectStanding {
  companyId: string;
  /** The person's own grants (all companies). */
  grants: readonly ProjGrant[];
  /** The project's accountable PM / owner. */
  isPm: boolean;
  /** An active membership row (the PM always has one). */
  isMember: boolean;
  /** Temporary project leadership that has not expired (date-only comparison, as in the database). */
  isActingPm: boolean;
  /** Teams of this project the person heads. */
  headOfTeamIds: readonly string[];
  /** A recorded Sales link while their Sales access is active. */
  isSalesLinked: boolean;
  /** Status of the project (summary visibility of finished projects differs). */
  status: string;
}

export const LIVE_PROJECT_STATUSES = ["planning", "in_progress", "ready_for_installation", "on_site", "on_hold"] as const;
export const isLiveProjectStatus = (status: string) => (LIVE_PROJECT_STATUSES as readonly string[]).includes(status);

/** proj_can_view_details: founders of the company and active members. Nobody else, whatever their other roles. */
export const canViewProjectDetails = (s: ProjectStanding) => isProjFounder(s.grants, s.companyId) || s.isMember;

/** proj_can_manage: founder, the PM, or temporary project leadership. */
export const canManageProject = (s: ProjectStanding) => isProjFounder(s.grants, s.companyId) || s.isPm || s.isActingPm;

/** proj_can_view_summary */
export const canViewProjectSummary = (s: ProjectStanding) =>
  isProjFounder(s.grants, s.companyId) || s.isMember || (hasProjAccess(s.grants, s.companyId) && isLiveProjectStatus(s.status)) || s.isSalesLinked;

export type ProjectViewLevel = "details" | "summary" | "none";
export const projectViewLevel = (s: ProjectStanding): ProjectViewLevel => (canViewProjectDetails(s) ? "details" : canViewProjectSummary(s) ? "summary" : "none");

/** Task-level rules shared by the UI and mirrored by proj_set_task_status / proj_update_task / proj_reassign_task. */
export type TaskActorRole = "manager" | "head" | "assignee" | null;

export interface TaskRef {
  assigneeId: string;
  teamId: string | null;
  requiresReview: boolean;
  status: string;
  blocked: boolean;
}

/** proj_task_actor_role */
export function taskActorRole(s: ProjectStanding, userId: string, task: TaskRef): TaskActorRole {
  if (canManageProject(s)) return "manager";
  if (task.teamId && s.headOfTeamIds.includes(task.teamId)) return "head";
  if (task.assigneeId === userId && s.isMember) return "assignee";
  return null;
}

export const TASK_STATUSES = ["todo", "in_progress", "ready_for_review", "done", "cancelled", "deferred"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  done: "Done",
  cancelled: "Cancelled",
  deferred: "Deferred",
};
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "ready_for_review"];
export const isOpenTask = (status: string) => (OPEN_TASK_STATUSES as readonly string[]).includes(status);

export interface TaskMove {
  to: TaskStatus;
  /** Needs a written reason (changes requested, reopen, cancel, defer). */
  needsNote: boolean;
  label: string;
}

/**
 * The status moves this person may offer on this task (mirrors proj_set_task_status). A task that needs review is finished
 * by a department head or the PM who did not do the work; routine tasks are finished by their owner.
 */
export function allowedTaskMoves(role: TaskActorRole, userId: string, task: TaskRef): TaskMove[] {
  if (!role) return [];
  const moves: TaskMove[] = [];
  const leader = role === "manager" || role === "head";
  const isReviewer = leader && task.assigneeId !== userId;
  if (task.status === "done" || task.status === "cancelled" || task.status === "deferred") {
    if (leader) {
      moves.push({ to: "in_progress", needsNote: true, label: "Reopen as In progress" }, { to: "todo", needsNote: true, label: "Reopen as To do" });
    }
    return moves;
  }
  if (task.status === "todo") moves.push({ to: "in_progress", needsNote: false, label: "Start" });
  if (task.status === "in_progress") moves.push({ to: "todo", needsNote: false, label: "Back to To do" });
  if (task.requiresReview) {
    if (task.status === "in_progress") moves.push({ to: "ready_for_review", needsNote: false, label: "Send for review" });
    if (task.status === "ready_for_review") {
      if (isReviewer) {
        moves.push({ to: "done", needsNote: false, label: "Accept and complete" }, { to: "in_progress", needsNote: true, label: "Request changes" });
      } else if (role === "assignee") {
        moves.push({ to: "in_progress", needsNote: false, label: "Withdraw from review" });
      }
    }
  } else if (task.status === "todo" || task.status === "in_progress") {
    if (!task.blocked) moves.push({ to: "done", needsNote: false, label: "Mark done" });
  }
  if (leader) {
    moves.push({ to: "deferred", needsNote: true, label: "Defer" }, { to: "cancelled", needsNote: true, label: "Cancel" });
  }
  return moves;
}

/** Whether the person may create a task for `assigneeId` in `teamId` (mirrors proj_create_task). */
export function canCreateTaskFor(s: ProjectStanding, userId: string, assigneeId: string, teamId: string | null, myTeamId: string | null): boolean {
  if (!s.isMember && !isProjFounder(s.grants, s.companyId)) return false;
  if (canManageProject(s)) return true;
  if (teamId && s.headOfTeamIds.includes(teamId)) return true;     // a head distributes within the team; the database checks the assignee's team
  return assigneeId === userId && (teamId === null || teamId === myTeamId);
}
