import { formatPlanDay } from "@enginious-hr/domain";

/** Plain words for what each person is on a project. Project roles are Projects concepts only: none of them is an HR role. */
export interface PersonLike {
  user_id: string;
  role: "pm" | "acting_pm" | "member";
  team_id: string | null;
  is_team_head: boolean;
  acting_until: string | null;
}
export interface TeamLike {
  id: string;
  name: string;
  head_user_id: string;
}

/** Leadership that has passed its end date (date-only compare, as the database does) no longer carries project powers. */
export const isActingCurrent = (p: PersonLike, today: string) => p.role === "acting_pm" && !!p.acting_until && p.acting_until >= today;

export function roleLabels(p: PersonLike, teams: readonly TeamLike[], today: string): string[] {
  const out: string[] = [];
  if (p.role === "pm") out.push("Project Manager");
  if (p.role === "acting_pm") {
    out.push(isActingCurrent(p, today) ? `Temporary leader until ${formatPlanDay(p.acting_until)}` : "Temporary leadership ended");
  }
  for (const t of teams) if (t.head_user_id === p.user_id) out.push(`Department head of ${t.name}`);
  if (out.length === 0 || (p.role === "acting_pm" && !isActingCurrent(p, today) && out.length === 1)) out.push("Member");
  return out;
}

export const teamNameOf = (teamId: string | null, teams: readonly TeamLike[]) => (teamId ? (teams.find((t) => t.id === teamId)?.name ?? null) : null);

export const ROLE_EXPLANATIONS: { role: string; can: string }[] = [
  { role: "Project Manager", can: "Manages the scope, people, departments, milestones and delivery of this project, accepts milestones, and prepares the client timeline." },
  { role: "Temporary leader", can: "Has the Project Manager's project powers until the end date. Cannot change who the Project Manager is or appoint other leaders." },
  { role: "Department head", can: "Manages their department's deliverables and tasks, hands work to people in the department, accepts the department's deliverables and reviews its tasks." },
  { role: "Member", can: "Reads the project workspace and discussion, updates their own tasks, creates tasks for themselves and comments." },
];

export const HR_INDEPENDENCE_NOTE =
  "Project roles belong to Projects only. They do not create attendance, award or change Recovery Leave, change anyone's manager or reporting line, or give access to HR information.";
