import { Panel, Muted } from "@/components/projects/parts";
import { LoadError } from "@/components/workspace/states";
import type { NoteView } from "@/lib/inventory/project-notes";
import { NoteCard } from "./note-card";

/**
 * "Dispatch & return notes" on Project -> Equipment. The pending action lives on each note record, so it is listed here for as long as it is pending, whoever
 * is looking: the Project Manager, an acting Project Manager or a Projects founder sees "Dispatch waiting for you" / "Returned, please confirm" with the
 * Acknowledge control; other members see the same notes as waiting for the Project Manager. Nothing waits for the answer. A failed read says so.
 * The section is not drawn at all when the project has no notes (for example while the company has not switched notes on).
 */
export function NotesSection({ notes, canAnswer, canResolveFor, now, openNoteId }: {
  notes: readonly NoteView[]; canAnswer: boolean; canResolveFor: (companyId: string) => boolean; now: Date; openNoteId?: string | null;
}) {
  if (notes.length === 0) return null;
  const pending = notes.filter((v) => v.status.state === "waiting_for_pm");
  const differences = notes.filter((v) => v.status.state === "difference_open");
  const rest = notes.filter((v) => v.status.state !== "waiting_for_pm" && v.status.state !== "difference_open");
  const dispatchWaiting = pending.filter((v) => v.note.kind === "dispatch");
  const returnWaiting = pending.filter((v) => v.note.kind === "return");
  // A return checklist's totals count what was sent in the project's earlier dispatch notes: they are named so the two documents can be read together (never attributed to one request line).
  const sentIn = (v: NoteView) => v.note.kind === "return" ? notes.filter((d) => d.note.kind === "dispatch" && d.note.created_at <= v.note.created_at).sort((a, b) => a.note.created_at.localeCompare(b.note.created_at)).map((d) => d.note.note_no) : [];
  const card = (v: NoteView, open: boolean) => <NoteCard key={v.note.id} view={v} canAnswer={canAnswer} canResolve={canResolveFor(v.note.company_id)} now={now} open={open || openNoteId === v.note.id} sentIn={sentIn(v)} />;
  return (
    <Panel id="notes" title="Dispatch & return notes" description="What the warehouse recorded as sent to this project and received back, kept exactly as recorded. The Project Manager acknowledges each one; nothing waits for the answer.">
      <div className="space-y-5">
        {dispatchWaiting.length > 0 ? (
          <section aria-label={canAnswer ? "Dispatch waiting for you" : "Dispatch waiting for the Project Manager"} className="space-y-2">
            <h3 className="text-sm font-semibold">{canAnswer ? "Dispatch waiting for you" : "Dispatch waiting for the Project Manager"} ({dispatchWaiting.length})</h3>
            {dispatchWaiting.map((v) => card(v, true))}
          </section>
        ) : null}
        {returnWaiting.length > 0 ? (
          <section aria-label={canAnswer ? "Returned, please confirm" : "Returned, waiting for the Project Manager"} className="space-y-2">
            <h3 className="text-sm font-semibold">{canAnswer ? "Returned, please confirm" : "Returned, waiting for the Project Manager"} ({returnWaiting.length})</h3>
            {returnWaiting.map((v) => card(v, true))}
          </section>
        ) : null}
        {differences.length > 0 ? (
          <section aria-label="Difference reported" className="space-y-2">
            <h3 className="text-sm font-semibold">Difference reported, waiting for the warehouse ({differences.length})</h3>
            {differences.map((v) => card(v, true))}
          </section>
        ) : null}
        {rest.length > 0 ? (
          <section aria-label="Other notes" className="space-y-2">
            <h3 className="text-sm font-semibold">{pending.length + differences.length > 0 ? "Other notes" : "Notes"} ({rest.length})</h3>
            {rest.map((v) => card(v, false))}
          </section>
        ) : null}
        <Muted>A correction is a new note that cites the old one. The old note and its history are never changed.</Muted>
      </div>
    </Panel>
  );
}

/** The notes could not be read: the page says so; it is never shown as "no notes". */
export function NotesLoadError({ projectId }: { projectId: string }) {
  return <LoadError what="the dispatch and return notes of this project" retryHref={`/projects/${projectId}/equipment`} note="Whether a note is waiting for acknowledgement is not known right now. This is a problem loading the information, not an empty list." />;
}
