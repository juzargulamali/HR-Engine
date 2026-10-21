import { cn } from "@/lib/utils";
import { listTable } from "@/components/workspace/list-table";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BlockedBadge, PriorityBadge } from "@/components/projects/badges";
import { PanelLink } from "@/components/workspace/panel-link";
import { SortHead } from "@/components/workspace/sort-head";
import { nextSort, sortToParam, withParams, type SortState } from "@/components/workspace/url-state";
import { TaskAssigneeControl, TaskDueControl, TaskStatusControl, type ControlRow } from "./task-controls";
import type { TaskColumnId, TaskRowData, TaskSortKey } from "./task-logic";

/** A task row as the controls need it, with the start date for the due-date form. */
export const toControlRow = (r: TaskRowData): ControlRow => ({
  id: r.id, projectId: r.projectId, title: r.title, status: r.status, version: r.version, moves: r.moves, dueDate: r.dueDate, startDate: r.startDate, due: r.due,
  canChangeDue: r.canChangeDue, assigneeId: r.assigneeId, assigneeName: r.assigneeName, canReassign: r.canReassign, reassignOptions: r.reassignOptions,
});

/** The small flags under a title, in words: blocked, needs review, priority. */
export function TaskFlags({ r }: { r: Pick<TaskRowData, "blocked" | "needsReview" | "priority"> }) {
  if (!r.blocked && !r.needsReview && r.priority === "normal") return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {r.blocked ? <BlockedBadge /> : null}
      {r.needsReview ? <Badge variant="outline" className="text-muted-foreground">Needs review</Badge> : null}
      <PriorityBadge priority={r.priority} />
    </div>
  );
}

/**
 * The working table of tasks, the same for My Work (several projects) and one project's Work section. Rows are server-rendered; the
 * task title opens the details panel next to the list (?task=ID), so the list, its filters, sort and scroll position stay exactly as
 * they were. Status, assignee and due date are edited in place only where the viewer already has the right (see task-logic).
 */
export function TaskTable({ rows, columns, sort, basePath, current, showProject, caption, panelParam = "task" }: {
  rows: readonly TaskRowData[];
  columns: readonly TaskColumnId[];
  sort: SortState<TaskSortKey>;
  basePath: string;
  /** The current query string as a record, so sorting and opening a task keep every other choice. */
  current: Record<string, string>;
  showProject: boolean;
  caption: string;
  panelParam?: string;
}) {
  const sortHref = (key: TaskSortKey) => withParams(basePath, current, { sort: sortToParam(nextSort(sort, key)) });
  const head = (key: TaskSortKey, label: string, className?: string) => <SortHead label={label} href={sortHref(key)} active={sort.key === key} dir={sort.dir} className={className} />;
  const has = (c: TaskColumnId) => columns.includes(c);
  return (
    <Table className={cn("min-w-[46rem]", listTable)}>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          {head("task", "Task")}
          {showProject ? head("project", "Project") : null}
          {head("assignee", "Assignee")}
          {head("due", "Due")}
          {head("status", "Status")}
          {has("priority") ? head("priority", "Priority") : null}
          {has("team") ? <TableHead scope="col">Department</TableHead> : null}
          {has("milestone") ? <TableHead scope="col">Milestone</TableHead> : null}
          {has("deliverable") ? <TableHead scope="col">Deliverable</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className="align-top">
            <TableCell className="min-w-[13rem] max-w-[22rem] px-3 py-2.5">
              <PanelLink href={withParams(basePath, current, { [panelParam]: r.id })} className="break-words font-medium underline-offset-2 hover:underline">{r.title}</PanelLink>
              <TaskFlags r={r} />
            </TableCell>
            {showProject ? (
              <TableCell data-label="Project" className="px-3 py-2.5 text-sm">
                <span className="block break-words">{r.projectName}</span>
                <span className="font-mono text-[13px] text-muted-foreground">{r.projectReference}</span>
              </TableCell>
            ) : null}
            <TableCell data-label="Assignee" className="px-3 py-2.5 text-sm"><TaskAssigneeControl row={toControlRow(r)} /></TableCell>
            <TableCell data-label="Due" className="min-w-[10rem] px-3 py-2.5 text-sm"><TaskDueControl row={toControlRow(r)} /></TableCell>
            <TableCell data-label="Status" className="px-3 py-2.5 text-sm"><TaskStatusControl row={toControlRow(r)} /></TableCell>
            {has("priority") ? <TableCell data-label="Priority" className="px-3 py-2.5 text-sm capitalize">{r.priority}</TableCell> : null}
            {has("team") ? <TableCell data-label="Department" className="px-3 py-2.5 text-sm">{r.teamName ?? <span className="text-muted-foreground">None</span>}</TableCell> : null}
            {has("milestone") ? <TableCell data-label="Milestone" className="px-3 py-2.5 text-sm">{r.milestoneTitle ?? <span className="text-muted-foreground">Unlinked</span>}</TableCell> : null}
            {has("deliverable") ? <TableCell data-label="Deliverable" className="px-3 py-2.5 text-sm">{r.deliverableTitle ?? <span className="text-muted-foreground">None</span>}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
