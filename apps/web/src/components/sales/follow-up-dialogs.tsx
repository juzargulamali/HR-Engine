"use client";

import { useState } from "react";
import { isSkippedLocalTime } from "@enginious-hr/domain";
import { CheckCircle2 } from "lucide-react";
import { cancelFollowUp, completeFollowUp, createFollowUp, rescheduleFollowUp } from "@/lib/actions/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDueExact, dubaiTimeOfDay, resultingDue, whenShortcuts } from "@/lib/crm/follow-up-reschedule";
import { cn } from "@/lib/utils";
import { ActionForm, Field } from "./action-form";
import { Modal } from "./modal";
import { todayIn, todayInDubai } from "./format";
import { dueTimeLabel, zoneWords } from "@/lib/crm/time-zone";

const KINDS = [["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["proposal", "Proposal work"], ["other", "Other"]] as const;

function KindSelect({ id, defaultValue }: { id: string; defaultValue?: string }) {
  // The next step is most often the same kind of thing as the one just done (a call after a call); an unknown kind falls back to Other.
  const kind = KINDS.some(([v]) => v === defaultValue) ? defaultValue : "other";
  return (
    <Select id={id} name="nextKind" defaultValue={kind}>
      {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
}

/**
 * The date and time of a follow-up, with one-tap choices (Tomorrow, In 2 days, Next week) and, always, the exact moment that will be saved, in words,
 * before the person saves. The fields stay ordinary date and time inputs, so anything else can be typed. `children` adds more fields to the same row.
 */
export function WhenFields({ id, dateName, timeName, zone, dateLabel = "Date", initialTime = "10:00", resultLabel = "Will be due", children }: {
  id: string; dateName: string; timeName: string;
  /** The Sales time zone of the company the follow-up belongs to: the clock the date and time are typed on. It is named on the time field and in the result. */
  zone: string;
  dateLabel?: string; initialTime?: string; resultLabel?: string; children?: React.ReactNode;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState(initialTime);
  // The moment the form was opened: "tomorrow" and "already passed" are judged against it (a dialog is open for a minute, not a day).
  const [opened] = useState(() => Date.now());
  const due = resultingDue(date, time, zone);
  // A time that does not exist that day on that clock (the hour skipped when the clocks go forward): said here, before the server refuses it.
  const skipped = !due && isSkippedLocalTime(zone, date, /^\d{2}:\d{2}$/.test(time) ? time : "09:00");
  const past = !!due && new Date(due).getTime() < opened;
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Quick choices" className="flex flex-wrap gap-1.5">
        {whenShortcuts(new Date(opened), zone).map((s) => (
          <button key={s.key} type="button" aria-pressed={date === s.date} data-testid={`when-${s.key}`} onClick={() => setDate(s.date)}
            className={cn("inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", date === s.date ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
            {s.label}
          </button>
        ))}
      </div>
      <div className={cn("grid gap-3", children ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <Field label={dateLabel} htmlFor={`${id}-date`}><Input id={`${id}-date`} name={dateName} type="date" required min={todayIn(zone)} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={dueTimeLabel(zone)} htmlFor={`${id}-time`}><Input id={`${id}-time`} name={timeName} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        {children}
      </div>
      <p aria-live="polite" data-testid="when-result" className="text-sm">
        {due ? (
          <>
            <span className="text-muted-foreground">{resultLabel}</span> <span className="font-medium">{formatDueExact(due, zone)}</span> <span className="text-muted-foreground">({zoneWords(zone)})</span>
            {past ? <span className="font-medium text-[hsl(var(--os-amber))]"> · This time has already passed, so it will show as overdue.</span> : null}
          </>
        ) : skipped ? <span className="font-medium text-[hsl(var(--os-amber))]" data-testid="when-skipped">That time does not exist on that date in {zoneWords(zone).replace(/ time$/, "")}: the clocks go forward that night. Choose another time.</span>
          : <span className="text-muted-foreground">Choose a date to see the exact date and time before you save.</span>}
      </p>
    </div>
  );
}

export interface FollowUpRef {
  id: string;
  title: string;
  /** The follow-up's own type (call, email…): the next action in the Complete dialog starts on the same type. */
  kind?: string;
  /** When it is due now: Reschedule keeps this time of day and says what it is moving from. */
  dueAt?: string;
  /** The Sales time zone of the follow-up's company: the clock its dates and times are typed and shown on. */
  timeZone: string;
  /** Null for a follow-up on an account with no inquiry: there is no stage to protect, so no hold option and completing it never forces a next step. */
  opportunityId: string | null;
  /** True when this is the only open follow-up on an active opportunity: completing it then needs a next step or a hold. */
  isOnlyOpen: boolean;
}

/**
 * Completing a follow-up: say what happened (required). If it was the opportunity's last open follow-up, choose what happens
 * next — a new follow-up or putting it on hold with a reason and review date — so no active opportunity is ever left without a
 * next action. The database enforces the same rule. Completing a follow-up never marks anything Won and never implies that the
 * client replied: a reply is recorded separately as an update.
 */
function CompleteBody({ followUp, onClose }: { followUp: FollowUpRef; onClose: () => void }) {
  const [next, setNext] = useState<"follow_up" | "hold" | "none">(followUp.isOnlyOpen ? "follow_up" : "none");
  return (
    <ActionForm action={completeFollowUp} submitLabel="Complete" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
      <input type="hidden" name="followUpId" value={followUp.id} />
      <input type="hidden" name="opportunityId" value={followUp.opportunityId ?? ""} />
      <Field label="What happened?" htmlFor={`outcome-${followUp.id}`}>
        <Textarea id={`outcome-${followUp.id}`} name="outcome" required rows={3} placeholder="e.g. Called Hana; she will confirm dates on Thursday." />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{followUp.isOnlyOpen ? "What happens next? (required, this was the last follow-up)" : "What happens next?"}</legend>
        {!followUp.isOnlyOpen ? (
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="next" value="none" checked={next === "none"} onChange={() => setNext("none")} /> Nothing more now (another follow-up is already planned)</label>
        ) : null}
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="next" value="follow_up" checked={next === "follow_up"} onChange={() => setNext("follow_up")} /> Add the next follow-up</label>
        {followUp.opportunityId ? <label className="flex items-center gap-2 text-sm"><input type="radio" name="next" value="hold" checked={next === "hold"} onChange={() => setNext("hold")} /> Put the opportunity on hold</label> : null}
      </fieldset>
      {next === "follow_up" ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <Field label="Next action" htmlFor={`nt-${followUp.id}`}><Input id={`nt-${followUp.id}`} name="nextTitle" required placeholder="e.g. Send revised proposal" /></Field>
          <WhenFields id={`nd-${followUp.id}`} dateName="nextDate" timeName="nextTime" zone={followUp.timeZone}>
            <Field label="Type" htmlFor={`nk-${followUp.id}`}><KindSelect id={`nk-${followUp.id}`} defaultValue={followUp.kind} /></Field>
          </WhenFields>
        </div>
      ) : null}
      {next === "hold" ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <Field label="Reason" htmlFor={`hr-${followUp.id}`}><Input id={`hr-${followUp.id}`} name="holdReason" required placeholder="e.g. Client postponed the event" /></Field>
          <Field label="Review date" htmlFor={`hd-${followUp.id}`} hint="You will be reminded to review it on this date."><Input id={`hd-${followUp.id}`} name="holdReview" type="date" required min={todayInDubai()} /></Field>
        </div>
      ) : null}
    </ActionForm>
  );
}

/** Controlled dialog (opened from a button or a menu). */
export function CompleteFollowUpDialog({ open, onClose, followUp }: { open: boolean; onClose: () => void; followUp: FollowUpRef }) {
  return (
    <Modal open={open} onClose={onClose} title="Complete follow-up" description={followUp.title}>
      <CompleteBody followUp={followUp} onClose={onClose} />
    </Modal>
  );
}

export function CompleteFollowUpButton({ followUp, size = "sm", label = "Complete" }: { followUp: FollowUpRef; size?: "sm" | "default"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size={size} variant="outline" aria-label={`${label}: ${followUp.title}`} onClick={() => setOpen(true)}>
        <CheckCircle2 className="h-4 w-4" aria-hidden /> {label}
      </Button>
      <CompleteFollowUpDialog open={open} onClose={() => setOpen(false)} followUp={followUp} />
    </>
  );
}

type FollowUpBasics = Pick<FollowUpRef, "id" | "title" | "opportunityId" | "dueAt" | "timeZone">;

export function RescheduleFollowUpDialog({ open, onClose, followUp }: { open: boolean; onClose: () => void; followUp: FollowUpBasics }) {
  return (
    <Modal open={open} onClose={onClose} title="Reschedule follow-up" description={followUp.title}>
      <ActionForm action={rescheduleFollowUp} submitLabel="Reschedule" onDone={onClose}>
        <input type="hidden" name="followUpId" value={followUp.id} />
        <input type="hidden" name="opportunityId" value={followUp.opportunityId ?? ""} />
        {followUp.dueAt ? <p className="text-sm text-muted-foreground">Due now: <span className="font-medium text-foreground">{formatDueExact(followUp.dueAt, followUp.timeZone)}</span> ({zoneWords(followUp.timeZone)})</p> : null}
        <WhenFields id={`rd-${followUp.id}`} dateName="date" timeName="time" zone={followUp.timeZone} dateLabel="New date" initialTime={dubaiTimeOfDay(followUp.dueAt, "10:00", followUp.timeZone)} resultLabel="New due date" />
      </ActionForm>
    </Modal>
  );
}

export function RescheduleFollowUpButton({ followUp }: { followUp: FollowUpBasics }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>Reschedule</Button>
      <RescheduleFollowUpDialog open={open} onClose={() => setOpen(false)} followUp={followUp} />
    </>
  );
}

export function CancelFollowUpDialog({ open, onClose, followUp }: { open: boolean; onClose: () => void; followUp: FollowUpBasics }) {
  return (
    <Modal open={open} onClose={onClose} title="Cancel follow-up" description={followUp.title} help="The only next action of an active opportunity cannot be cancelled. Complete it with a new next action instead.">
      <ActionForm action={cancelFollowUp} submitLabel="Cancel follow-up" variant="destructive" onDone={onClose}>
        <input type="hidden" name="followUpId" value={followUp.id} />
        <input type="hidden" name="opportunityId" value={followUp.opportunityId ?? ""} />
        <Field label="Why is it no longer needed?" htmlFor={`cr-${followUp.id}`}><Input id={`cr-${followUp.id}`} name="reason" required /></Field>
      </ActionForm>
    </Modal>
  );
}

export function CancelFollowUpButton({ followUp }: { followUp: FollowUpBasics }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>Cancel</Button>
      <CancelFollowUpDialog open={open} onClose={() => setOpen(false)} followUp={followUp} />
    </>
  );
}

export function NewFollowUpButton({ opportunityId, people, canAssign, currentUserId, timeZone, label = "Add follow-up" }: { opportunityId: string; people: { id: string; name: string }[]; canAssign: boolean; currentUserId: string; /** The Sales time zone of the enquiry's company. */ timeZone: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add follow-up">
        <ActionForm action={createFollowUp} submitLabel="Add follow-up" onDone={() => setOpen(false)}>
          <input type="hidden" name="id" value={opportunityId} />
          <Field label="What needs to happen?" htmlFor={`fu-title-${opportunityId}`}><Input id={`fu-title-${opportunityId}`} name="title" required /></Field>
          <WhenFields id={`fu-when-${opportunityId}`} dateName="date" timeName="time" zone={timeZone}>
            <Field label="Type" htmlFor={`fu-kind-${opportunityId}`}>
              <Select id={`fu-kind-${opportunityId}`} name="kind" defaultValue="other">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            </Field>
          </WhenFields>
          {canAssign ? (
            <Field label="Assigned to" htmlFor={`fu-who-${opportunityId}`}>
              <Select id={`fu-who-${opportunityId}`} name="assignedTo" defaultValue={currentUserId}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            </Field>
          ) : null}
        </ActionForm>
      </Modal>
    </>
  );
}
