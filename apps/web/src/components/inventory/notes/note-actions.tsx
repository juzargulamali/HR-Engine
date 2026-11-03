"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { answerNote, resolveDifference } from "@/lib/actions/inventoryNotes";
import { DIFFERENCE_REASONS, lineIdentity, lineQtyText, lineTitle, reasonWord, type NoteLine } from "@/lib/inventory/project-notes";
import { Field, InvForm } from "../planning/inv-form";

/**
 * What the Project Manager (or an acting Project Manager, or a Projects founder) can do with a note. Nothing waits for it, nothing here changes stock:
 * acknowledging says "I acknowledge this recorded list"; a difference names the lines and what differs and goes to the warehouse. The database checks who
 * may answer at the moment of the click and records the capacity; these controls are only offered to people who can.
 */
export function AcknowledgeNote({ noteId, projectId, kind }: { noteId: string; projectId: string; kind: "dispatch" | "return" }) {
  const uid = useId();
  const [note, setNote] = useState(false);
  const word = kind === "return" ? "Confirm this list" : "Acknowledge";
  return (
    <InvForm action={answerNote} submitLabel={word} pendingLabel="Saving…" className="space-y-2" secondary={
      <Button type="button" variant="ghost" size="sm" aria-expanded={note} onClick={() => setNote((v) => !v)}>{note ? "No note" : "Add a note (optional)"}</Button>
    }>
      <input type="hidden" name="noteId" value={noteId} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="action" value="acknowledge" />
      {note ? (
        <Field label="Note (optional)" htmlFor={`${uid}-n`} hint="For example “there is a difference, I will report the lines”. A note does not report a difference; use Report a difference for that.">
          <Textarea id={`${uid}-n`} name="comment" maxLength={2000} rows={2} />
        </Field>
      ) : null}
      <p className="text-xs text-muted-foreground">{kind === "return" ? "This says you acknowledge the list the warehouse recorded as received. It does not move or release any equipment." : "This says you acknowledge the list the warehouse recorded as sent. It is not a statement that everything arrived, and it does not move any equipment."}</p>
    </InvForm>
  );
}

/** Report a difference: lines (none ticked to begin with), what is different (none chosen to begin with), and a comment. The warehouse owns the next step. */
export function ReportDifference({ noteId, projectId, kind, lines }: { noteId: string; projectId: string; kind: "dispatch" | "return"; lines: readonly NoteLine[] }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reasons = kind === "return" ? DIFFERENCE_REASONS.return : DIFFERENCE_REASONS.dispatch;
  if (!open) return <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} aria-expanded={false}>Report a difference</Button>;
  return (
    <InvForm action={answerNote} submitLabel="Send to the warehouse" pendingLabel="Sending…" className="space-y-3 rounded-md border border-border p-3" secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
      <input type="hidden" name="noteId" value={noteId} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="action" value="report_difference" />
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Which lines are different? <span className="font-normal text-muted-foreground">(tick every line that differs)</span></legend>
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {lines.map((l) => (
            <li key={l.n}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2 has-[:focus-visible]:bg-secondary/40">
                <input type="checkbox" name="line" value={l.n} className="mt-1 h-4 w-4" />
                <span className="min-w-0 break-words"><span className="font-medium">{l.n}. {lineTitle(l)}</span> <span className="text-muted-foreground">· {lineIdentity(l)} · {lineQtyText(l)}</span></span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <Field label="What is different?" htmlFor={`${uid}-r`}>
        <Select id={`${uid}-r`} name="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose what is different</option>
          {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
      </Field>
      <Field label={reason === "other" ? "Describe the difference (required)" : "Comment (optional)"} htmlFor={`${uid}-c`}>
        <Textarea id={`${uid}-c`} name="comment" maxLength={2000} rows={3} />
      </Field>
      <p className="text-xs text-muted-foreground">The warehouse reviews it. Reporting a difference does not move or hold any equipment by itself.</p>
    </InvForm>
  );
}

/** Withdraw an open report (whoever may answer for the project now). */
export function WithdrawDifference({ noteId, projectId }: { noteId: string; projectId: string }) {
  return (
    <InvForm action={answerNote} submitLabel="Withdraw the report" pendingLabel="Saving…" variant="outline" className="space-y-1">
      <input type="hidden" name="noteId" value={noteId} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="action" value="withdraw" />
    </InvForm>
  );
}

/**
 * The warehouse's answer to a reported difference. "The record stands" confirms the recorded list is right. "Corrected" means the warehouse already fixed the
 * ledger with the existing actions (record a return, record it again, mark missing or found, check a condition): name that movement's reference from History;
 * when it is a dispatch or return for the same project it becomes a NEW note that cites this one. This note and its history are never altered. A comment is required.
 */
export function ResolveDifference({ noteId, projectId, noteNo, reason, kind, lines, reportedBy, comment }: {
  noteId: string; projectId: string; noteNo: string; reason: string | null; kind: "dispatch" | "return"; lines: readonly NoteLine[]; reportedBy: string | null; comment: string | null;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<"record_stands" | "corrected" | "">("");
  if (!open) return <Button type="button" size="sm" onClick={() => setOpen(true)} aria-expanded={false}>Answer the difference<span className="sr-only"> on {noteNo}</span></Button>;
  return (
    <InvForm action={resolveDifference} submitLabel="Save the answer" pendingLabel="Saving…" className="space-y-3 rounded-md border border-border p-3" secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
      <input type="hidden" name="noteId" value={noteId} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="text-sm">
        <p><span className="font-medium">{reportedBy ?? "The Project Manager"}</span> reports: {reasonWord(kind, reason)}{comment ? `. ${comment}` : ""}</p>
        {lines.length > 0 ? (
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">{lines.map((l) => <li key={l.n}>{l.n}. {lineTitle(l)} · {lineIdentity(l)} · {lineQtyText(l)}</li>)}</ul>
        ) : null}
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">What did the warehouse find?</legend>
        <label className="flex items-start gap-2 text-sm"><input type="radio" name="resolution" value="record_stands" checked={resolution === "record_stands"} onChange={() => setResolution("record_stands")} className="mt-1 h-4 w-4" />The record stands: the recorded list is right</label>
        <label className="flex items-start gap-2 text-sm"><input type="radio" name="resolution" value="corrected" checked={resolution === "corrected"} onChange={() => setResolution("corrected")} className="mt-1 h-4 w-4" />Corrected: I already recorded the correction</label>
      </fieldset>
      {resolution === "corrected" ? (
        <Field label="Reference of the movement that corrected it" htmlFor={`${uid}-m`} hint="Copy it from History (for example ENG-M-00044). A dispatch or return for this project becomes a new note that cites this one.">
          <Input id={`${uid}-m`} name="movementCode" autoComplete="off" />
        </Field>
      ) : null}
      <Field label="What the warehouse found (required)" htmlFor={`${uid}-c`}>
        <Textarea id={`${uid}-c`} name="comment" maxLength={2000} rows={3} />
      </Field>
      <p className="text-xs text-muted-foreground">Nothing is moved, written off or deducted by this answer. Any change to stock is a separate warehouse action.</p>
    </InvForm>
  );
}
