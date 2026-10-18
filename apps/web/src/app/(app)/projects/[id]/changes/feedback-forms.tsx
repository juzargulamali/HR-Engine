"use client";

import { useState } from "react";
import { recordFeedback, updateFeedback } from "@/lib/actions/projectsClose";
import { decideScopeChange, proposeScopeChange, setScopeChangeCommercial, withdrawScopeChange } from "@/lib/actions/projectsClose";
import { Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DialogForm } from "./dialog-form";

export interface Option { id: string; label: string }
type Person = { id: string; name: string };

export function RecordFeedbackForm({ projectId, today, milestones, deliverables, tasks, people }: { projectId: string; today: string; milestones: Option[]; deliverables: Option[]; tasks: Option[]; people: Person[] }) {
  const [type, setType] = useState("project");
  const options = type === "milestone" ? milestones : type === "deliverable" ? deliverables : type === "task" ? tasks : [];
  return (
    <DialogForm triggerLabel="Record feedback" triggerVariant="default" title="Record client feedback" description="Write down what the client said, who said it and what it relates to. Recording it changes nothing else." action={recordFeedback} submitLabel="Save feedback" resetOnSuccess>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who gave it, and how" htmlFor="fb-source"><Input id="fb-source" name="source" required placeholder="e.g. Client PM, call on 12 Mar" /></Field>
        <Field label="Received on" htmlFor="fb-date"><Input id="fb-date" name="receivedOn" type="date" required defaultValue={today} /></Field>
      </div>
      <Field label="What was asked" htmlFor="fb-text"><Textarea id="fb-text" name="requestText" rows={3} required maxLength={4000} /></Field>
      <Field label="Kind" htmlFor="fb-kind" hint="A correction fixes something against what was agreed. A proposed change asks for something new and needs a scope decision.">
        <Select id="fb-kind" name="kind" required defaultValue="">
          <option value="" disabled>Choose…</option>
          <option value="in_scope_correction">Correction to what was agreed</option>
          <option value="proposed_change">Proposed change to the scope</option>
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Relates to" htmlFor="fb-type">
          <Select id="fb-type" name="targetType" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="project">The project as a whole</option>
            <option value="milestone">A milestone</option>
            <option value="deliverable">A deliverable</option>
            <option value="task">A task</option>
          </Select>
        </Field>
        {type !== "project" ? (
          <Field label="Which one" htmlFor="fb-target">
            <Select id="fb-target" name="targetId" required defaultValue="">
              <option value="" disabled>{options.length === 0 ? "None exist yet" : "Choose…"}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </Field>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Responsible (optional)" htmlFor="fb-resp">
          <Select id="fb-resp" name="responsibleUserId" defaultValue=""><option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </Field>
        <Field label="Deadline (optional)" htmlFor="fb-due"><Input id="fb-due" name="dueDate" type="date" /></Field>
      </div>
    </DialogForm>
  );
}

export function UpdateFeedbackForm({ projectId, feedbackId, version, status, resolution, evidenceNote, responsibleUserId, dueDate, canReassign, people }: {
  projectId: string; feedbackId: string; version: number; status: string; resolution: string | null; evidenceNote: string | null; responsibleUserId: string | null; dueDate: string | null; canReassign: boolean; people: Person[];
}) {
  const [s, setS] = useState(status);
  const needsResolution = s === "resolved" || s === "declined" || s === "deferred";
  return (
    <DialogForm triggerLabel="Update" title="Update this feedback" action={updateFeedback} submitLabel="Save">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="feedbackId" value={feedbackId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <Field label="Status" htmlFor={`fbs-${feedbackId}`}>
        <Select id={`fbs-${feedbackId}`} name="status" value={s} onChange={(e) => setS(e.target.value)}>
          <option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="declined">Declined</option><option value="deferred">Deferred</option>
        </Select>
      </Field>
      <Field label={needsResolution ? "How it was resolved, declined or deferred (required)" : "Resolution (when there is one)"} htmlFor={`fbr-${feedbackId}`}>
        <Textarea id={`fbr-${feedbackId}`} name="resolution" rows={3} required={needsResolution} defaultValue={resolution ?? ""} />
      </Field>
      <Field label="Evidence (where it is recorded)" htmlFor={`fbe-${feedbackId}`} hint="For example the e-mail date and subject, or the name of a file in Documents. Nothing here is checked or sent.">
        <Input id={`fbe-${feedbackId}`} name="evidenceNote" defaultValue={evidenceNote ?? ""} />
      </Field>
      {canReassign ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Responsible" htmlFor={`fbp-${feedbackId}`}>
            <Select id={`fbp-${feedbackId}`} name="responsibleUserId" defaultValue={responsibleUserId ?? ""}><option value="">Nobody</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          </Field>
          <Field label="Deadline" htmlFor={`fbd-${feedbackId}`}><Input id={`fbd-${feedbackId}`} name="dueDate" type="date" defaultValue={dueDate ?? ""} /></Field>
        </div>
      ) : null}
    </DialogForm>
  );
}

export function ProposeScopeChangeForm({ projectId, currentScope, feedback }: { projectId: string; currentScope: string | null; feedback: Option[] }) {
  return (
    <DialogForm triggerLabel="Propose a scope change" triggerVariant="default" title="Propose a scope change" description="The agreed scope is never edited. This records a proposal; only someone with scope approval can accept it." action={proposeScopeChange} submitLabel="Record proposal" resetOnSuccess>
      <input type="hidden" name="projectId" value={projectId} />
      <Field label="Title" htmlFor="sc-title"><Input id="sc-title" name="title" required maxLength={200} placeholder="e.g. Add a second projector" /></Field>
      <Field label="Proposed scope (the whole scope as it would read)" htmlFor="sc-scope"><Textarea id="sc-scope" name="proposedScope" rows={6} required defaultValue={currentScope ?? ""} /></Field>
      <Field label="Effect on dates (in words)" htmlFor="sc-dates" hint="For example “two extra days of installation”. No date moves when a change is approved: you decide that on the plan."><Textarea id="sc-dates" name="effectOnDates" rows={2} /></Field>
      {feedback.length > 0 ? (
        <Field label="Arose from this feedback (optional)" htmlFor="sc-fb"><Select id="sc-fb" name="feedbackId" defaultValue=""><option value="">None</option>{feedback.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
      ) : null}
      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Effect on cost (optional, restricted)</legend>
        <p className="text-sm text-muted-foreground">Stored in a restricted place. Project Managers and members cannot read it back; only people with commercial access can. Leave it empty if you do not know it.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Currency" htmlFor="sc-cur"><Input id="sc-cur" name="currency" maxLength={3} placeholder="AED" /></Field>
          <Field label="Amount" htmlFor="sc-amt"><Input id="sc-amt" name="amount" type="number" min="0" step="0.01" inputMode="decimal" /></Field>
        </div>
        <Field label="Note" htmlFor="sc-cost"><Textarea id="sc-cost" name="costNote" rows={2} /></Field>
      </fieldset>
    </DialogForm>
  );
}

export function DecideScopeChangeForm({ projectId, scopeChangeId }: { projectId: string; scopeChangeId: string }) {
  return (
    <DialogForm triggerLabel="Decide" triggerVariant="default" title="Decide this scope change" description="Approving replaces the current scope with the proposed one. The original agreed scope and this decision stay on record. No date or price moves." action={decideScopeChange} submitLabel="Record decision">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="scopeChangeId" value={scopeChangeId} />
      <Field label="Decision" htmlFor={`dc-${scopeChangeId}`}>
        <Select id={`dc-${scopeChangeId}`} name="decision" required defaultValue=""><option value="" disabled>Choose…</option><option value="approve">Approve</option><option value="reject">Reject</option></Select>
      </Field>
      <Field label="Reason (required)" htmlFor={`dn-${scopeChangeId}`}><Textarea id={`dn-${scopeChangeId}`} name="note" rows={3} required /></Field>
    </DialogForm>
  );
}

export function WithdrawScopeChangeForm({ projectId, scopeChangeId }: { projectId: string; scopeChangeId: string }) {
  return (
    <DialogForm triggerLabel="Withdraw" title="Withdraw this proposal?" description="It stays in the list as withdrawn. Nothing about the scope changes." action={withdrawScopeChange} submitLabel="Withdraw proposal" submitVariant="destructive">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="scopeChangeId" value={scopeChangeId} />
    </DialogForm>
  );
}

export function CommercialForm({ projectId, scopeChangeId, currency, amount, note }: { projectId: string; scopeChangeId: string; currency: string | null; amount: number | null; note: string | null }) {
  return (
    <DialogForm triggerLabel="Edit cost effect" title="Cost effect (restricted)" description="Visible only to people with commercial access." action={setScopeChangeCommercial} submitLabel="Save">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="scopeChangeId" value={scopeChangeId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Currency" htmlFor={`cc-${scopeChangeId}`}><Input id={`cc-${scopeChangeId}`} name="currency" maxLength={3} defaultValue={currency ?? ""} /></Field>
        <Field label="Amount" htmlFor={`ca-${scopeChangeId}`}><Input id={`ca-${scopeChangeId}`} name="amount" type="number" min="0" step="0.01" defaultValue={amount ?? ""} /></Field>
      </div>
      <Field label="Note" htmlFor={`cn-${scopeChangeId}`}><Textarea id={`cn-${scopeChangeId}`} name="note" rows={2} defaultValue={note ?? ""} /></Field>
    </DialogForm>
  );
}
