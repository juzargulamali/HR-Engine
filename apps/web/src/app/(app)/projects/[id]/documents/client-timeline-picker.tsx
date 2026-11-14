"use client";

import { saveClientTimelineSelection } from "@/lib/actions/projectsTimelineSelect";
import { ActionForm } from "@/components/sales/action-form";
import { InfoHint } from "@/components/ui/info-hint";

export type PickerRow = { kind: "mile" | "item"; id: string; title: string; when: string; group: string; clientFacing: boolean; version: number };

/**
 * One deliberate place to choose what the client sees: every existing milestone and timeline activity with a tick box. Saving flips only the boxes that changed (through the
 * same functions the item pages use); versions already issued are never touched. The "what would be issued now" preview below reflects the ticks after saving.
 */
export function ClientTimelinePicker({ projectId, rows, canEdit }: { projectId: string; rows: PickerRow[]; canEdit: boolean }) {
  const groups = Array.from(new Set(rows.map((r) => r.group)));
  const chosen = rows.filter((r) => r.clientFacing).length;
  return (
    <ActionForm action={saveClientTimelineSelection} submitLabel="Save what the client sees" className="space-y-4" disabled={!canEdit}>
      <input type="hidden" name="projectId" value={projectId} />
      <p className="text-sm" data-testid="ct-picker-count">
        {chosen === 0 ? "Nothing is client-facing yet, so an issued timeline would be empty." : `${chosen} of ${rows.length} will be on the next issued timeline.`}
        <InfoHint label="choosing what the client sees" className="ml-1">Tick a milestone or activity to put it on the next issued client timeline; untick it to take it off. Internal tasks, equipment and notes are never included. Issued versions stay exactly as issued; change the ticks and issue again to send a new version.</InfoHint>
      </p>
      {groups.map((g) => (
        <fieldset key={g} className="space-y-1">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</legend>
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.filter((r) => r.group === g).map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex items-start gap-3 px-3 py-2">
                <input type="hidden" name={`${r.kind}was_${r.id}`} value={r.clientFacing ? "1" : "0"} />
                <input type="hidden" name={`${r.kind}ver_${r.id}`} value={r.version} />
                <input id={`ct-${r.kind}-${r.id}`} type="checkbox" name={`${r.kind}_${r.id}`} defaultChecked={r.clientFacing} disabled={!canEdit} className="mt-1 h-4 w-4 shrink-0" data-testid={`ct-pick-${r.id}`} />
                <label htmlFor={`ct-${r.kind}-${r.id}`} className="min-w-0 flex-1 text-sm">
                  <span className="block break-words font-medium">{r.title}</span>
                  <span className="block text-[13px] text-muted-foreground">{r.when}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
    </ActionForm>
  );
}
