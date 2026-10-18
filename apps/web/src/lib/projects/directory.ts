import { allowedStatusMoves, isFinishedProject, isProjFounder, liveStatusesFor, PROJECT_STATUSES, type ProjGrant, type ProjectKind, type StatusMove } from "@enginious-hr/domain";
import { compareNullable, type SortState } from "@/components/workspace/url-state";

/**
 * Pure logic of the Projects directory: sorting, the board's lanes and which moves a person may request, and who may see a project's
 * next milestone. The database remains the authority on every status change; this only decides what the page offers and fetches.
 */

export const DIRECTORY_SORT_KEYS = ["name", "pm", "status", "dates", "milestone"] as const;
export type DirectorySortKey = (typeof DIRECTORY_SORT_KEYS)[number];
export const DEFAULT_DIRECTORY_SORT: SortState<DirectorySortKey> = { key: "dates", dir: "asc" };

export interface DirectoryRowLite {
  id: string;
  company_id: string;
  name: string;
  reference: string;
  kind: ProjectKind;
  status: string;
  pm_user_id: string;
  pm_name: string | null;
  start_date: string | null;
  end_date: string | null;
  is_member: boolean;
}

const statusRank = (s: string) => {
  const i = (PROJECT_STATUSES as readonly string[]).indexOf(s);
  return i < 0 ? 99 : i;
};

/** The key projects are ordered by: when they end, else when they start. Plain dates compare as strings, never through a time zone. */
const dateKey = (r: Pick<DirectoryRowLite, "start_date" | "end_date">) => r.end_date ?? r.start_date;

export function sortDirectory<T extends DirectoryRowLite>(rows: readonly T[], sort: SortState<DirectorySortKey>, nextMilestoneDue: ReadonlyMap<string, string | null> = new Map()): T[] {
  const tie = (a: T, b: T) => a.reference.localeCompare(b.reference, undefined, { numeric: true });
  const cmp = (a: T, b: T): number => {
    switch (sort.key) {
      case "name": return compareNullable(a.name, b.name, sort.dir);
      case "pm": return compareNullable(a.pm_name, b.pm_name, sort.dir);
      case "status": return sort.dir === "asc" ? statusRank(a.status) - statusRank(b.status) : statusRank(b.status) - statusRank(a.status);
      case "milestone": return compareNullable(nextMilestoneDue.get(a.id) ?? null, nextMilestoneDue.get(b.id) ?? null, sort.dir);
      default: return compareNullable(dateKey(a), dateKey(b), sort.dir);
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) || tie(a, b));
}

/** Members and founders of the project's company may see its milestones; everyone else sees the summary only. */
export const canSeeProjectDetails = (row: Pick<DirectoryRowLite, "is_member" | "company_id">, grants: readonly ProjGrant[]) => row.is_member || isProjFounder(grants, row.company_id);

/** The ids whose milestones may be fetched at all. Nothing is requested for the rest, so nothing reaches the page. */
export const milestoneProjectIds = (rows: readonly Pick<DirectoryRowLite, "id" | "is_member" | "company_id">[], grants: readonly ProjGrant[]): string[] =>
  rows.filter((r) => canSeeProjectDetails(r, grants)).map((r) => r.id);

export interface MilestoneLite {
  project_id: string;
  title: string;
  due_date: string | null;
  status: string;
}
const OPEN_MILESTONE = ["planned", "in_progress", "ready_for_acceptance"];

/** The earliest dated milestone that is not finished, per project. Milestones without a date are not "next". */
export function nextMilestones(milestones: readonly MilestoneLite[]): Map<string, { title: string; due: string }> {
  const out = new Map<string, { title: string; due: string }>();
  for (const m of milestones) {
    if (!m.due_date || !OPEN_MILESTONE.includes(m.status)) continue;
    const have = out.get(m.project_id);
    if (!have || m.due_date < have.due || (m.due_date === have.due && m.title.localeCompare(have.title) < 0)) out.set(m.project_id, { title: m.title, due: m.due_date });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------ board
export const DIRECTORY_LANES = ["planning", "in_progress", "ready_for_installation", "on_site", "on_hold"] as const;
export type DirectoryLane = (typeof DIRECTORY_LANES)[number];

/** Completed and archived projects have no lane: completing is its own flow and archiving only follows completion. */
export const laneOf = (status: string): DirectoryLane | null => ((DIRECTORY_LANES as readonly string[]).includes(status) ? (status as DirectoryLane) : null);

/** Only a founder of the company or the project's accountable PM may change a project's status from the directory. */
export const canChangeStatus = (row: Pick<DirectoryRowLite, "company_id" | "pm_user_id" | "status">, userId: string, grants: readonly ProjGrant[]) =>
  !isFinishedProject(row.status) && (row.pm_user_id === userId || isProjFounder(grants, row.company_id));

export interface LaneMove {
  lane: DirectoryLane;
  move: StatusMove;
}

/**
 * The lanes a card can be moved to, each with the status move it stands for. Lanes the project's kind cannot use are absent (an
 * internal project has no installation or show lanes). A project on hold has one move, Resume, which returns it to the stage it
 * was in: it may be requested from any lane that kind uses, and the form says where it goes back to. Completed is never a lane.
 */
export function laneMoves(row: Pick<DirectoryRowLite, "kind" | "status">): LaneMove[] {
  const moves = allowedStatusMoves(row.kind, row.status);
  const usable = (liveStatusesFor(row.kind) as readonly string[]).concat("on_hold");
  if (row.status === "on_hold") {
    const resume = moves.find((m) => m.to === "resume");
    return resume ? DIRECTORY_LANES.filter((l) => l !== "on_hold" && usable.includes(l)).map((lane) => ({ lane, move: resume })) : [];
  }
  return moves.flatMap((m) => (laneOf(m.to) && usable.includes(m.to) ? [{ lane: m.to as DirectoryLane, move: m }] : []));
}

export const moveForLane = (row: Pick<DirectoryRowLite, "kind" | "status">, lane: string): StatusMove | null => laneMoves(row).find((m) => m.lane === lane)?.move ?? null;
