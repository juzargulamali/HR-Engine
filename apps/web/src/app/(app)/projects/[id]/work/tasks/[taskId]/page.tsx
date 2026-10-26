import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { TaskDetailBody } from "@/components/projects/tasks/task-detail";
import { loadTaskDetail } from "@/components/projects/tasks/task-detail-data";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { BackLink } from "@/components/workspace/list-memory";

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
      <BackLink section={`tasks-${id}`} fallback={`/projects/${id}/work`}>Back to the task list</BackLink>
      <h2 className="text-xl font-semibold">{data.task.title}</h2>
      <div className="max-w-3xl">
        <TaskDetailBody data={data} view={view} taskHref={(tid) => `/projects/${id}/work/tasks/${tid}`} />
      </div>
    </div>
  );
}
