import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  NOTE_KIND_WORDS, ageText, capacityWord, conditionWord, contentId, differenceLineNumbers, eventText, formatNoteInstant, lineIdentity, lineQtyText, lineTitle, noteStateWord, notePdfHref,
  outcomeWord, replacesNo, supersededByNo, totalQtyText, type NoteView,
} from "@/lib/inventory/project-notes";
import { cn } from "@/lib/utils";
import { AcknowledgeNote, ReportDifference, ResolveDifference, WithdrawDifference } from "./note-actions";

/** Download and print links for one note. The PDF is made on demand from the note's frozen content under the caller's own access. */
export function NotePdfLinks({ projectId, noteId, noteNo, size = "sm", className }: { projectId: string; noteId: string; noteNo: string; size?: "sm" | "default"; className?: string }) {
  const href = notePdfHref(projectId, noteId);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <a href={href} download className={buttonVariants({ size, variant: "outline" })}><Download className="mr-1.5 h-4 w-4" aria-hidden />Download PDF<span className="sr-only"> of {noteNo}</span></a>
      <a href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size, variant: "ghost" })}><Printer className="mr-1.5 h-4 w-4" aria-hidden />Open to print<span className="sr-only"> {noteNo}</span></a>
    </span>
  );
}

/**
 * One dispatch note or return checklist on Project -> Equipment: number, when, state, PDF, the recorded lines (and for a return, the project totals), the
 * acknowledgement history, and the actions the viewer can take. `canAnswer`: current PM, acting PM or Projects founder (the database re-checks). `canResolve`: a
 * warehouse operator or Inventory founder of the company that recorded it (the database re-checks the location). Everything shown is the frozen record plus its
 * append-only history; nothing here moves stock.
 */
export function NoteCard({ view, canAnswer, canResolve, now, open }: { view: NoteView; canAnswer: boolean; canResolve: boolean; now: Date; open?: boolean }) {
  const n = view.note;
  const st = view.status;
  const tz = n.location_timezone;
  const isReturn = n.kind === "return";
  const state = noteStateWord(st, canAnswer, supersededByNo(view));
  const replaces = replacesNo(view);
  const reportedLines = new Set(differenceLineNumbers(st.difference_lines));
  const reportEvent = [...view.events].reverse().find((e) => e.event === "difference_reported");
  const waiting = st.awaiting !== null;
  return (
    <details id={`note-${n.id}`} open={open} className="rounded-lg border border-border bg-card" data-note-no={n.note_no} data-state={st.state}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="font-mono font-medium">{n.note_no}</span>
        <Badge variant={state.tone}>{state.label}</Badge>
        <span className="text-muted-foreground">{NOTE_KIND_WORDS[n.kind]} · {formatNoteInstant(n.occurred_at, tz)}</span>
        {waiting ? <span className="text-muted-foreground">waiting {ageText(st.pending_since, now)}</span> : null}
        <span className="text-muted-foreground">{view.payload.lines.length} {view.payload.lines.length === 1 ? "line" : "lines"}</span>
      </summary>
      <div className="space-y-4 border-t border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dl className="grid min-w-0 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="inline text-muted-foreground">{isReturn ? "Received at " : "From "}</dt><dd className="inline break-words">{n.location_name}</dd></div>
            {n.destination ? <div><dt className="inline text-muted-foreground">{isReturn ? "Returned from " : "Destination "}</dt><dd className="inline break-words">{n.destination}</dd></div> : null}
            <div><dt className="inline text-muted-foreground">{isReturn ? "Received by " : "Recorded by "}</dt><dd className="inline break-words">{n.recorded_by_name}</dd></div>
            <div><dt className="inline text-muted-foreground">Ledger </dt><dd className="inline font-mono">{n.movement_code}</dd></div>
            {n.request_code ? <div><dt className="inline text-muted-foreground">Request </dt><dd className="inline font-mono">{n.request_code}</dd></div> : null}
            {n.expected_return_at ? <div><dt className="inline text-muted-foreground">Expected back </dt><dd className="inline">{formatNoteInstant(n.expected_return_at, tz)}</dd></div> : null}
            {replaces ? <div><dt className="inline text-muted-foreground">Replaces </dt><dd className="inline font-mono">{replaces}</dd></div> : null}
            <div><dt className="inline text-muted-foreground">Content ID </dt><dd className="inline font-mono">{contentId(n.payload_hash)}</dd></div>
          </dl>
          <NotePdfLinks projectId={n.project_id} noteId={n.id} noteNo={n.note_no} />
        </div>

        <section aria-label={`${isReturn ? "Returned" : "Dispatched"} lines of ${n.note_no}`}>
          <h4 className="mb-1 text-sm font-semibold">{isReturn ? "This return (what the warehouse recorded as received)" : "What was dispatched"}</h4>
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {view.payload.lines.map((l) => (
              <li key={l.n} className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2", reportedLines.has(l.n) && st.difference_state === "open" && "bg-destructive/5")} data-line={l.n}>
                <span className="min-w-0 break-words font-medium">{l.n}. {lineTitle(l)}<span className="font-normal text-muted-foreground"> · {lineIdentity(l)}</span></span>
                <span className="text-muted-foreground">
                  {lineQtyText(l)} · {isReturn ? <>{outcomeWord(l.outcome)}{l.outcome === "held" ? `: ${conditionWord(l.condition).toLowerCase()}` : ""}</> : conditionWord(l.condition)}
                  {reportedLines.has(l.n) && st.difference_state === "open" ? <Badge variant="destructive" className="ml-2">Difference reported</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {isReturn && view.payload.totals.length > 0 ? (
          <section aria-label={`Project totals after ${n.note_no}`}>
            <h4 className="mb-1 text-sm font-semibold">Project totals after this return</h4>
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {view.payload.totals.map((t, i) => (
                <li key={`${t.itemName}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
                  <span className="min-w-0 break-words font-medium">{t.itemName}{t.individual ? null : <Badge variant="outline" className="ml-2 align-middle">Project level</Badge>}</span>
                  <span className="text-muted-foreground">Sent {totalQtyText(t.sent, t)} · back before {totalQtyText(t.returnedBefore, t)} · back now {totalQtyText(t.receivedNow, t)} · still out <strong className="text-foreground">{totalQtyText(t.stillOut, t)}</strong></span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">Units are exact. Counted stock is shown for the whole project, not per request: the system does not guess which request it belongs to. Confirming this list changes no stock and releases no equipment; a damaged or unchecked item is released only by a warehouse condition check.</p>
          </section>
        ) : null}

        <section aria-label={`History of ${n.note_no}`}>
          <h4 className="mb-1 text-sm font-semibold">{isReturn ? "Confirmation and history" : "Acknowledgement and history"}</h4>
          <ol className="space-y-1 text-sm">
            <li className="text-muted-foreground">{formatNoteInstant(n.created_at, tz)}: Recorded by {n.recorded_by_name}.</li>
            {view.events.map((e) => (
              <li key={e.id} data-event={e.event}>
                <span className="text-muted-foreground">{formatNoteInstant(e.at, tz)}:</span> {eventText(e, n.kind, view.noteNos)}
              </li>
            ))}
            {st.acknowledged_at === null && st.state !== "superseded" ? <li className="font-medium">{st.difference_state === "open" ? "Waiting for the warehouse to answer the reported difference." : `Waiting for the Project Manager (${ageText(st.pending_since, now)}). Nothing is blocked while it waits.`}</li> : null}
          </ol>
          {st.acknowledged_at ? <p className="mt-1 text-xs text-muted-foreground">{capacityWord(st.acknowledged_capacity)} acknowledgement of the recorded list in ENGINIOUS OS, using an authenticated account.</p> : null}
        </section>

        {st.state !== "superseded" && (canAnswer || canResolve) ? (
          <div className="flex flex-wrap items-start gap-3" data-actions>
            {canAnswer && st.acknowledged_at === null && st.difference_state !== "open" ? <AcknowledgeNote noteId={n.id} projectId={n.project_id} kind={n.kind} /> : null}
            {canAnswer && st.difference_state !== "open" ? <ReportDifference noteId={n.id} projectId={n.project_id} kind={n.kind} lines={view.payload.lines} /> : null}
            {canAnswer && st.difference_state === "open" ? <WithdrawDifference noteId={n.id} projectId={n.project_id} /> : null}
            {canResolve && st.difference_state === "open" ? (
              <ResolveDifference
                noteId={n.id} projectId={n.project_id} noteNo={n.note_no} kind={n.kind} reason={st.difference_reason} reportedBy={reportEvent?.by_name ?? null} comment={reportEvent?.comment ?? null}
                lines={view.payload.lines.filter((l) => reportedLines.has(l.n))}
              />
            ) : null}
          </div>
        ) : null}
        {st.state === "superseded" && supersededByNo(view) && st.superseded_by_note_id ? (
          <p className="text-sm">This note has been replaced. <Link href={`?note=${st.superseded_by_note_id}#note-${st.superseded_by_note_id}`} className="font-medium underline underline-offset-2">Open {supersededByNo(view)}</Link></p>
        ) : null}
      </div>
    </details>
  );
}
