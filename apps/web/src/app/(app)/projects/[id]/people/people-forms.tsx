"use client";

import { useState } from "react";
import { assignProjectPm, addProjectMember, endActingPm, removeProjectMember, removeProjectTeam, saveProjectTeam, setActingPm, setMemberTeam, setSalesLink } from "@/lib/actions/projectsCore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";

export interface Option { id: string; name: string }
const cancel = (close: () => void) => <Button type="button" variant="ghost" onClick={close}>Cancel</Button>;

/** Add a person who already has Projects access in this company (or a linked Sales person). The database refuses anyone else, in words. */
export function AddMemberForm({ projectId, candidates, teams }: { projectId: string; candidates: (Option & { note?: string })[]; teams: Option[] }) {
  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">Everyone who has Projects access in this company is already on the project. A founder can give someone else access first (Projects &gt; Access).</p>;
  }
  return (
    <ActionForm action={addProjectMember} submitLabel="Add to project" resetOnSuccess>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Person" htmlFor="am-user">
          <Select id="am-user" name="userId" required defaultValue="">
            <option value="" disabled>Choose a person</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.note ? ` (${c.note})` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Department (optional)" htmlFor="am-team">
          <Select id="am-team" name="teamId" defaultValue="">
            <option value="">No department</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
      </div>
    </ActionForm>
  );
}

export function MemberActions({ projectId, person, teams, openTasks, others, canRemove }: {
  projectId: string; person: Option & { teamId: string | null }; teams: Option[]; openTasks: number; others: Option[]; canRemove: boolean;
}) {
  const [dept, setDept] = useState(false);
  const [remove, setRemove] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setDept(true)}>Department</Button>
      {canRemove ? <Button type="button" size="sm" variant="outline" onClick={() => setRemove(true)}>Remove</Button> : null}
      <Modal open={dept} onClose={() => setDept(false)} title="Department" description={person.name}>
        <ActionForm action={setMemberTeam} submitLabel="Save" onDone={() => setDept(false)} secondary={cancel(() => setDept(false))}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="userId" value={person.id} />
          <Field label="Department team" htmlFor={`mt-${person.id}`}>
            <Select id={`mt-${person.id}`} name="teamId" defaultValue={person.teamId ?? ""}>
              <option value="">No department</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </ActionForm>
      </Modal>
      <Modal open={remove} onClose={() => setRemove(false)} title="Remove from project" description={`${person.name} loses access to the project's details, discussion, files and notifications straight away.`}>
        <ActionForm action={removeProjectMember} submitLabel="Remove" variant="destructive" onDone={() => setRemove(false)} secondary={cancel(() => setRemove(false))}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="userId" value={person.id} />
          {openTasks > 0 ? (
            <Field label={`Who takes over their ${openTasks} open task${openTasks === 1 ? "" : "s"}?`} htmlFor={`rt-${person.id}`} hint="Open tasks are never left with someone who cannot see them.">
              <Select id={`rt-${person.id}`} name="reassignTo" required defaultValue="">
                <option value="" disabled>Choose a member</option>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="Reason (optional)" htmlFor={`rr-${person.id}`}><Textarea id={`rr-${person.id}`} name="reason" rows={2} /></Field>
        </ActionForm>
      </Modal>
    </div>
  );
}

/** Create or edit a department team inside this project. The head must be a member. */
export function TeamButton({ projectId, team, members }: { projectId: string; team?: { id: string; name: string; headUserId: string }; members: Option[] }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant={team ? "outline" : "default"} onClick={() => setOpen(true)}>{team ? "Edit" : "Add department team"}</Button>
      {team ? <Button type="button" size="sm" variant="outline" onClick={() => setRemoving(true)}>Remove</Button> : null}
      <Modal open={open} onClose={() => setOpen(false)} title={team ? "Edit department team" : "Add department team"} description="A department team is a group inside this project with its own head, who manages the team's deliverables and tasks.">
        <ActionForm action={saveProjectTeam} submitLabel="Save team" onDone={() => setOpen(false)} secondary={cancel(() => setOpen(false))}>
          <input type="hidden" name="projectId" value={projectId} />
          {team ? <input type="hidden" name="teamId" value={team.id} /> : null}
          <Field label="Name" htmlFor={`tn-${team?.id ?? "new"}`}><Input id={`tn-${team?.id ?? "new"}`} name="name" required defaultValue={team?.name ?? ""} maxLength={80} placeholder="e.g. Programming" /></Field>
          <Field label="Department head" htmlFor={`th-${team?.id ?? "new"}`} hint="Added to the project first if they are not a member yet (they need Projects access).">
            <Select id={`th-${team?.id ?? "new"}`} name="headUserId" required defaultValue={team?.headUserId ?? ""}>
              <option value="" disabled>Choose the head</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        </ActionForm>
      </Modal>
      {team ? (
        <Modal open={removing} onClose={() => setRemoving(false)} title="Remove department team" description={`${team.name} can only be removed when it has no open deliverables or tasks. Its people stay on the project.`}>
          <ActionForm action={removeProjectTeam} submitLabel="Remove team" variant="destructive" onDone={() => setRemoving(false)} secondary={cancel(() => setRemoving(false))}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="teamId" value={team.id} />
          </ActionForm>
        </Modal>
      ) : null}
    </>
  );
}

/** Temporary project leadership: the PM's project powers until an end date, and nothing outside Projects. */
export function ActingPmForm({ projectId, members }: { projectId: string; members: Option[] }) {
  if (members.length === 0) return <p className="text-sm text-muted-foreground">Add another member first, then you can give them temporary leadership.</p>;
  return (
    <ActionForm action={setActingPm} submitLabel="Appoint" resetOnSuccess>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Member" htmlFor="ap-user">
          <Select id="ap-user" name="userId" required defaultValue=""><option value="" disabled>Choose a member</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
        </Field>
        <Field label="Until (required)" htmlFor="ap-until" hint="The last day. After it they are an ordinary member again."><Input id="ap-until" name="until" type="date" required /></Field>
      </div>
    </ActionForm>
  );
}

export function EndActingButton({ projectId, userId, name }: { projectId: string; userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>End now</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="End temporary leadership" description={`${name} becomes an ordinary member again.`}>
        <ActionForm action={endActingPm} submitLabel="End leadership" onDone={() => setOpen(false)} secondary={cancel(() => setOpen(false))}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="userId" value={userId} />
        </ActionForm>
      </Modal>
    </>
  );
}

/** Reassign the accountable PM / owner (founders and people with PM assignment). The new PM needs Projects access in this company. */
export function ReassignPmButton({ projectId, candidates, currentId }: { projectId: string; candidates: Option[]; currentId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>Change Project Manager</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Change Project Manager" description="The new Project Manager is added to the project; the previous one stays as an ordinary member.">
        <ActionForm action={assignProjectPm} submitLabel="Change Project Manager" onDone={() => setOpen(false)} secondary={cancel(() => setOpen(false))}>
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="New Project Manager" htmlFor="pm-new">
            <Select id="pm-new" name="pmUserId" required defaultValue="">
              <option value="" disabled>Choose a person</option>
              {candidates.filter((c) => c.id !== currentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

export function SalesLinkForm({ projectId, candidates }: { projectId: string; candidates: Option[] }) {
  if (candidates.length === 0) return <p className="text-sm text-muted-foreground">No other people are available to link. Only people with Sales access in this company can be linked.</p>;
  return (
    <ActionForm action={setSalesLink} submitLabel="Add Sales link" resetOnSuccess>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="linked" value="true" />
      <Field label="Sales person" htmlFor="sl-user" hint="The database accepts only people with Sales access in this company.">
        <Select id="sl-user" name="userId" required defaultValue=""><option value="" disabled>Choose a person</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </Field>
    </ActionForm>
  );
}

export function RemoveSalesLinkButton({ projectId, userId, name }: { projectId: string; userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Remove link</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Remove Sales link" description={`${name} will no longer see this project in the directory. Any membership they were given separately is not changed.`}>
        <ActionForm action={setSalesLink} submitLabel="Remove link" variant="destructive" onDone={() => setOpen(false)} secondary={cancel(() => setOpen(false))}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="linked" value="false" />
        </ActionForm>
      </Modal>
    </>
  );
}
