"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HOLD_REASONS, NOW, TZ_LABEL, fmtDue, type Activity, type FollowUp, type Opportunity } from "../_lib/data";
import { PLink } from "./context";
import { Field, Sheet } from "./ui";

export const KINDS: { value: FollowUp["kind"]; label: string }[] = [
  { value: "call", label: "Call" }, { value: "email", label: "Email" }, { value: "meeting", label: "Meeting" }, { value: "proposal", label: "Proposal work" }, { value: "other", label: "Other" },
];
const toDueAt = (date: string, time: string) => `${date}T${time}`;

/** Log an activity: what happened, and whether it was an internal note or something the client said. */
export function LogActivityDialog({ opp, open, onClose, onSave }: { opp: Opportunity; open: boolean; onClose: () => void; onSave: (a: { type: Activity["type"]; internal: boolean; text: string }) => void }) {
  const [kind, setKind] = useState<"internal" | "client">("internal");
  const [type, setType] = useState<Activity["type"]>("note");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title={`Log activity: ${opp.ref}`}>
      <form noValidate className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) { setErr("Write what happened."); return; }
        onSave({ type: kind === "client" ? "client_response" : type, internal: kind === "internal", text: text.trim() });
        setText(""); setErr(null); onClose();
      }}>
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 text-sm font-medium">What is this?</legend>
          <label className="flex items-start gap-2"><input type="radio" name="la-kind" className="mt-1" checked={kind === "internal"} onChange={() => setKind("internal")} /><span>Internal note or activity<span className="block text-xs text-muted-foreground">Only the team sees it.</span></span></label>
          <label className="flex items-start gap-2"><input type="radio" name="la-kind" className="mt-1" checked={kind === "client"} onChange={() => setKind("client")} /><span>Client response<span className="block text-xs text-muted-foreground">Something the client said or sent.</span></span></label>
        </fieldset>
        {kind === "internal" ? <Field label="Type" htmlFor="la-type"><Select id="la-type" value={type} onChange={(e) => setType(e.target.value as Activity["type"])}><option value="note">Note</option><option value="call">Call</option><option value="email">Email sent</option><option value="meeting">Meeting</option></Select></Field> : null}
        <Field label={kind === "client" ? "What the client said" : "What happened"} htmlFor="la-text" required error={err}><Textarea id="la-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <p className="text-xs text-muted-foreground">Logging an activity sends nothing to anyone.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm">Save activity</Button></div>
      </form>
    </Sheet>
  );
}

function DateTimeFields({ prefix, date, time, setDate, setTime, error }: { prefix: string; date: string; time: string; setDate: (v: string) => void; setTime: (v: string) => void; error?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Date" htmlFor={`${prefix}-date`} required error={error}><Input id={`${prefix}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={`Time (${TZ_LABEL})`} htmlFor={`${prefix}-time`} required><Input id={`${prefix}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
    </div>
  );
}

/** Schedule the next action. Every actionable open opportunity needs one. */
export function ScheduleNextDialog({ opp, open, onClose, onSave, title = "Schedule next action" }: { opp: Opportunity; open: boolean; onClose: () => void; onSave: (f: { title: string; kind: FollowUp["kind"]; dueAt: string }) => void; title?: string }) {
  const [what, setWhat] = useState("");
  const [kind, setKind] = useState<FollowUp["kind"]>("call");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [err, setErr] = useState<Record<string, string>>({});
  return (
    <Sheet open={open} onClose={onClose} title={`${title}: ${opp.ref}`}>
      <form noValidate className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        const x: Record<string, string> = {};
        if (!what.trim()) x.what = "Say what needs to happen.";
        if (!date) x.date = "Choose a date.";
        else if (toDueAt(date, time) <= NOW) x.date = "Choose a time after the sample time shown at the top.";
        setErr(x);
        if (Object.keys(x).length) return;
        onSave({ title: what.trim(), kind, dueAt: toDueAt(date, time) });
        setWhat(""); setDate(""); onClose();
      }}>
        <Field label="What needs to happen" htmlFor="sn-what" required error={err.what}><Input id="sn-what" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="For example: Call to confirm dates" /></Field>
        <Field label="Type" htmlFor="sn-kind"><Select id="sn-kind" value={kind} onChange={(e) => setKind(e.target.value as FollowUp["kind"])}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select></Field>
        <DateTimeFields prefix="sn" date={date} time={time} setDate={setDate} setTime={setTime} error={err.date} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm">Schedule</Button></div>
      </form>
    </Sheet>
  );
}

export type CompleteResult = {
  outcome: string; reply: "yes" | "no" | "na"; notes: string;
  next: { kind: "schedule"; title: string; actionKind: FollowUp["kind"]; dueAt: string } | { kind: "hold"; reason: string; review: string };
};
const OUTCOMES = ["Spoke to the client", "Left a message", "Email sent", "No answer", "Meeting held", "Proposal or quote sent", "Other"];

/**
 * Complete a follow-up: record what happened, then say what happens next.
 * Completing does not move the stage, does not mean the client replied and never means Won.
 */
export function CompleteFollowUpDialog({ opp, followUp, open, onClose, onDone }: { opp: Opportunity; followUp: FollowUp; open: boolean; onClose: () => void; onDone: (r: CompleteResult) => void }) {
  const [outcome, setOutcome] = useState("");
  const [reply, setReply] = useState<"yes" | "no" | "na">("na");
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState<"schedule" | "hold">("schedule");
  const [what, setWhat] = useState("");
  const [actionKind, setActionKind] = useState<FollowUp["kind"]>("call");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [reason, setReason] = useState<string>(HOLD_REASONS[0]);
  const [holdNote, setHoldNote] = useState("");
  const [review, setReview] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});

  return (
    <Sheet open={open} onClose={onClose} title="Complete follow-up">
      <form noValidate className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        const x: Record<string, string> = {};
        if (!outcome) x.outcome = "Choose what happened.";
        if (reply === "yes" && !notes.trim()) x.notes = "Write what the client said.";
        if (next === "schedule") {
          if (!what.trim()) x.what = "Every open opportunity needs a next action.";
          if (!date) x.date = "Choose a date.";
          else if (toDueAt(date, time) <= NOW) x.date = "Choose a time after the sample time shown at the top.";
        } else {
          if (reason.startsWith("Other") && !holdNote.trim()) x.holdNote = "Add a short note explaining why.";
          if (!review) x.review = "Choose a review date.";
          else if (review <= NOW.slice(0, 10)) x.review = "The review date must be after today.";
        }
        setErr(x);
        if (Object.keys(x).length) return;
        onDone({
          outcome, reply, notes: notes.trim(),
          next: next === "schedule" ? { kind: "schedule", title: what.trim(), actionKind, dueAt: toDueAt(date, time) } : { kind: "hold", reason: reason.startsWith("Other") ? `Other: ${holdNote.trim()}` : reason, review },
        });
        onClose();
      }}>
        <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"><p className="font-medium">{followUp.title}</p><p className="text-xs text-muted-foreground">{opp.ref} · {fmtDue(followUp.dueAt)}</p></div>
        <Field label="What happened" htmlFor="cf-outcome" required error={err.outcome}>
          <Select id="cf-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">Choose…</option>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</Select>
        </Field>
        <fieldset className="space-y-1.5 text-sm">
          <legend className="mb-1 text-sm font-medium">Did the client reply?</legend>
          {[{ v: "yes", l: "Yes, record their reply as a client response" }, { v: "no", l: "No reply yet" }, { v: "na", l: "Not applicable" }].map((o) => (
            <label key={o.v} className="flex items-center gap-2"><input type="radio" name="cf-reply" checked={reply === o.v} onChange={() => setReply(o.v as "yes" | "no" | "na")} />{o.l}</label>
          ))}
        </fieldset>
        <Field label={reply === "yes" ? "What the client said" : "Notes"} htmlFor="cf-notes" required={reply === "yes"} error={err.notes}><Textarea id="cf-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

        <fieldset className="space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">What happens next?</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="cf-next" checked={next === "schedule"} onChange={() => setNext("schedule")} />Schedule the next action</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="cf-next" checked={next === "hold"} onChange={() => setNext("hold")} />Put on hold</label>
          {next === "schedule" ? (
            <div className="space-y-3 pt-1">
              <Field label="Next action" htmlFor="cf-what" required error={err.what}><Input id="cf-what" value={what} onChange={(e) => setWhat(e.target.value)} /></Field>
              <Field label="Type" htmlFor="cf-akind"><Select id="cf-akind" value={actionKind} onChange={(e) => setActionKind(e.target.value as FollowUp["kind"])}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select></Field>
              <DateTimeFields prefix="cf" date={date} time={time} setDate={setDate} setTime={setTime} error={err.date} />
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              <Field label="Reason" htmlFor="cf-reason" required><Select id="cf-reason" value={reason} onChange={(e) => setReason(e.target.value)}>{HOLD_REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
              {reason.startsWith("Other") ? <Field label="Note" htmlFor="cf-hnote" required error={err.holdNote}><Textarea id="cf-hnote" rows={2} value={holdNote} onChange={(e) => setHoldNote(e.target.value)} /></Field> : null}
              <Field label="Review date" htmlFor="cf-review" required error={err.review}><Input id="cf-review" type="date" value={review} onChange={(e) => setReview(e.target.value)} /></Field>
            </div>
          )}
        </fieldset>
        <p className="text-xs text-muted-foreground">Completing a follow-up does not change the stage and does not mean the deal is won. To close it, use <PLink href={`/os-preview/sales/opportunities/${opp.ref}/close`} className="font-medium text-[hsl(var(--os-link))] underline underline-offset-2">Mark Won or Lost</PLink>.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm">Complete follow-up</Button></div>
      </form>
    </Sheet>
  );
}
