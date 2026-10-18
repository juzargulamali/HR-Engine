import { PanelLink } from "@/components/workspace/panel-link";
import { withParams } from "@/components/workspace/url-state";
import { TaskFlags, toControlRow } from "./task-table";
import { TaskBoardClient } from "./task-board-client";
import { boardColumnOf, type TaskRowData } from "./task-logic";

/** The board view: cards by status. Cards are built here on the server (so only what the person may see reaches the browser). */
export function TaskBoard({ rows, basePath, current, showProject, panelParam = "task" }: { rows: readonly TaskRowData[]; basePath: string; current: Record<string, string>; showProject: boolean; panelParam?: string }) {
  const onBoard = rows.filter((r) => boardColumnOf(r.status) !== null);
  const off = rows.length - onBoard.length;
  return (
    <div className="space-y-3">
      <TaskBoardClient
        cards={onBoard.map((r) => ({
          row: toControlRow(r),
          card: (
            <div className="text-sm">
              <PanelLink href={withParams(basePath, current, { [panelParam]: r.id })} className="break-words font-medium leading-snug underline-offset-2 hover:underline">{r.title}</PanelLink>
              {showProject ? <p className="mt-0.5 break-words text-muted-foreground">{r.projectName}</p> : null}
              <TaskFlags r={r} />
              <p className="mt-1.5 text-muted-foreground">{r.assigneeName}</p>
              <p className={r.due.overdue ? "font-medium text-destructive" : "text-muted-foreground"}>{r.due.text}</p>
            </div>
          ),
        }))}
      />
      {off > 0 ? <p className="text-sm text-muted-foreground">{off} deferred or cancelled task{off === 1 ? " is" : "s are"} not on the board. Switch to Table to see {off === 1 ? "it" : "them"}.</p> : null}
    </div>
  );
}
