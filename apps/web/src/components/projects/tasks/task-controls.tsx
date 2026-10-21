"use client";

import { useId, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { reassignProjectTask, setProjectTaskStatus } from "@/lib/actions/projectsDelivery";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { InlineSelect } from "@/components/workspace/inline-edit";
import { TASK_STATUS_LABELS, type TaskStatus } from "@enginious-hr/domain";
import { TaskStatusBadge } from "@/components/projects/badges";
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
  const id = useId();
  const [dialog, setDialog] = useState<TaskMoveSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(CURRENT);
  const [pending, start] = useTransition();
  if (row.moves.length === 0) return <TaskStatusBadge status={row.status} />;
  const current = TASK_STATUS_LABELS[row.status as TaskStatus] ?? row.status;
  return (
    <div>
      <label htmlFor={id} className="sr-only">Status of {row.title}</label>
      <Select
        id={id}
        value={shown}
        disabled={pending}
        aria-busy={pending}
        aria-invalid={error ? true : undefined}
        className="h-8 min-w-[9.5rem] py-0 text-[13px]"
        onChange={(e) => {
          const index = Number(e.target.value.replace("m", ""));
          const move = row.moves[index];
          setError(null);
          if (!move) return;
          if (move.mode === "dialog") { setShown(CURRENT); setDialog(move); return; }
          setShown(e.target.value);
          start(async () => {
            let r: { error: string | null };
            try { r = await saveMove(row, move.to); } catch { r = { error: "The change could not be saved. Check your connection and try again." }; }
            if (r.error) setError(r.error);
            setShown(CURRENT);
          });
        }}
      >
        <option value={CURRENT}>{pending ? "Saving…" : current}</option>
        <optgroup label="Change to">
          {row.moves.map((m, i) => <option key={`${m.to}-${m.label}`} value={`m${i}`}>{m.label}{m.mode === "dialog" ? "…" : ""}</option>)}
        </optgroup>
      </Select>
      {error ? <p role="alert" className="mt-0.5 text-[13px] text-destructive">{error}</p> : null}
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
  if (!row.canReassign) return <span>{row.assigneeName}</span>;
  return (
    <InlineSelect
      label={`Assignee of ${row.title}`}
      value={row.assigneeId}
      options={row.reassignOptions.map((o) => ({ value: o.id, label: o.name }))}
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
