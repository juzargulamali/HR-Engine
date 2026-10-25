/**
 * The ONE handover process, as staff see it in Sales and in Projects:
 *   Prepare brief → Submit → Assign PM → PM accepts → Project created
 * It is read from the Projects handover record alone (proj_handovers.status); there is no second status to keep in step.
 */
export type StepState = "done" | "current" | "todo";
export interface ProcessStep { key: "prepare" | "submit" | "assign" | "accept" | "created"; label: string; who: string; state: StepState; note: string | null }
export interface HandoverProcess { steps: ProcessStep[]; /** What happens next, and who does it, in words. */ next: string }

const STEPS: { key: ProcessStep["key"]; label: string; who: string }[] = [
  { key: "prepare", label: "Prepare brief", who: "Sales owner" },
  { key: "submit", label: "Submit", who: "Sales owner" },
  { key: "assign", label: "Assign PM", who: "Founder, or someone they gave PM assignment" },
  { key: "accept", label: "PM accepts", who: "Project Manager" },
  { key: "created", label: "Project created", who: "Automatic when the PM accepts" },
];

/** How many steps are finished for each status of the Projects handover. `null` means no handover has been started. */
const DONE: Record<string, number> = { draft: 1, submitted: 2, pm_assigned: 3, clarification_requested: 3, accepted: 5, withdrawn: 0 };

const NEXT: Record<string, string> = {
  none: "Next: the Sales owner prepares the delivery brief below. Nobody in delivery is told until it is submitted.",
  draft: "Next: the Sales owner reviews the brief and submits it. Nobody in delivery is told until then.",
  submitted: "Next: a founder (or someone they gave PM assignment to) names the Project Manager.",
  pm_assigned: "Next: the Project Manager accepts the brief, which creates the project, or asks Sales to clarify.",
  clarification_requested: "Next: the Sales owner answers the Project Manager's question and resubmits. The same Project Manager then decides.",
  accepted: "Done: the Project Manager accepted it and the project exists. The brief is kept as the agreed snapshot.",
  withdrawn: "Withdrawn before acceptance. Nothing was created. Prepare the brief again to restart.",
};

export function handoverProcess(status: string | null | undefined): HandoverProcess {
  const key = status && status in DONE ? status : "none";
  const done = key === "none" ? 0 : (DONE[key] ?? 0);
  const steps: ProcessStep[] = STEPS.map((s, i) => ({
    ...s,
    state: i < done ? "done" : i === done && key !== "accepted" ? "current" : "todo",
    note: null,
  }));
  if (key === "clarification_requested") {
    const accept = steps.find((s) => s.key === "accept");
    if (accept) { accept.note = "Waiting for Sales to answer the Project Manager's question"; accept.who = "Project Manager, after Sales resubmits"; }
  }
  return { steps, next: NEXT[key] ?? NEXT.none! };
}
