import { getProjectsContext, type ProjectsContext } from "@/lib/projects/context";
import { dateText } from "@/lib/projects/format";
import { projectDayRows, type ProjectDayRow } from "@/lib/projects/my-day";
import { loadMyWork, loadProjectsAttention } from "@/lib/projects/my-work";
import { loadPortfolio, type Portfolio } from "./loaders";
import { buildWorkToday, tasksInReview, type WorkToday } from "./work-today";

export interface ProjectsDay {
  ctx: ProjectsContext | null;
  /** The "needs you" counts of Projects. "error": the read failed. null: no Projects access (or not installed). */
  rows: ProjectDayRow[] | "error" | null;
  portfolio: Portfolio | "error" | null;
  /** The person's own tasks by title, for "My work today". */
  work: WorkToday | "error" | null;
  /** Their own tasks sent for review: waiting on someone else. */
  inReview: number | "error" | null;
}

/**
 * Everything Projects adds to My Day, from the person's own session. The three reads (counts, portfolio, own tasks) are independent
 * (Promise.allSettled): each one that fails is its own "error" and the others still show. A failed access lookup is an error for all three,
 * never "no access". No Projects grant means null everywhere (nothing is shown, nothing is read).
 */
export async function loadProjectsDay(today: string): Promise<ProjectsDay> {
  const none: ProjectsDay = { ctx: null, rows: null, portfolio: null, work: null, inReview: null };
  const ctx = await getProjectsContext();
  if (!ctx) return none;
  if (ctx.loadFailed) return { ctx, rows: "error", portfolio: "error", work: "error", inReview: "error" };
  if (!ctx.installed || ctx.grants.length === 0) return { ...none, ctx };
  const [attention, portfolio, work] = await Promise.allSettled([loadProjectsAttention(ctx), loadPortfolio(ctx, today), loadMyWork(ctx)]);
  for (const r of [attention, portfolio, work]) if (r.status === "rejected") console.error("[projects] my day load failed", r.reason);
  return {
    ctx,
    rows: attention.status === "fulfilled" ? projectDayRows(attention.value) : "error",
    portfolio: portfolio.status === "fulfilled" ? portfolio.value : "error",
    work: work.status === "fulfilled" ? buildWorkToday(work.value.open, work.value.today, (id) => ctx.personName(id), dateText) : "error",
    inReview: work.status === "fulfilled" ? tasksInReview(work.value.open) : "error",
  };
}
