"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { MoreMenu, type MoreItem } from "@/components/workspace/more-menu";
import { BlockForm, EditTaskForm, ReassignForm, UnblockForm, type EditableTask } from "./task-forms";
import type { PickOption } from "./task-logic";

type Dialog = "edit" | "reassign" | "block" | "unblock" | null;

/**
 * The less frequent things to do with a task, in one "More" menu: edit, reassign, block, clear a blocker. Each opens the same small
 * form as before. Which items appear is decided by the page from the viewer's real rights; the database enforces them again.
 */
export function TaskActionsMenu({ projectId, task, leader, canEdit, canReassign, canBlock, canUnblock, members, reassignOptions, otherTasks, teams, deliverables, milestones }: {
  projectId: string;
  task: EditableTask & { assignee_id: string };
  leader: boolean;
  canEdit: boolean;
  canReassign: boolean;
  canBlock: boolean;
  canUnblock: boolean;
  members: PickOption[];
  reassignOptions: PickOption[];
  otherTasks: PickOption[];
  teams: PickOption[];
  deliverables: PickOption[];
  milestones: PickOption[];
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const items: MoreItem[] = [
    ...(canEdit ? [{ key: "edit", label: "Edit task", hint: "Title, dates, department, review rule, dependencies" }] : []),
    ...(canReassign ? [{ key: "reassign", label: "Reassign" }] : []),
    ...(canBlock ? [{ key: "block", label: "Block task", separatorBefore: true }] : []),
    ...(canUnblock ? [{ key: "unblock", label: "Clear blocker", separatorBefore: !canBlock }] : []),
  ].map((i) => ({ ...i, onSelect: (k: string) => setDialog(k as Dialog) }));
  if (items.length === 0) return null;
  const close = () => setDialog(null);
  return (
    <>
      <MoreMenu items={items} label="More" />
      {notice ? <Alert variant="warning" role="status" className="basis-full">{notice}</Alert> : null}
      <Modal open={dialog === "edit"} onClose={close} title="Edit task" size="wide">
        <EditTaskForm projectId={projectId} task={task} leader={leader} otherTasks={otherTasks} collaboratorOptions={members.filter((m) => m.id !== task.assignee_id)} teams={teams} deliverables={deliverables} milestones={milestones} onDone={(w) => { setNotice(w); close(); }} />
      </Modal>
      <Modal open={dialog === "reassign"} onClose={close} title="Reassign this task">
        <ReassignForm projectId={projectId} taskId={task.id} currentAssignee={task.assignee_id} options={reassignOptions} onDone={close} />
      </Modal>
      <Modal open={dialog === "block"} onClose={close} title="Block this task">
        <BlockForm projectId={projectId} taskId={task.id} members={members} onDone={close} />
      </Modal>
      <Modal open={dialog === "unblock"} onClose={close} title="Clear the blocker">
        <UnblockForm projectId={projectId} taskId={task.id} onDone={close} />
      </Modal>
    </>
  );
}
