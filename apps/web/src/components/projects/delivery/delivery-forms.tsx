"use client";

import { useRef, useState } from "react";
import {
  addPlanSequence, decidePlanChange, decidePlanCorrection, delegatePlanSection, raisePlanCorrection, reconcilePlanTask, releaseDeliveryPlan, removeDeliverable, removePlanLine, saveDeliverable,
  savePlanLine, seedPlanScope,
} from "@/lib/actions/projectsDeliveryPlan";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DP_SECTION_LABELS, SUPPLY_ROUTE_LABELS, SUPPLY_ROUTES, type DpDetail, type DpSection, type SupplyRoute } from "@/lib/projects/delivery-plan/model";

/**
 * The Delivery Plan's forms. Each one posts to a server action that calls the database function; the function decides who may do it. A form for something already
 * released says, before saving, that the change becomes a proposal for the Project Manager. Nothing here creates a task or an equipment line: only Release does.
 */
export interface Option { id: string; name: string }
export type Done = { error: string | null; notice?: string | null };

/** A dialog whose form may answer with a notice (a proposal was sent, or the row already existed): the notice stays on screen until the person closes it. */
export function FormDialog({ label, title, description, variant = "outline", size = "sm", children, testId, dialogSize }: {
  label: string; title: string; description?: string; variant?: "default" | "outline" | "secondary" | "ghost" | "destructive"; size?: "default" | "sm"; testId?: string; dialogSize?: "default" | "wide" | "xl";
  children: (done: (s: Done) => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => { setOpen(false); setNotice(null); };
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} data-testid={testId}>{label}</Button>
      <Modal open={open} onClose={close} title={title} description={description} size={dialogSize}>
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

export interface DeliverableValues { id: string; version: number; zone: string; title: string; specs: string | null; qty?: number | null; owner_id: string | null; needed_by: string | null; image_file_id: string | null; released: boolean }

export function DeliverableDialog({ projectId, item, members, images }: { projectId: string; item?: DeliverableValues; members: Option[]; images: Option[] }) {
  return (
    <FormDialog label={item ? "Edit" : "Add technology / activation"} variant={item ? "outline" : "default"} title={item ? "Edit technology / activation" : "Add technology / activation"} testId={item ? undefined : "dp-add-deliverable"}
      description="One row is one technology or activation to deliver, for example Kids photobooth, or Entrance: Interactive LED welcome wall. A zone is optional. Add only the requirements it needs afterwards.">
      {(done) => (
        <ActionForm action={saveDeliverable} submitLabel={item ? (item.released ? "Propose change" : "Save") : "Add to the plan"} onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} />
          {item ? <><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="expectedVersion" value={item.version} /></> : null}
          {item?.released ? <Alert role="status">{RELEASED_NOTE}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Technology / activation" htmlFor="dp-title"><Input id="dp-title" name="title" required maxLength={200} defaultValue={item?.title ?? ""} /></Field>
            <Field label="Zone (optional)" htmlFor="dp-zone" hint="Where it is: Entrance, Lounge, Stage. Leave empty when the project has no zones."><Input id="dp-zone" name="zone" maxLength={120} defaultValue={item?.zone ?? ""} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quantity" htmlFor="dp-qty" hint="How many of this technology."><Input id="dp-qty" name="qty" type="number" min="0.001" step="any" defaultValue={item?.qty ?? ""} /></Field>
            <Field label="Ready by" htmlFor="dp-needed"><Input id="dp-needed" name="neededBy" type="date" defaultValue={item?.needed_by ?? ""} /></Field>
          </div>
          <Field label="Specifications (optional)" htmlFor="dp-specs"><Textarea id="dp-specs" name="specs" rows={3} maxLength={4000} defaultValue={item?.specs ?? ""} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Accountable owner" htmlFor="dp-owner" hint="One person. Requirements with nobody named go to this person at release.">
              <Select id="dp-owner" name="ownerId" defaultValue={item?.owner_id ?? ""}>
                <option value="">Not chosen yet</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
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

export interface LineValues {
  id: string; version: number; section: DpSection; description: string; qty: number | null; inv_item_id: string | null; assignee_id: string | null; needed_by: string | null; notes: string | null;
  released: boolean; booked: boolean; start_date?: string | null; supply_route?: SupplyRoute | null; detail?: DpDetail; milestone_id?: string | null; depends_on?: string[];
}
export interface LineChoice { id: string; label: string }

const KIND_CHOICES: Record<string, string[]> = {
  engineering: ["Controller", "Sensor", "Hardware programming", "Integration / test", "Other"],
  site: ["Mockup", "Installation", "Testing", "Show support", "Dismantling", "Other"],
};
const NAME_LABEL: Record<string, string> = { hardware: "Item", content: "Deliverable", apps: "App name", engineering: "What is needed", site: "What is needed" };

/** A small labelled field whose value is one key of the line's details (the database keeps only the keys of the section). */
function DetailInput({ k, label, hint, type = "text", defaultValue, options, placeholder }: { k: keyof DpDetail & string; label: string; hint?: string; type?: "text" | "number" | "date"; defaultValue?: string | number; options?: string[]; placeholder?: string }) {
  const id = `dd-${k}`;
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      {options ? (
        <Select id={id} name={`d_${k}`} defaultValue={defaultValue === undefined ? "" : String(defaultValue)}>
          <option value="">Not set</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      ) : <Input id={id} name={`d_${k}`} type={type} maxLength={200} min={type === "number" ? 1 : undefined} step={type === "number" ? 1 : undefined} placeholder={placeholder} defaultValue={defaultValue === undefined ? "" : String(defaultValue)} />}
    </Field>
  );
}

/**
 * Add or edit one requirement of a technology / activation. The fields shown depend on the section, so a simple job (hardware and installation) never meets the Content, Apps or
 * Engineering fields. A work line becomes one task at release; a hardware line becomes one line on the draft equipment request when it is matched to Inventory. Nothing is created here.
 */
export function LineDialog({ projectId, itemId, line, sections, members, stock, stockFailed, milestones = [], others = [] }: {
  projectId: string; itemId: string; line?: LineValues; sections: DpSection[]; members: Option[]; stock: Option[]; stockFailed: boolean; milestones?: Option[]; others?: LineChoice[];
}) {
  const [section, setSection] = useState<DpSection>(line?.section ?? sections[0] ?? "hardware");
  const [route, setRoute] = useState<SupplyRoute>(line?.supply_route ?? "inventory");
  const hardware = section === "hardware";
  const d = line?.detail ?? {};
  const locked = !!line?.released && hardware;                     // how released hardware is supplied is changed on the Equipment tab
  const own = hardware && route !== "inventory";
  const kinds = KIND_CHOICES[section === "installation" || section === "testing" ? "site" : section === "programming" ? "apps" : section];
  return (
    <FormDialog label={line ? "Edit" : "Add requirement"} title={line ? "Edit requirement" : "Add a requirement"}
      description="Enter each requirement once. A work requirement becomes one task at release; hardware matched to Inventory becomes one line on the draft equipment request. Neither exists until the Project Manager releases it.">
      {(done) => (
        <ActionForm action={savePlanLine} submitLabel={line ? (line.released ? "Propose change" : "Save") : "Add requirement"} onDone={(s) => done(s as Done)} disabled={!!line?.booked}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="itemId" value={itemId} />
          {line ? <><input type="hidden" name="lineId" value={line.id} /><input type="hidden" name="expectedVersion" value={line.version} /></> : null}
          {line?.booked ? <Alert variant="warning" role="status">This equipment is already with the warehouse. Change it on the Equipment tab; the plan cannot change a booking.</Alert>
            : line?.released ? <Alert role="status">{RELEASED_NOTE}</Alert> : null}
          {line ? <p className="text-sm text-muted-foreground">Section: <span className="font-medium text-foreground">{DP_SECTION_LABELS[line.section]}</span></p> : (
            <Field label="Section" htmlFor="dl-section">
              <Select id="dl-section" name="section" value={section} onChange={(e) => setSection(e.target.value as DpSection)} required>
                {sections.map((s) => <option key={s} value={s}>{DP_SECTION_LABELS[s]}</option>)}
              </Select>
            </Field>
          )}
          <Field label={NAME_LABEL[section] ?? "What is needed"} htmlFor="dl-desc"><Input id="dl-desc" name="description" required maxLength={300} defaultValue={line?.description ?? ""} /></Field>

          {hardware ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Quantity" htmlFor="dl-qty"><Input id="dl-qty" name="qty" type="number" min="0.001" step="any" defaultValue={line?.qty ?? ""} /></Field>
                <Field label="Needed by" htmlFor="dl-needed" hint="Empty = the activation's ready-by date."><Input id="dl-needed" name="neededBy" type="date" defaultValue={line?.needed_by ?? ""} /></Field>
              </div>
              <Field label="Specification" htmlFor="dl-notes" hint="Size, model, finish. Without one the line shows Specification pending."><Textarea id="dl-notes" name="notes" rows={2} maxLength={2000} defaultValue={line?.notes ?? ""} /></Field>
              <Field label="How is it supplied?" htmlFor="dl-route" hint={locked ? "Released to Warehouse: changed on the Equipment tab." : undefined}>
                <Select id="dl-route" name="supplyRoute" value={route} disabled={locked} onChange={(e) => setRoute(e.target.value as SupplyRoute)}>
                  {SUPPLY_ROUTES.map((r) => <option key={r} value={r}>{SUPPLY_ROUTE_LABELS[r]}</option>)}
                </Select>
              </Field>
              {route === "inventory" ? (
                <Field label="Stock item" htmlFor="dl-stock"
                  hint={stockFailed ? "Could not load the stock list. Save the line as it is and match it later; it waits, and the rest of the plan is not held up." : "Search the catalogue. If it is not there, save it as a manual line: it stays visible as Needs stock match, and the rest is released. Match it later and release again to add it once."}>
                  <Select id="dl-stock" name="invItemId" defaultValue={line?.inv_item_id ?? ""}>
                    <option value="">Not in Inventory yet: manual line</option>
                    {stock.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Owner" htmlFor="dl-assignee" hint="Who is responsible for getting it."><Select id="dl-assignee" name="assigneeId" defaultValue={line?.assignee_id ?? ""}><option value="">Nobody yet</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
                  <DetailInput k="expected_date" label="Expected on" type="date" defaultValue={d.expected_date} />
                  <DetailInput k="source" label={route === "client" ? "Supplied by" : "Supplier"} defaultValue={d.source} />
                </div>
              )}
              {route === "inventory" ? <input type="hidden" name="d_source" value="" /> : null}
            </>
          ) : (
            <>
              {section === "content" || section === "apps" || section === "engineering" || section === "site" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {section === "content" ? (
                    <>
                      <DetailInput k="deliverable_type" label="Type of deliverable" placeholder="Storyboard, animation, UI screens" defaultValue={d.deliverable_type} />
                      <DetailInput k="count" label="How many" type="number" defaultValue={d.count} />
                      <DetailInput k="format" label="Format" placeholder="MP4, PDF, PNG" defaultValue={d.format} />
                      <DetailInput k="resolution" label="Resolution" placeholder="1080 x 1920" defaultValue={d.resolution} />
                      <DetailInput k="orientation" label="Orientation" options={["Landscape", "Portrait", "Square"]} defaultValue={d.orientation} />
                    </>
                  ) : null}
                  {section === "apps" ? (
                    <>
                      <DetailInput k="purpose" label="Purpose" defaultValue={d.purpose} />
                      <DetailInput k="app_count" label="Number of apps" type="number" defaultValue={d.app_count} />
                      <DetailInput k="platform" label="Platform" placeholder="Android tablet, Windows, web" defaultValue={d.platform} />
                      <DetailInput k="device_count" label="Number of devices" type="number" hint="One app on six screens is one app and six devices." defaultValue={d.device_count} />
                    </>
                  ) : null}
                  {section === "engineering" || section === "site" ? <DetailInput k="kind" label="Kind" options={kinds} defaultValue={d.kind} /> : null}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Owner" htmlFor="dl-assignee" hint="Gets the task at release. Empty = the accountable owner.">
                  <Select id="dl-assignee" name="assigneeId" defaultValue={line?.assignee_id ?? ""}>
                    <option value="">The accountable owner</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </Field>
                <Field label="Planned start" htmlFor="dl-start"><Input id="dl-start" name="startDate" type="date" defaultValue={line?.start_date ?? ""} /></Field>
                <Field label="Due" htmlFor="dl-needed" hint="Empty = the activation's date."><Input id="dl-needed" name="neededBy" type="date" defaultValue={line?.needed_by ?? ""} /></Field>
              </div>
              {milestones.length > 0 ? (
                <Field label="Milestone" htmlFor="dl-ms" hint="The task counts toward this milestone's “N of M complete”.">
                  <Select id="dl-ms" name="milestoneId" defaultValue={line?.milestone_id ?? ""}>
                    <option value="">None</option>
                    {milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </Field>
              ) : null}
              {others.length > 0 ? (
                <fieldset className="space-y-1">
                  <legend className="text-[13px] font-medium text-muted-foreground">Waits for</legend>
                  <input type="hidden" name="dependsOnPresent" value="1" />
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                    {others.map((o) => (
                      <label key={o.id} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="dependsOn" value={o.id} defaultChecked={line?.depends_on?.includes(o.id)} className="mt-1" />
                        <span className="break-words">{o.label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[13px] text-muted-foreground">Becomes a task dependency at release. A late predecessor shows against this line.</p>
                </fieldset>
              ) : null}
              <Field label="Notes" htmlFor="dl-notes"><Textarea id="dl-notes" name="notes" rows={2} maxLength={2000} defaultValue={line?.notes ?? ""} /></Field>
            </>
          )}
          {line?.released && !line.booked ? <Field label="Why is it changing?" htmlFor="dl-reason"><Input id="dl-reason" name="reason" maxLength={300} /></Field> : null}
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** A sequence starts blank: work that is already tracked as tasks (a moodboard, a storyboard) is not offered again, so nobody re-enters it here by habit. */
const SEQUENCE_START_STEPS = 2;
type Step = { id: number; name: string; owner: string; start: string; due: string };

/**
 * Start from an empty, editable chain: each step is a requirement that waits for the one before; names, owners and dates are the person's.
 * Each step is a card: a full-width name, then Owner (the widest), Start date and Due date on a second row with visible labels; the fields stack on a phone. The chosen owner is
 * also written out in full under the field, so a long name is readable even where the box would clip it. "Use activation owner" is what an empty owner means: at release the task
 * goes to the technology's accountable owner.
 */
export function SequenceDialog({ projectId, itemId, section, members, milestones, activationOwner }: {
  projectId: string; itemId: string; section: DpSection; members: Option[]; milestones: Option[]; /** The accountable owner of the technology, named in the default choice. */ activationOwner?: string | null;
}) {
  const next = useRef(SEQUENCE_START_STEPS);
  const blank = (name: string): Step => ({ id: next.current++, name, owner: "", start: "", due: "" });
  const [steps, setSteps] = useState<Step[]>(() => Array.from({ length: SEQUENCE_START_STEPS }, (_, i) => ({ id: i, name: "", owner: "", start: "", due: "" })));
  const set = (id: number, patch: Partial<Step>) => setSteps((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const defaultOwner = `Use activation owner${activationOwner ? ` (${activationOwner})` : " (none set yet)"}`;
  return (
    <FormDialog label="Start from a sequence" title="Add a sequence of requirements" dialogSize="xl"
      description={`Each step waits for the one before it. Name each step, add or remove steps, and give each its own owner and dates. Section: ${DP_SECTION_LABELS[section]}. Nothing is released until the Project Manager releases it.`}>
      {(done) => (
        <ActionForm action={addPlanSequence} submitLabel="Add the steps" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="section" value={section} />
          <p className="text-[13px] text-muted-foreground" data-testid="seq-hint">Nothing is filled in for you. Work that already exists as a task (see the Work page) is tracked there: add only requirements that are not tasks yet. Empty steps are ignored.</p>
          <ol className="space-y-3">
            {steps.map((st, n) => (
              <li key={st.id} className="space-y-3 rounded-md border border-border p-3" data-testid={`seq-step-${n}`}>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor={`seq-name-${st.id}`} className="text-[13px] font-medium text-muted-foreground">Step {n + 1}</label>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSteps((all) => all.filter((x) => x.id !== st.id))} aria-label={`Remove step ${n + 1}`}>Remove</Button>
                  </div>
                  <Input id={`seq-name-${st.id}`} name="stepDescription" aria-label={`Step ${n + 1} name`} placeholder="Name this step" value={st.name} onChange={(e) => set(st.id, { name: e.target.value })} maxLength={300} className="w-full" />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <label htmlFor={`seq-owner-${st.id}`} className="mb-1 block text-[13px] font-medium text-muted-foreground">Owner</label>
                    <Select id={`seq-owner-${st.id}`} name="stepOwner" aria-label={`Step ${n + 1} owner`} value={st.owner} onChange={(e) => set(st.id, { owner: e.target.value })} className="w-full min-w-0">
                      <option value="">{defaultOwner}</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </Select>
                    {st.owner ? <p className="mt-1 break-words text-[13px]" data-testid={`seq-owner-name-${n}`}>Assigned to {memberName.get(st.owner) ?? "the person chosen"}</p> : null}
                  </div>
                  <div className="min-w-0">
                    <label htmlFor={`seq-start-${st.id}`} className="mb-1 block text-[13px] font-medium text-muted-foreground">Start date</label>
                    <Input id={`seq-start-${st.id}`} name="stepStart" type="date" aria-label={`Step ${n + 1} start`} value={st.start} onChange={(e) => set(st.id, { start: e.target.value })} className="w-full" />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor={`seq-due-${st.id}`} className="mb-1 block text-[13px] font-medium text-muted-foreground">Due date</label>
                    <Input id={`seq-due-${st.id}`} name="stepDue" type="date" aria-label={`Step ${n + 1} due`} value={st.due} onChange={(e) => set(st.id, { due: e.target.value })} className="w-full" />
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {steps.length < 12 ? <Button type="button" variant="outline" size="sm" onClick={() => setSteps((all) => [...all, blank("")])}>Add a step</Button> : null}
          {milestones.length > 0 ? (
            <Field label="Milestone for all steps (optional)" htmlFor="seq-ms">
              <Select id="seq-ms" name="milestoneId" defaultValue=""><option value="">None</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            </Field>
          ) : null}
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** Brings the accepted handover's technologies in, once. Repeating it adds nothing and never overwrites what the Project Manager edited. */
export function SeedScopeDialog({ projectId, names }: { projectId: string; names: string[] }) {
  return (
    <FormDialog label={`Bring in accepted technologies (${names.length})`} variant="default" size="default" testId="dp-seed-scope" title="Bring the accepted scope into the plan"
      description="Each technology from the accepted handover becomes one row with its quantity. Rows already in the plan, or brought in and removed earlier, are left alone, so doing this again never duplicates or overwrites anything.">
      {(done) => (
        <ActionForm action={seedPlanScope} submitLabel="Add to the plan" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} />
          <ul className="list-disc pl-5 text-sm">{names.map((n) => <li key={n} className="break-words">{n}</li>)}</ul>
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** A change the linked task could not take: retry it, or keep the task as it is (the plan then follows the task). */
export function ReconcileDialog({ projectId, lineId, reason }: { projectId: string; lineId: string; reason?: string | null }) {
  return (
    <FormDialog label="Resolve" variant="outline" title="Task update pending" description={`The plan was changed and approved, but the linked task could not take it${reason ? `: ${reason}` : ""}. Retry once whatever blocked it is cleared, or keep the task as it is.`}>
      {(done) => (
        <div className="flex flex-wrap gap-2">
          <ActionForm action={reconcilePlanTask} submitLabel="Retry the update" onDone={(s) => done(s as Done)}>
            <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="lineId" value={lineId} /><input type="hidden" name="action" value="retry" />
          </ActionForm>
          <ActionForm action={reconcilePlanTask} submitLabel="Keep the task as it is" variant="outline" onDone={(s) => done(s as Done)}>
            <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="lineId" value={lineId} /><input type="hidden" name="action" value="keep_task" />
          </ActionForm>
        </div>
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
export function ReleaseDialog({ projectId, itemId, label, preview }: { projectId: string; itemId?: string; label: string; preview: { tasks: number; equipment: number; external?: number; waiting: { key: string; reason: string }[] } }) {
  const nothing = preview.tasks + preview.equipment === 0;
  const external = preview.external ?? 0;
  return (
    <FormDialog label={label} variant={itemId ? "outline" : "default"} title={itemId ? "Release this technology / activation" : "Release the plan"} testId={itemId ? undefined : "dp-release"}
      description="Release gives the work to the teams. It can be repeated safely: a line that was already released is never created twice.">
      {(done) => (
        <ActionForm action={releaseDeliveryPlan} submitLabel={nothing ? "Nothing to release" : "Release"} pendingLabel="Releasing…" onDone={(s) => done(s as Done)} disabled={nothing}>
          <input type="hidden" name="projectId" value={projectId} />
          {itemId ? <input type="hidden" name="itemId" value={itemId} /> : null}
          <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="dp-release-preview">
            <li>{preview.tasks} task{preview.tasks === 1 ? "" : "s"} will be created and assigned.</li>
            <li>{preview.equipment} hardware line{preview.equipment === 1 ? "" : "s"} will be added to the project&apos;s <strong>draft</strong> equipment request. It is not sent to the warehouse: you review and submit it on the Equipment tab.</li>
            {external > 0 ? <li>{external} hardware line{external === 1 ? " is" : "s are"} bought, rented or client supplied: followed in the plan, not sent to the warehouse.</li> : null}
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
