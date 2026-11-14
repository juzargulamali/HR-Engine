/**
 * Project team setup (pure; no database, no React). A project team is a group inside one project (`proj_teams`), never an HR department. The Project Manager chooses the
 * teams a project needs in one go from reusable presets, adds a custom team for an exception, and names a lead for each (a lead may be unknown yet: "Lead needed").
 * The database (`proj_setup_teams`) decides what is allowed and never duplicates a team or overwrites an existing lead; this file only shapes the request and the words.
 */
export interface TeamPreset { key: "content" | "programming" | "engineering" | "site_installation"; name: string; hint: string }
export const TEAM_PRESETS: readonly TeamPreset[] = [
  { key: "content", name: "Content", hint: "Video, graphics, copy and other media" },
  { key: "programming", name: "Programming", hint: "Software, apps and interactive builds" },
  { key: "engineering", name: "Engineering", hint: "Hardware, electronics and structures" },
  { key: "site_installation", name: "Site / Installation", hint: "Work at the venue. Technicians are assigned per activity on the Site schedule, not enrolled by choosing this team" },
];
export const SITE_TEAM_NOTE = "Choosing Site / Installation adds no technicians to the project. Assign the people who work at the venue to each activity on the Site schedule; someone who is not on the project then sees only their own assignment.";

/** "Programming Lead", "Site / Installation Lead": the name of the team's lead, so leads are easy to tell apart. */
export const leadLabel = (teamName: string) => `${teamName.trim()} Lead`;

export interface TeamRow { id: string; name: string; head_user_id: string | null; preset_key?: string | null }
export type SetupState = "none" | "lead_needed" | "complete";
/** No team yet: the setup is the Project Manager's first step. Teams without a lead: saved, but flagged. Otherwise complete. */
export function setupState(teams: readonly TeamRow[]): SetupState {
  if (teams.length === 0) return "none";
  return teams.some((t) => !t.head_user_id) ? "lead_needed" : "complete";
}
export const leadNeeded = (teams: readonly TeamRow[]) => teams.filter((t) => !t.head_user_id).map((t) => t.name);

export interface Pick { presets: readonly string[]; custom: readonly string[]; leads: Readonly<Record<string, string>> }
export interface SetupRow { name: string; preset?: string; lead_user_id?: string }
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
/** The lead chosen for a team, found by its name whatever the case or spacing. */
export const leadOf = (pick: Pick, name: string): string => pick.leads[norm(name)] ?? pick.leads[name.trim()] ?? "";
export const sameTeam = (a: string, b: string) => norm(a) === norm(b);

/**
 * The request for the database: the teams chosen that do not exist yet, plus an existing team that has NO lead when one was chosen for it. An existing team with a lead is never
 * included (its lead cannot be replaced here), and two names that differ only by case or spacing count once.
 */
export function buildSetup(pick: Pick, existing: readonly TeamRow[]): SetupRow[] {
  const rows: SetupRow[] = [];
  const seen = new Set<string>();
  const add = (name: string, preset?: string) => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean || seen.has(norm(clean))) return;
    seen.add(norm(clean));
    const have = existing.find((t) => sameTeam(t.name, clean));
    const lead = leadOf(pick, clean);
    if (have) { if (!have.head_user_id && lead) rows.push({ name: have.name, lead_user_id: lead }); return; }
    rows.push({ name: clean, ...(preset ? { preset } : {}), ...(lead ? { lead_user_id: lead } : {}) });
  };
  for (const key of pick.presets) { const p = TEAM_PRESETS.find((x) => x.key === key); if (p) add(p.name, p.key); }
  for (const c of pick.custom) add(c);
  for (const t of existing) if (!t.head_user_id && leadOf(pick, t.name)) add(t.name);
  return rows;
}

/** People who would be added to the project by being named a lead (not yet on it). Each is named before saving. */
export function accessAdditions(rows: readonly SetupRow[], memberIds: ReadonlySet<string>, nameOf: (id: string) => string): { id: string; name: string }[] {
  const out = new Map<string, string>();
  for (const r of rows) if (r.lead_user_id && !memberIds.has(r.lead_user_id)) out.set(r.lead_user_id, nameOf(r.lead_user_id));
  return [...out].map(([id, name]) => ({ id, name }));
}

export const ACCESS_NOTICE = "Added to the project, they can read its workspace, tasks, files and Project Chat. They stay on the project until you remove them.";

/** The sentence after saving: what was made, what was left alone, and who still needs a lead. */
export function setupNotice(r: { created?: number; existing?: number; leads_set?: number; members_added?: number; lead_needed?: string[] }): string {
  const n = (c: number, one: string, many = `${one}s`) => `${c} ${c === 1 ? one : many}`;
  const parts: string[] = [];
  if ((r.created ?? 0) > 0) parts.push(`${n(r.created!, "team")} created`);
  if ((r.leads_set ?? 0) > 0) parts.push(`${n(r.leads_set!, "lead")} set`);
  if ((r.members_added ?? 0) > 0) parts.push(`${n(r.members_added!, "person", "people")} added to the project`);
  if ((r.existing ?? 0) > 0 && parts.length === 0) parts.push("Those teams were already on the project, so nothing was added twice");
  const need = r.lead_needed ?? [];
  return `${parts.join("; ") || "Nothing changed"}.${need.length > 0 ? ` Lead needed: ${need.join(", ")}.` : ""}`;
}
