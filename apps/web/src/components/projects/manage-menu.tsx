"use client";

import { useState } from "react";
import type { StatusMove } from "@enginious-hr/domain";
import { MoreMenu, type MoreItem } from "@/components/workspace/more-menu";
import type { ManageAction, ManageItemData } from "@/lib/projects/workspace-nav";
import { EditDetailsDialog, ReopenDialog, type EditableProject } from "@/app/(app)/projects/[id]/overview-controls";
import { StatusDialog } from "./status-dialog";

/**
 * "Manage project": the one menu for everything that is not Overview, Work, Plan or Discussion. Pages open as pages; edits, status
 * changes and reopening open their small forms here. Which items exist is decided on the server (and enforced by the database).
 */
export function ManageMenu({ projectId, projectName, items, editable, moves, currentStatusLabel }: { projectId: string; projectName: string; items: ManageItemData[]; editable: EditableProject | null; moves: StatusMove[]; currentStatusLabel: string }) {
  const [dialog, setDialog] = useState<ManageAction | null>(null);
  const close = () => setDialog(null);
  const menu: MoreItem[] = items.map((i) => ({
    key: i.key, label: i.label, href: i.href, hint: i.hint, separatorBefore: i.separatorBefore,
    onSelect: i.action ? () => setDialog(i.action ?? null) : undefined,
  }));
  // Equipment (Inventory) is one more page under this menu, not a new project tab: it sits after Files & client plan.
  const filesAt = menu.findIndex((m) => m.key === "documents");
  menu.splice(filesAt >= 0 ? filesAt + 1 : menu.length, 0, { key: "equipment", label: "Equipment", href: `/projects/${projectId}/equipment`, hint: "Requests, reservations and what is still out" });
  return (
    <>
      <MoreMenu items={menu} label="Manage project" />
      {dialog === "edit" && editable ? <EditDetailsDialog p={editable} open onClose={close} /> : null}
      {dialog === "status" ? <StatusDialog projectId={projectId} projectName={projectName} moves={moves} currentLabel={currentStatusLabel} open onClose={close} /> : null}
      {dialog === "reopen" ? <ReopenDialog projectId={projectId} open onClose={close} /> : null}
    </>
  );
}
