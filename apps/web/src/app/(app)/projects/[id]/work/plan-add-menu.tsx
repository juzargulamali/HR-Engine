"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { MoreMenu } from "@/components/workspace/more-menu";
import { DeliverableForm } from "./deliverable-forms";
import { MilestoneForm } from "./milestone-forms";
import type { PickOption } from "./helpers";

/**
 * Where milestones and deliverables are added, so the main button of the Work section can stay "Add task". Same forms as before (the PM
 * adds milestones; the PM gives a deliverable to a project team), shown in a dialog.
 */
export function PlanAddMenu({ projectId, teams, milestones }: { projectId: string; teams: PickOption[]; milestones: PickOption[] }) {
  const [open, setOpen] = useState<"milestone" | "deliverable" | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <MoreMenu
        label="Plan"
        items={[
          { key: "milestone", label: "Add milestone", hint: "A point the project is accepted against", onSelect: () => setOpen("milestone") },
          { key: "deliverable", label: "Add work package", hint: "A piece of work for one project team", onSelect: () => setOpen("deliverable") },
        ]}
      />
      <Modal open={open === "milestone"} onClose={close} title="New milestone">
        <MilestoneForm projectId={projectId} onDone={close} />
      </Modal>
      <Modal open={open === "deliverable"} onClose={close} title="New work package" description="A work package is a piece of work assigned to one project team, whose head then distributes the tasks.">
        <DeliverableForm projectId={projectId} teams={teams} milestones={milestones} leaderOnly onDone={close} />
      </Modal>
    </>
  );
}
