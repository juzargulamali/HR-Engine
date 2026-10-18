import { SidePanel } from "@/components/workspace/side-panel";
import { parseRecordId, withParams } from "@/components/workspace/url-state";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { createClient } from "@/lib/supabase/server";
import { loadTaskDetail } from "./task-detail-data";
import { TaskDetailBody } from "./task-detail";

/**
 * The task details panel for `?task=ID` on a list page. The record is loaded through the person's own session and the project view is
 * checked again, so a task they may not read (another project, a summary-only project, a removed membership) produces no panel at all.
 * `projectId` is known on a project's own Work page; on My Work it is looked up from the task.
 */
export async function TaskPanel({ rawTaskId, projectId, basePath, current, panelParam = "task" }: { rawTaskId: string; projectId?: string; basePath: string; current: Record<string, string>; panelParam?: string }) {
  const taskId = parseRecordId(rawTaskId);
  if (!taskId) return null;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  let pid = projectId;
  if (!pid) {
    const supabase = await createClient();
    const { data } = await supabase.from("proj_tasks").select("project_id").eq("id", taskId).maybeSingle();
    pid = data?.project_id;
  }
  if (!pid) return <MissingTask closeHref={withParams(basePath, current, { [panelParam]: null })} />;
  const view = await loadProjectView(ctx, pid);
  if (!view || view.level !== "details") return <MissingTask closeHref={withParams(basePath, current, { [panelParam]: null })} />;
  const data = await loadTaskDetail(view, ctx, taskId);
  const closeHref = withParams(basePath, current, { [panelParam]: null });
  if (!data) return <MissingTask closeHref={closeHref} />;
  return (
    <SidePanel title={data.task.title} subtitle={`${view.project.reference} · ${view.project.name}`} closeHref={closeHref} fullPageHref={`/projects/${pid}/work/tasks/${taskId}`}>
      <TaskDetailBody data={data} view={view} taskHref={(id) => withParams(basePath, current, { [panelParam]: id })} />
    </SidePanel>
  );
}

function MissingTask({ closeHref }: { closeHref: string }) {
  return (
    <SidePanel title="Task not available" closeHref={closeHref}>
      <p className="text-sm text-muted-foreground">This task does not exist, or you cannot see it. It may have been removed, or you may no longer be part of its project.</p>
    </SidePanel>
  );
}
