import { SidePanel } from "@/components/workspace/side-panel";
import { LoadError } from "@/components/workspace/states";
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
export async function TaskPanel({ rawTaskId, projectId, basePath, current, panelParam = "task", backFrom }: { rawTaskId: string; projectId?: string; basePath: string; current: Record<string, string>; panelParam?: string; backFrom?: "my-work" }) {
  const taskId = parseRecordId(rawTaskId);
  if (!taskId) return null;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  let pid = projectId;
  if (!pid) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("proj_tasks").select("project_id").eq("id", taskId).maybeSingle();
    if (error) return <TaskLoadError closeHref={withParams(basePath, current, { [panelParam]: null, version: null })} />;
    pid = data?.project_id;
  }
  if (!pid) return <MissingTask closeHref={withParams(basePath, current, { [panelParam]: null, version: null })} />;
  // Closing the panel leaves the list exactly as it was (filters, search, view, sort); the version in view goes with the task.
  const closeHref = withParams(basePath, current, { [panelParam]: null, version: null });
  // A failed read is "could not load", not "Task not available" (which says the task is gone or private).
  let view: Awaited<ReturnType<typeof loadProjectView>> = null;
  let data: Awaited<ReturnType<typeof loadTaskDetail>> = null;
  let failed = false;
  try {
    view = await loadProjectView(ctx, pid);
    if (view && view.level === "details") data = await loadTaskDetail(view, ctx, taskId);
  } catch (e) {
    console.error("[projects] task panel load failed", e);
    failed = true;
  }
  if (failed) return <TaskLoadError closeHref={closeHref} />;
  if (!view || view.level !== "details" || !data) return <MissingTask closeHref={closeHref} />;
  return (
    <SidePanel title={data.task.title} subtitle={`${view.project.reference} · ${view.project.name}`} closeHref={closeHref} fullPageHref={fullPage(pid, taskId, current.version, backFrom)}>
      <TaskDetailBody data={data} view={view} focusVersionId={current.version} taskHref={(id) => withParams(basePath, current, { [panelParam]: id, version: null })} />
    </SidePanel>
  );
}

/** The task's own page, keeping the version in view and, from My Work, where the Back link returns to. */
function fullPage(projectId: string, taskId: string, version: string | undefined, backFrom: "my-work" | undefined): string {
  const q = new URLSearchParams();
  if (version) q.set("version", version);
  if (backFrom) q.set("from", backFrom);
  const qs = q.toString();
  return `/projects/${projectId}/work/tasks/${taskId}${qs ? `?${qs}` : ""}`;
}

function TaskLoadError({ closeHref }: { closeHref: string }) {
  return (
    <SidePanel title="Task could not be loaded" closeHref={closeHref}>
      <LoadError what="this task" />
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
