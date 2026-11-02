"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { MoreMenu, type MoreItem } from "@/components/workspace/more-menu";
import { BlockForm, EditTaskForm, ReassignForm, UnblockForm, type EditableTask } from "./task-forms";
import type { PickOption } from "./task-logic";

type Dialog = "edit" | "reassign" | "block" | "unblock" | null;

/**
 * "Report a blocker" is a visible button on the task (the common case: two clicks and one field to type); the less frequent things sit in one
 * "More" menu: edit, reassign, clear a blocker. Each opens a small form. Which items appear is decided by the page from the viewer's real rights; the database enforces them again.
 */
export function TaskActionsMenu({ projectId, task, leader, canEdit, canReassign, canBlock, canUnblock, members, defaultUnblocker, reassignOptions, otherTasks, teams, deliverables, milestones }: {
  projectId: string;
  task: EditableTask & { assignee_id: string };
  leader: boolean;
  canEdit: boolean;
  canReassign: boolean;
  canBlock: boolean;
  canUnblock: boolean;
  members: PickOption[];
  /** The member pre-filled as responsible for unblocking (required, editable); empty when nobody fits. */
  defaultUnblocker: string;
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
    ...(canUnblock ? [{ key: "unblock", label: "Clear blocker", separatorBefore: canEdit || canReassign }] : []),
  ].map((i) => ({ ...i, onSelect: (k: string) => setDialog(k as Dialog) }));
  if (items.length === 0 && !canBlock) return null;
  const close = () => setDialog(null);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canBlock ? <Button type="button" variant="outline" size="sm" onClick={() => setDialog("block")}>Report a blocker</Button> : null}
        {items.length > 0 ? <MoreMenu items={items} label="More" /> : null}
      </div>
      {notice ? <Alert variant="warning" role="status" className="basis-full">{notice}</Alert> : null}
      <Modal open={dialog === "edit"} onClose={close} title="Edit task" size="wide">
        <EditTaskForm projectId={projectId} task={task} leader={leader} otherTasks={otherTasks} collaboratorOptions={members.filter((m) => m.id !== task.assignee_id)} teams={teams} deliverables={deliverables} milestones={milestones} onDone={(w) => { setNotice(w); close(); }} />
      </Modal>
      <Modal open={dialog === "reassign"} onClose={close} title="Reassign this task">
        <ReassignForm projectId={projectId} taskId={task.id} currentAssignee={task.assignee_id} options={reassignOptions} onDone={close} />
      </Modal>
      <Modal open={dialog === "block"} onClose={close} title="Report a blocker" description={task.title}>
        <BlockForm projectId={projectId} taskId={task.id} members={members} defaultOwner={defaultUnblocker} onDone={close} />
      </Modal>
      <Modal open={dialog === "unblock"} onClose={close} title="Clear the blocker">
        <UnblockForm projectId={projectId} taskId={task.id} onDone={close} />
      </Modal>
    </>
  );
}
