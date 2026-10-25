"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { reassignProjectTask, setProjectTaskStatus } from "@/lib/actions/projectsDelivery";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { OsAvatar } from "@/components/os/pills";
import { TASK_STATUS_LABELS, type TaskStatus } from "@enginious-hr/domain";
import { OsChoiceMenu, type OsChoice } from "@/components/os/choice-menu";
import { statusTone, TaskStatusBadge } from "@/components/projects/badges";
import { DueDateForm, StatusMoveForm } from "./task-forms";
import type { TaskMoveSpec } from "./task-logic";

/** The few fields of a row the controls need (plain data, so it can cross from the server page to the browser). */
export interface ControlRow {
  id: string;
  projectId: string;
  title: string;
  status: string;
  version: number;
  moves: TaskMoveSpec[];
  dueDate: string | null;
  startDate?: string | null;
  due: { text: string; overdue: boolean };
  canChangeDue: boolean;
  assigneeId: string;
  assigneeName: string;
  canReassign: boolean;
  reassignOptions: { id: string; name: string }[];
}

const CURRENT = "__current";

/** Runs the existing status action with one move; the action (and the database) decide whether it is allowed. */
export async function saveMove(row: Pick<ControlRow, "id" | "projectId" | "version">, to: string): Promise<{ error: string | null }> {
  const fd = new FormData();
  fd.set("projectId", row.projectId);
  fd.set("taskId", row.id);
  fd.set("to", to);
  fd.set("expectedVersion", String(row.version));
  const r = await setProjectTaskStatus({ error: null }, fd);
  return { error: r.error };
}

/**
 * The status of a task as a control. It lists only the moves this person may make. A plain move (Start, Back to To do, Mark done on a
 * routine task) is saved as soon as it is chosen; anything that needs a reason, a review or a decision (sending for review, accepting
 * reviewed work, requesting changes, reopening, deferring, cancelling) opens a small form first. With no moves it is just the status.
 */
export function TaskStatusControl({ row }: { row: ControlRow }) {
  const [dialog, setDialog] = useState<TaskMoveSpec | null>(null);
  if (row.moves.length === 0) return <TaskStatusBadge status={row.status} />;
  const current = TASK_STATUS_LABELS[row.status as TaskStatus] ?? row.status;
  const choices: OsChoice[] = [
    { value: CURRENT, label: current, tone: statusTone(row.status) },
    ...row.moves.map((m, i) => ({ value: `m${i}`, label: `${m.label}${m.mode === "dialog" ? "…" : ""}`, tone: statusTone(m.to) })),
  ];
  return (
    <div>
      <OsChoiceMenu
        label={`Status of ${row.title}`}
        value={CURRENT}
        choices={choices}
        onSave={async (next) => {
          const move = row.moves[Number(next.replace("m", ""))];
          if (!move) return { error: null };
          if (move.mode === "dialog") { setDialog(move); return { error: null }; }
          try { return await saveMove(row, move.to); } catch { return { error: "The change could not be saved. Check your connection and try again." }; }
        }}
      />
      <Modal open={dialog !== null} onClose={() => setDialog(null)} title={dialog?.label ?? ""}>
        {dialog ? <StatusMoveForm projectId={row.projectId} taskId={row.id} version={row.version} move={dialog} taskTitle={row.title} onDone={() => setDialog(null)} /> : null}
      </Modal>
    </div>
  );
}

/** The due date as text; for people who may change it, a "Change" button opens a small form (reason, impact on dependent tasks). */
export function TaskDueControl({ row }: { row: ControlRow }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className={row.due.overdue ? "font-medium text-destructive" : undefined}>{row.due.text}</span>
        {row.canChangeDue ? (
          <button type="button" onClick={() => setOpen(true)} aria-label={`Change due date of ${row.title}`} className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {notice ? <Alert variant="warning" role="status" className="mt-1 px-2 py-1 text-[13px]">{notice}</Alert> : null}
      <Modal open={open} onClose={() => setOpen(false)} title="Change due date" description={row.title}>
        <DueDateForm projectId={row.projectId} taskId={row.id} version={row.version} currentDue={row.dueDate} startDate={row.startDate ?? null} onDone={(w) => { setNotice(w); setOpen(false); }} />
      </Modal>
    </div>
  );
}

/**
 * The assignee. Only the PM / founder and the head of the task's team get a control (the same people who may reassign today); a task
 * owner sees the name as text, however many columns the table has. The database refuses anyone else regardless.
 */
export function TaskAssigneeControl({ row }: { row: ControlRow }) {
  if (!row.canReassign) return <span className="inline-flex items-center gap-2"><OsAvatar name={row.assigneeName} size="sm" /><span className="truncate">{row.assigneeName}</span></span>;
  return (
    <OsChoiceMenu
      label={`Assignee of ${row.title}`}
      value={row.assigneeId}
      pill={false}
      choices={[...(row.reassignOptions.some((o) => o.id === row.assigneeId) ? [] : [{ id: row.assigneeId, name: row.assigneeName }]), ...row.reassignOptions].map((o) => ({ value: o.id, label: o.name, avatar: o.name }))}
      onSave={async (next) => {
        const fd = new FormData();
        fd.set("projectId", row.projectId);
        fd.set("taskId", row.id);
        fd.set("assigneeId", next);
        const r = await reassignProjectTask({ error: null }, fd);
        return { error: r.error };
      }}
    />
  );
}
