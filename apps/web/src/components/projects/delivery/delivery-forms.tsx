"use client";

import { useState } from "react";
import {
  decidePlanChange, decidePlanCorrection, delegatePlanSection, raisePlanCorrection, releaseDeliveryPlan, removeDeliverable, removePlanLine, saveDeliverable, savePlanLine,
} from "@/lib/actions/projectsDeliveryPlan";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DP_SECTION_LABELS, type DpSection } from "@/lib/projects/delivery-plan/model";

/**
 * The Delivery Plan's forms. Each one posts to a server action that calls the database function; the function decides who may do it. A form for something already
 * released says, before saving, that the change becomes a proposal for the Project Manager. Nothing here creates a task or an equipment line: only Release does.
 */
export interface Option { id: string; name: string }
type Done = { error: string | null; notice?: string | null };

/** A dialog whose form may answer with a notice (a proposal was sent, or the row already existed): the notice stays on screen until the person closes it. */
function FormDialog({ label, title, description, variant = "outline", size = "sm", children, testId }: {
  label: string; title: string; description?: string; variant?: "default" | "outline" | "secondary" | "ghost" | "destructive"; size?: "default" | "sm"; testId?: string;
  children: (done: (s: Done) => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => { setOpen(false); setNotice(null); };
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} data-testid={testId}>{label}</Button>
      <Modal open={open} onClose={close} title={title} description={description}>
        {notice ? (
          <div className="space-y-3">
            <Alert role="status">{notice}</Alert>
            <Button type="button" onClick={close}>Close</Button>
          </div>
        ) : children((s) => { if (s.notice) setNotice(s.notice); else close(); })}
      </Modal>
    </>
  );
}

const RELEASED_NOTE = "This is already released. Your change is sent to the Project Manager as a proposal; nothing changes until it is approved.";

export interface DeliverableValues { id: string; version: number; zone: string; title: string; specs: string | null; owner_id: string | null; needed_by: string | null; image_file_id: string | null; released: boolean }

export function DeliverableDialog({ projectId, item, members, images }: { projectId: string; item?: DeliverableValues; members: Option[]; images: Option[] }) {
  return (
    <FormDialog label={item ? "Edit" : "Add deliverable"} variant={item ? "outline" : "default"} title={item ? "Edit deliverable" : "Add deliverable"} testId={item ? undefined : "dp-add-deliverable"}
      description="One row is one deliverable in a zone, for example Entrance: Interactive LED welcome wall. Add only the breakdown it needs afterwards.">
      {(done) => (
        <ActionForm action={saveDeliverable} submitLabel={item ? (item.released ? "Propose change" : "Save deliverable") : "Add deliverable"} onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} />
          {item ? <><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="expectedVersion" value={item.version} /></> : null}
          {item?.released ? <Alert role="status">{RELEASED_NOTE}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Zone" htmlFor="dp-zone" hint="Where it is: Entrance, Lounge, Stage."><Input id="dp-zone" name="zone" maxLength={120} defaultValue={item?.zone ?? ""} /></Field>
            <Field label="Deliverable" htmlFor="dp-title"><Input id="dp-title" name="title" required maxLength={200} defaultValue={item?.title ?? ""} /></Field>
          </div>
          <Field label="Specifications (optional)" htmlFor="dp-specs"><Textarea id="dp-specs" name="specs" rows={3} maxLength={4000} defaultValue={item?.specs ?? ""} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Accountable owner" htmlFor="dp-owner" hint="One person. Work lines with nobody named go to this person at release.">
              <Select id="dp-owner" name="ownerId" defaultValue={item?.owner_id ?? ""}>
                <option value="">Not chosen yet</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
            <Field label="Needed by" htmlFor="dp-needed"><Input id="dp-needed" name="neededBy" type="date" defaultValue={item?.needed_by ?? ""} /></Field>
          </div>
          <Field label="Reference image (optional)" htmlFor="dp-image" hint="An image already added to Files & client plan. Nothing is fetched from the internet.">
            <Select id="dp-image" name="imageFileId" defaultValue={item?.image_file_id ?? ""}>
              <option value="">None</option>
              {images.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          {item?.released ? <Field label="Why is it changing?" htmlFor="dp-reason"><Input id="dp-reason" name="reason" maxLength={300} /></Field> : null}
        </ActionForm>
      )}
    </FormDialog>
  );
}

export interface LineValues { id: string; version: number; section: DpSection; description: string; qty: number | null; inv_item_id: string | null; assignee_id: string | null; needed_by: string | null; notes: string | null; released: boolean; booked: boolean }

export function LineDialog({ projectId, itemId, line, sections, members, stock, stockFailed }: {
  projectId: string; itemId: string; line?: LineValues; sections: DpSection[]; members: Option[]; stock: Option[]; stockFailed: boolean;
}) {
  const [section, setSection] = useState<DpSection>(line?.section ?? sections[0] ?? "hardware");
  const hardware = section === "hardware";
  return (
    <FormDialog label={line ? "Edit" : "Add line"} title={line ? "Edit line" : "Add breakdown line"}
      description="A work line becomes one task at release; a hardware line becomes one line on the draft equipment request. Neither exists until the Project Manager releases it.">
      {(done) => (
        <ActionForm action={savePlanLine} submitLabel={line ? (line.released ? "Propose change" : "Save line") : "Add line"} onDone={(s) => done(s as Done)} disabled={!!line?.booked}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="itemId" value={itemId} />
          {line ? <><input type="hidden" name="lineId" value={line.id} /><input type="hidden" name="expectedVersion" value={line.version} /></> : null}
          {line?.booked ? <Alert variant="warning" role="status">This equipment is already with the warehouse. Change it on the Equipment tab; the plan cannot change a booking. Notes can still be edited there too.</Alert>
            : line?.released ? <Alert role="status">{RELEASED_NOTE}</Alert> : null}
          {line ? <p className="text-sm text-muted-foreground">Section: <span className="font-medium text-foreground">{DP_SECTION_LABELS[line.section]}</span></p> : (
            <Field label="Section" htmlFor="dl-section">
              <Select id="dl-section" name="section" value={section} onChange={(e) => setSection(e.target.value as DpSection)} required>
                {sections.map((s) => <option key={s} value={s}>{DP_SECTION_LABELS[s]}</option>)}
              </Select>
            </Field>
          )}
          <Field label="What is needed" htmlFor="dl-desc"><Input id="dl-desc" name="description" required maxLength={300} defaultValue={line?.description ?? ""} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quantity (optional)" htmlFor="dl-qty"><Input id="dl-qty" name="qty" type="number" min="0.001" step="any" defaultValue={line?.qty ?? ""} /></Field>
            <Field label="Needed by (optional)" htmlFor="dl-needed" hint="Empty = the deliverable's date."><Input id="dl-needed" name="neededBy" type="date" defaultValue={line?.needed_by ?? ""} /></Field>
          </div>
          {hardware ? (
            <Field label="Stock item" htmlFor="dl-stock" hint={stockFailed ? "Could not load the stock list. The line can be saved without one and chosen later; it cannot be released until then." : "Needed before release. Leave empty if it is not chosen yet."}>
              <Select id="dl-stock" name="invItemId" defaultValue={line?.inv_item_id ?? ""}>
                <option value="">Not chosen yet</option>
                {stock.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="Assigned to" htmlFor="dl-assignee" hint="Gets the task at release. Empty = the deliverable's accountable owner.">
              <Select id="dl-assignee" name="assigneeId" defaultValue={line?.assignee_id ?? ""}>
                <option value="">The accountable owner</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Notes (optional)" htmlFor="dl-notes"><Textarea id="dl-notes" name="notes" rows={2} maxLength={2000} defaultValue={line?.notes ?? ""} /></Field>
          {line?.released && !line.booked ? <Field label="Why is it changing?" htmlFor="dl-reason"><Input id="dl-reason" name="reason" maxLength={300} /></Field> : null}
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function RemoveDialog({ projectId, kind, id, name }: { projectId: string; kind: "deliverable" | "line"; id: string; name: string }) {
  return (
    <FormDialog label="Remove" variant="ghost" title={kind === "deliverable" ? "Remove deliverable" : "Remove line"} description={`“${name}” has not been released, so nothing else refers to it. It is taken out of the plan.`}>
      {(done) => (
        <ActionForm action={kind === "deliverable" ? removeDeliverable : removePlanLine} submitLabel="Remove" variant="destructive" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name={kind === "deliverable" ? "itemId" : "lineId"} value={id} />
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** Release, with what it will create said first. The equipment request stays a draft; submitting it is the existing action on the Equipment tab. */
export function ReleaseDialog({ projectId, itemId, label, preview }: { projectId: string; itemId?: string; label: string; preview: { tasks: number; equipment: number; waiting: { key: string; reason: string }[] } }) {
  const nothing = preview.tasks + preview.equipment === 0;
  return (
    <FormDialog label={label} variant={itemId ? "outline" : "default"} title={itemId ? "Release this deliverable" : "Release the plan"} testId={itemId ? undefined : "dp-release"}
      description="Release gives the work to the teams. It can be repeated safely: a line that was already released is never created twice.">
      {(done) => (
        <ActionForm action={releaseDeliveryPlan} submitLabel={nothing ? "Nothing to release" : "Release"} pendingLabel="Releasing…" onDone={(s) => done(s as Done)} disabled={nothing}>
          <input type="hidden" name="projectId" value={projectId} />
          {itemId ? <input type="hidden" name="itemId" value={itemId} /> : null}
          <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="dp-release-preview">
            <li>{preview.tasks} task{preview.tasks === 1 ? "" : "s"} will be created and assigned.</li>
            <li>{preview.equipment} hardware line{preview.equipment === 1 ? "" : "s"} will be added to the project&apos;s <strong>draft</strong> equipment request. It is not sent to the warehouse: you review and submit it on the Equipment tab.</li>
            {preview.waiting.length > 0 ? <li>{preview.waiting.length} line{preview.waiting.length === 1 ? "" : "s"} will wait: {preview.waiting.map((w) => `${w.key} (${w.reason})`).join("; ")}.</li> : null}
          </ul>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function DelegateForm({ projectId, section, current, members }: { projectId: string; section: DpSection; current: string | null; members: Option[] }) {
  return (
    <ActionForm action={delegatePlanSection} submitLabel="Save" variant="outline" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="section" value={section} />
      <div className="min-w-[12rem] flex-1">
        <label htmlFor={`dg-${section}`} className="mb-1 block text-[13px] font-medium text-muted-foreground">{DP_SECTION_LABELS[section]}</label>
        <Select id={`dg-${section}`} name="userId" defaultValue={current ?? ""}>
          <option value="">Project Manager only</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </div>
    </ActionForm>
  );
}

/** Raise a correction from a deliverable, a line, a task or the agreed scope. Any member of the project can; it goes to the relevant lead and the Project Manager is told. */
export function CorrectionDialog({ projectId, targetType, targetId, about, label = "Raise a correction", variant = "ghost" }: {
  projectId: string; targetType: "deliverable" | "line" | "task" | "scope"; targetId?: string; about: string; label?: string; variant?: "ghost" | "outline";
}) {
  return (
    <FormDialog label={label} variant={variant} title="Raise a correction" description={`About: ${about}. It is sent to the relevant lead and the Project Manager is told. It changes nothing by itself; you will see the decision on the Delivery plan.`}>
      {(done) => (
        <ActionForm action={raisePlanCorrection} submitLabel="Send correction" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="targetType" value={targetType} />
          {targetId ? <input type="hidden" name="targetId" value={targetId} /> : null}
          <Field label="What needs correcting?" htmlFor={`cor-${targetId ?? "scope"}`}><Textarea id={`cor-${targetId ?? "scope"}`} name="body" rows={4} required maxLength={2000} /></Field>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function DecideCorrection({ projectId, correctionId }: { projectId: string; correctionId: string }) {
  const [decision, setDecision] = useState<"accepted" | "declined">("accepted");
  return (
    <ActionForm action={decidePlanCorrection} submitLabel={decision === "accepted" ? "Accept correction" : "Decline correction"} variant={decision === "accepted" ? "default" : "outline"}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="correctionId" value={correctionId} />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Decision" htmlFor={`cd-${correctionId}`}>
          <Select id={`cd-${correctionId}`} name="decision" value={decision} onChange={(e) => setDecision(e.target.value as "accepted" | "declined")}>
            <option value="accepted">Accept</option>
            <option value="declined">Decline</option>
          </Select>
        </Field>
        <Field label={decision === "declined" ? "Why (required)" : "What will be done (optional)"} htmlFor={`cn-${correctionId}`}><Input id={`cn-${correctionId}`} name="note" maxLength={500} required={decision === "declined"} /></Field>
      </div>
    </ActionForm>
  );
}

export function DecideChange({ projectId, changeId, canDecide }: { projectId: string; changeId: string; canDecide: boolean }) {
  const [decision, setDecision] = useState<"approved" | "rejected" | "withdrawn">(canDecide ? "approved" : "withdrawn");
  return (
    <ActionForm action={decidePlanChange} submitLabel={decision === "approved" ? "Approve change" : decision === "rejected" ? "Reject change" : "Withdraw proposal"} variant={decision === "approved" ? "default" : "outline"}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="changeId" value={changeId} />
      {canDecide ? (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Decision" htmlFor={`chd-${changeId}`}>
            <Select id={`chd-${changeId}`} name="decision" value={decision} onChange={(e) => setDecision(e.target.value as "approved" | "rejected")}>
              <option value="approved">Approve</option>
              <option value="rejected">Reject</option>
            </Select>
          </Field>
          <Field label={decision === "rejected" ? "Why (required)" : "Note (optional)"} htmlFor={`chn-${changeId}`}><Input id={`chn-${changeId}`} name="note" maxLength={500} required={decision === "rejected"} /></Field>
        </div>
      ) : <input type="hidden" name="decision" value="withdrawn" />}
    </ActionForm>
  );
}
