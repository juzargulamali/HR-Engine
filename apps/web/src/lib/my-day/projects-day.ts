import { getProjectsContext, type ProjectsContext } from "@/lib/projects/context";
import { dateText } from "@/lib/projects/format";
import { projectDayRows, type ProjectDayRow } from "@/lib/projects/my-day";
import { loadMyWork, loadProjectsAttention } from "@/lib/projects/my-work";
import { loadPortfolio, type Portfolio } from "./loaders";
import { buildWorkToday, tasksInReview, type WorkToday } from "./work-today";
import type { ProjectsAttention, WorkTask } from "@/lib/projects/my-work";
import type { AttentionTask } from "./attention";

const toAttentionTask = (t: WorkTask): AttentionTask => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date, updatedAt: t.updated_at, projectReference: t.projectReference, projectName: t.projectName });

export interface ProjectsDay {
  ctx: ProjectsContext | null;
  /** The "needs you" counts of Projects. "error": the read failed. null: no Projects access (or not installed). */
  rows: ProjectDayRow[] | "error" | null;
  portfolio: Portfolio | "error" | null;
  /** The person's own tasks by title, for "My work today". */
  work: WorkToday | "error" | null;
  /** Their own tasks sent for review: waiting on someone else. */
  inReview: number | "error" | null;
  /** The handovers and scope proposals waiting on them, one entry each (the list behind the My Day headline). "error": the read failed. */
  decisions: Pick<ProjectsAttention, "handoverList" | "scopeList"> | "error" | null;
  /** Their open tasks and the tasks waiting for their review, for the same list. "error": the read failed. */
  tasks: { today: string; open: AttentionTask[]; reviews: AttentionTask[] } | "error" | null;
}

/**
 * Everything Projects adds to My Day, from the person's own session. The three reads (counts, portfolio, own tasks) are independent
 * (Promise.allSettled): each one that fails is its own "error" and the others still show. A failed access lookup is an error for all three,
 * never "no access". No Projects grant means null everywhere (nothing is shown, nothing is read).
 */
export async function loadProjectsDay(today: string): Promise<ProjectsDay> {
  const none: ProjectsDay = { ctx: null, rows: null, portfolio: null, work: null, inReview: null, decisions: null, tasks: null };
  const ctx = await getProjectsContext();
  if (!ctx) return none;
  if (ctx.loadFailed) return { ctx, rows: "error", portfolio: "error", work: "error", inReview: "error", decisions: "error", tasks: "error" };
  if (!ctx.installed || ctx.grants.length === 0) return { ...none, ctx };
  const [attention, portfolio, work] = await Promise.allSettled([loadProjectsAttention(ctx), loadPortfolio(ctx, today), loadMyWork(ctx)]);
  for (const r of [attention, portfolio, work]) if (r.status === "rejected") console.error("[projects] my day load failed", r.reason);
  return {
    ctx,
    rows: attention.status === "fulfilled" ? projectDayRows(attention.value) : "error",
    portfolio: portfolio.status === "fulfilled" ? portfolio.value : "error",
    work: work.status === "fulfilled" ? buildWorkToday(work.value.open, work.value.today, (id) => ctx.personName(id), dateText) : "error",
    inReview: work.status === "fulfilled" ? tasksInReview(work.value.open) : "error",
    decisions: attention.status === "fulfilled" ? { handoverList: attention.value.handoverList, scopeList: attention.value.scopeList } : "error",
    tasks: work.status === "fulfilled" ? { today: work.value.today, open: work.value.open.map(toAttentionTask), reviews: work.value.reviews.map(toAttentionTask) } : "error",
  };
}
