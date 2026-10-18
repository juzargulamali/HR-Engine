import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { TaskDetailBody } from "@/components/projects/tasks/task-detail";
import { loadTaskDetail } from "@/components/projects/tasks/task-detail-data";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";

export const metadata = { title: "Task" };

/**
 * One task on its own page (a direct, shareable address). It shows exactly what the side panel shows: both are the same component, fed by
 * the same loader, so what a person may see and change here can never differ from the panel.
 */
export default async function TaskPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details") redirect(`/projects/${id}`);
  const data = await loadTaskDetail(view, ctx, taskId);
  if (!data) notFound();

  return (
    <div className="space-y-5">
      <Link href={`/projects/${id}/work`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to the task list
      </Link>
      <h2 className="text-xl font-semibold">{data.task.title}</h2>
      <div className="max-w-3xl">
        <TaskDetailBody data={data} view={view} taskHref={(tid) => `/projects/${id}/work/tasks/${tid}`} />
      </div>
    </div>
  );
}
