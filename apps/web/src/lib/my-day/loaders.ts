import "server-only";
import { canSeeProjectDetails } from "@/lib/projects/directory";
import { loadDirectoryResult } from "@/lib/projects/data";
import type { ProjectsContext } from "@/lib/projects/context";
import { createClient } from "@/lib/supabase/server";
import { getInventoryContext } from "@/lib/inventory/context";
import { loadRequestList } from "@/lib/inventory/planning-data";
import { buildDeliveryWeek, classifyProjects, healthCounts, itemDates, type DeliveryWeek, type ProjectHealth } from "./portfolio";
import { equipmentSummary, nextDispatch, type DispatchRequest, type EquipmentSummary } from "./dispatch";
import { summariseLive, type LiveSummary } from "./live";

/**
 * The data behind the CEO-style parts of My Day. Every read goes through the signed-in person's own session, so row-level security decides
 * what they see; the page only calls these for people whose module access already allows it. A failed read throws: the page shows
 * "could not be loaded" for that card and never presents a failure as zero.
 */

const chunk = <T,>(items: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

export interface Portfolio {
  /** Projects that are not completed or archived: the same number as "Ongoing" on the Projects page. */
  activeCount: number;
  /** Of those, projects whose details the person may not see (they are counted above but not grouped or scheduled). */
  summaryOnlyCount: number;
  health: Record<ProjectHealth, number>;
  delivery: DeliveryWeek;
}

export async function loadPortfolio(ctx: ProjectsContext, today: string): Promise<Portfolio> {
  const { rows, error } = await loadDirectoryResult();
  if (error) throw new Error(error);
  const live = rows.filter((r) => r.status !== "completed" && r.status !== "archived");
  const visible = live.filter((r) => canSeeProjectDetails(r, ctx.grants));
  const ids = visible.map((r) => r.id);
  const supabase = await createClient();

  const [tasks, milestones, plan] = ids.length === 0 ? [[], [], []] : await Promise.all([
    Promise.all(chunk(ids, 100).map((part) => selectAll((a, b) => supabase.from("proj_tasks").select("project_id, status, due_date, blocked_at").in("project_id", part).range(a, b)))).then((x) => x.flat()),
    Promise.all(chunk(ids, 100).map((part) => selectAll((a, b) => supabase.from("proj_milestones").select("id, project_id, title, status, due_date").in("project_id", part).range(a, b)))).then((x) => x.flat()),
    Promise.all(chunk(ids, 100).map((part) => selectAll((a, b) => supabase.from("proj_plan_items").select("id, project_id, title, status, start_date, end_date, starts_at, ends_at, tz").in("project_id", part).eq("plan", "delivery").neq("status", "cancelled").range(a, b)))).then((x) => x.flat()),
  ]);

  const health = classifyProjects(ids, tasks, milestones, today);
  const delivery = buildDeliveryWeek({
    today,
    projects: visible.map((r) => ({ id: r.id, name: r.name, reference: r.reference, pmName: r.pm_name })),
    items: plan.flatMap((i) => {
      const d = itemDates(i);
      return d ? [{ projectId: i.project_id, id: i.id, title: i.title, start: d.start, end: d.end, status: (i.status === "done" || i.status === "in_progress" ? i.status : "planned") as "planned" | "in_progress" | "done" }] : [];
    }),
    milestones: milestones.flatMap((m) => (m.due_date ? [{ projectId: m.project_id, id: m.id, title: m.title, due: m.due_date, status: m.status }] : [])),
  });
  return { activeCount: live.length, summaryOnlyCount: live.length - visible.length, health: healthCounts(health), delivery };
}

/** Open clock sessions and the work mode of each open segment, limited to the people the overview covers. */
export async function loadLiveClock(scope: ReadonlySet<string>): Promise<LiveSummary> {
  const supabase = await createClient();
  const [sessions, segments] = await Promise.all([
    selectAll((a, b) => supabase.from("attendance_sessions").select("employee_id").eq("status", "open").range(a, b)),
    selectAll((a, b) => supabase.from("attendance_segments").select("employee_id, work_mode").is("segment_end", null).range(a, b)),
  ]);
  return summariseLive(sessions, segments, scope);
}

export interface Equipment { summary: EquipmentSummary; next: DispatchRequest | null }

/** Null when the person has no Inventory access (or Inventory is not installed): the card is then not shown at all. */
export async function loadEquipment(): Promise<Equipment | null> {
  const ctx = await getInventoryContext();
  if (!ctx || !ctx.installed || ctx.loadFailed || (ctx.grants.length === 0 && !ctx.managesProjects)) return null;
  const list = await loadRequestList(ctx.userId);
  const rows: DispatchRequest[] = list.rows.map((r) => ({ id: r.id, code: r.code, title: r.title, forLabel: r.forLabel, status: r.status, needed_from: r.needed_from, timezone: r.timezone, done: r.done, total: r.total, shortageLines: r.shortageLines }));
  return { summary: equipmentSummary(rows), next: nextDispatch(rows) };
}
