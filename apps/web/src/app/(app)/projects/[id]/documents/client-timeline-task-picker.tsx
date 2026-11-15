"use client";

import { useState } from "react";
import { saveClientTimelineTasks } from "@/lib/actions/projectsTimelineSelect";
import { ActionForm } from "@/components/sales/action-form";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";

export type TaskPickRow = { id: string; title: string; when: string; statusLabel: string; chosen: boolean; clientTitle: string | null };

/**
 * Individual tasks for the next client timeline, by explicit choice only: nothing is ticked unless the Project Manager ticked it before, and there is no way to tick
 * everything at once. Each ticked task needs the title the client will read (offered from the task's own title, to be reworded when that is internal). The client sees
 * that title, the dates and the status in plain words, and nothing else of the task; the preview below shows it exactly. Issued versions are never touched.
 */
export function ClientTimelineTaskPicker({ projectId, rows, canEdit }: { projectId: string; rows: TaskPickRow[]; canEdit: boolean }) {
  const [ticked, setTicked] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.id, r.chosen])));
  const chosen = rows.filter((r) => ticked[r.id]).length;
  return (
    <ActionForm action={saveClientTimelineTasks} submitLabel="Save the chosen tasks" className="space-y-3" disabled={!canEdit}>
      <input type="hidden" name="projectId" value={projectId} />
      <p className="text-sm" data-testid="ct-task-count">
        {chosen === 0 ? "No task is on the client timeline." : `${chosen} of ${rows.length} ${rows.length === 1 ? "task" : "tasks"} will be on the next issued timeline.`}
        <InfoHint label="tasks on the client timeline" className="ml-1">
          <p>Tick only the tasks the client should see, one by one. Nothing is ticked for you.</p>
          <p className="mt-1.5">The client sees the title you give here, the task&apos;s dates and whether it is planned, in progress, done or postponed. Notes, files and outputs, who it is assigned to, why it is blocked, comments and costs are never included.</p>
          <p className="mt-1.5">Check the preview below before issuing. Issued versions stay exactly as issued.</p>
        </InfoHint>
      </p>
      <ul className="divide-y divide-border rounded-md border border-border" data-testid="ct-task-list">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2">
            <input id={`ct-task-${r.id}`} type="checkbox" name={`task_${r.id}`} checked={!!ticked[r.id]} disabled={!canEdit} className="mt-1 h-4 w-4 shrink-0" data-testid={`ct-task-pick-${r.id}`}
              onChange={(e) => setTicked((t) => ({ ...t, [r.id]: e.target.checked }))} />
            <label htmlFor={`ct-task-${r.id}`} className="min-w-0 flex-1 basis-56 text-sm">
              <span className="block break-words font-medium">{r.title}</span>
              <span className="block text-[13px] text-muted-foreground">{r.when} · {r.statusLabel}</span>
            </label>
            {ticked[r.id] ? (
              <label className="w-full space-y-1 text-[13px] sm:w-72">
                <span className="block font-medium">Title the client sees</span>
                <Input name={`tasktitle_${r.id}`} defaultValue={r.clientTitle ?? r.title} maxLength={200} required disabled={!canEdit} data-testid={`ct-task-title-${r.id}`} />
              </label>
            ) : null}
          </li>
        ))}
      </ul>
    </ActionForm>
  );
}
