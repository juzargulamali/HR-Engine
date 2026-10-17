"use client";

import { useState } from "react";
import { CalendarDays, CheckCircle2, Circle, FileText, History, Link2, MapPin, MessageSquarePlus, Phone, CalendarPlus, CheckCheck, Upload, UserCog } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ACTIVITIES, APPROVAL_POLICY, COMPANIES, FOLLOWUPS, HISTORY, NOW, PROPOSALS, SALES_USERS, ZOHO, approvalRecordsFor, commercialStatus, contactById, coverageText, equipmentOk,
  fmtDate, fmtDateTime, fmtRange, money, oppByRef, orgById, personName, proposalSource, sameSnapshot, snapshot, stageLabel, TODAY, fmtDue,
  type Activity, type ApprovalRecord, type FollowUp, type HistoryEntry, type Opportunity, type PersonId, type ProposalVersion, type StageId, type Tech,
} from "../_lib/data";
import { PLink, usePreview } from "./context";
import { ContactCard } from "./contact-card";
import { CompleteFollowUpDialog, LogActivityDialog, ScheduleNextDialog, type CompleteResult } from "./followup-dialogs";
import { MoveDialog, type MoveResult } from "./move-dialog";
import { ClientLine, useOppRights } from "./sales-bits";
import { ActionMenu, AvailabilityChip, Chip, Deadline, Field, Hint, PageHeader, Panel, Restriction, Sheet, StageChip, Tabs, availabilityDetail, useNotice } from "./ui";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "scope", label: "Scope & Dates" },
  { id: "activities", label: "Activities" },
  { id: "proposals", label: "Proposals & Quotes" },
  { id: "confirmation", label: "Confirmation & Handover" },
  { id: "history", label: "History" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>;
}

/** Install, show dates and place, directly under the title. Unknown dates stay allowed. */
function KeyDates({ o }: { o: Pick<Opportunity, "installStart" | "eventStart" | "eventEnd" | "location"> }) {
  const unknown = <span className="text-muted-foreground">Dates not confirmed</span>;
  const label = "flex items-center gap-1.5 text-xs text-muted-foreground";
  return (
    <dl className="mb-4 grid gap-x-8 gap-y-3 rounded-lg border border-border bg-card px-4 py-3 text-sm sm:grid-cols-3" aria-label="Key dates and location">
      <div><dt className={label}><CalendarDays className="h-3.5 w-3.5" aria-hidden />Installation</dt><dd className="mt-0.5 font-medium">{o.installStart ? fmtDate(o.installStart) : unknown}</dd></div>
      <div><dt className={label}><CalendarDays className="h-3.5 w-3.5" aria-hidden />Show</dt><dd className="mt-0.5 font-medium">{o.eventStart ? fmtRange(o.eventStart, o.eventEnd) : unknown}</dd></div>
      <div className="min-w-0"><dt className={label}><MapPin className="h-3.5 w-3.5" aria-hidden />Location</dt><dd className="mt-0.5 break-words font-medium">{o.location ?? <span className="text-muted-foreground">Not recorded</span>}</dd></div>
    </dl>
  );
}

export function OpportunityDetail({ refId }: { refId: string }) {
  const opp = oppByRef(refId)!;
  const { tab: tabParam, roleDef } = usePreview();
  const initial = (TABS.find((t) => t.id === tabParam)?.id ?? "overview") as TabId;
  const [tab, setTab] = useState<TabId>(initial);
  const { notify, node } = useNotice();
  const rights = useOppRights(opp);

  const [owner, setOwner] = useState<PersonId>(opp.owner);
  const [stage, setStage] = useState<StageId>(opp.stage);
  const [hold, setHold] = useState<{ reason?: string; review?: string }>({ reason: opp.holdReason, review: opp.holdReview });
  const [acts, setActs] = useState<Activity[]>(ACTIVITIES.filter((a) => a.oppId === opp.id));
  const [fus, setFus] = useState<FollowUp[]>(FOLLOWUPS.filter((f) => f.oppId === opp.id));
  const [props, setProps] = useState<ProposalVersion[]>(PROPOSALS.filter((p) => p.oppId === opp.id));
  const [approvals, setApprovals] = useState<ApprovalRecord[]>(approvalRecordsFor(opp.id));
  const [hist, setHist] = useState<HistoryEntry[]>(HISTORY[opp.id] ?? [{ at: `${opp.createdAt}T09:00`, by: opp.createdBy, what: `Created enquiry (source: ${opp.source}). Owner set to ${personName(opp.createdBy)} (creator).` }]);
  // What the opportunity says now (editable on Scope & Dates). Equipment availability is judged against this.
  const [sched, setSched] = useState({ prepStart: opp.prepStart ?? "", installStart: opp.installStart ?? "", eventStart: opp.eventStart ?? "", eventEnd: opp.eventEnd ?? "", dismantle: opp.dismantle ?? "", returnBy: opp.returnBy ?? "" });
  const [techs, setTechs] = useState<Tech[]>(opp.technologies.map((t) => ({ ...t })));
  const [avail, setAvail] = useState(opp.availability);
  const [dialog, setDialog] = useState<null | "log" | "schedule" | "move" | "reassign">(null);
  const [completing, setCompleting] = useState<FollowUp | null>(null);
  const [newOwner, setNewOwner] = useState<PersonId>(SALES_USERS.find((p) => p !== opp.owner)!);
  const [reassignWhy, setReassignWhy] = useState("");
  const [reassignErr, setReassignErr] = useState<string | null>(null);

  const open = stage !== "won" && stage !== "lost";
  const openFus = fus.filter((f) => !f.doneAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const next = openFus[0] ?? null;
  const current = { ...opp, installStart: sched.installStart || null, eventStart: sched.eventStart || null, eventEnd: sched.eventEnd || null, technologies: techs, availability: avail, stage } as Opportunity;
  const addHist = (what: string) => setHist((h) => [{ at: NOW, by: roleDef.person, what }, ...h]);

  function onMoved(r: MoveResult) {
    setStage(r.stage);
    if (r.stage === "on_hold") setHold({ reason: r.holdReason, review: r.holdReview });
    if (r.nextAction) setFus((f) => [...f, { id: `n${f.length}`, oppId: opp.id, owner, title: r.nextAction!, dueAt: r.nextDueAt!, createdAt: NOW, kind: "other" }]);
    addHist(`Stage ${stageLabel(stage)} → ${stageLabel(r.stage)}.${r.holdReason ? ` Reason: ${r.holdReason}. Review ${fmtDate(r.holdReview)}.` : ""}`);
    notify(`Moved to ${stageLabel(r.stage)}`);
  }
  function onCompleted(f: FollowUp, r: CompleteResult) {
    setFus((all) => {
      const done = all.map((x) => (x.id === f.id ? { ...x, doneAt: NOW, outcome: r.outcome } : x));
      return r.next.kind === "schedule" ? [...done, { id: `n${all.length}`, oppId: opp.id, owner, title: r.next.title, dueAt: r.next.dueAt, createdAt: NOW, kind: r.next.actionKind }] : done;
    });
    setActs((a) => [
      ...(r.notes || r.reply === "yes" ? [{ id: `c${a.length}`, oppId: opp.id, type: (r.reply === "yes" ? "client_response" : "note") as Activity["type"], at: NOW, by: roleDef.person, text: r.notes || r.outcome, internal: r.reply !== "yes" }] : []),
      { id: `o${a.length}`, oppId: opp.id, type: "note", at: NOW, by: roleDef.person, text: `Completed “${f.title}”: ${r.outcome}.${r.reply === "no" ? " No reply yet." : ""}`, internal: true },
      ...a,
    ]);
    if (r.next.kind === "hold") { setStage("on_hold"); setHold({ reason: r.next.reason, review: r.next.review }); }
    addHist(`Follow-up “${f.title}” completed (${r.outcome}). ${r.next.kind === "schedule" ? `Next: ${r.next.title}, ${fmtDue(r.next.dueAt)}.` : `Put on hold: ${r.next.reason}, review ${fmtDate(r.next.review)}.`}`);
    notify("Follow-up completed");
  }

  const canWork = rights.canChange && open;
  const menu = [
    ...(canWork ? [{ label: "Change stage", onSelect: () => setDialog("move") }, { label: "Mark Won or Lost", onSelect: () => undefined, href: `/os-preview/sales/opportunities/${opp.ref}/close` }] : []),
    ...(rights.canAssign && open ? [{ label: "Reassign owner", onSelect: () => setDialog("reassign") }] : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow={`${opp.ref} · ${COMPANIES[opp.company].name.replace(" (sample entity)", "")}`}
        title={opp.title}
        actionsBelow
        actions={
          <>
            <Button size="sm" onClick={() => setDialog("log")}><MessageSquarePlus className="h-4 w-4" aria-hidden />Log activity</Button>
            {open ? <Button size="sm" variant="outline" disabled={!rights.canChange || !next} onClick={() => next && setCompleting(next)}><CheckCheck className="h-4 w-4" aria-hidden />Complete follow-up</Button> : null}
            {open ? <Button size="sm" variant="outline" disabled={!rights.canChange} onClick={() => setDialog("schedule")}><CalendarPlus className="h-4 w-4" aria-hidden />Schedule next action</Button> : null}
            <ActionMenu label="More" items={menu} />
          </>
        }
      />
      <KeyDates o={current} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StageChip stage={stage} />
        {stage === "on_hold" ? <Chip tone="warn">Review {fmtDate(hold.review)}</Chip> : null}
        {opp.waiting === "client" && open && stage !== "on_hold" ? <Chip>Waiting for client</Chip> : null}
        <AvailabilityChip o={current} />
        <span className="text-sm text-muted-foreground">Owner <strong className="text-foreground">{personName(owner)}</strong></span>
      </div>
      {!rights.canChange && open ? <div className="mb-4"><Restriction>{rights.reason}</Restriction></div> : null}
      {open && !next ? <div role="alert" className="mb-4 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm">No next action is scheduled. Add one so this opportunity is not forgotten.{rights.canChange ? <> <button type="button" className="font-medium underline" onClick={() => setDialog("schedule")}>Schedule next action</button></> : null}</div> : null}

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Opportunity sections" />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-5">
        {tab === "overview" ? <Overview opp={current} owner={owner} next={next} /> : null}
        {tab === "scope" ? (
          <Scope opp={opp} current={current} sched={sched} setSched={setSched} techs={techs} setTechs={setTechs} canEdit={canWork}
            onSave={() => { addHist("Scope, dates or quantities updated."); notify("Changes saved"); }}
            onRequestCheck={() => { setAvail({ state: "awaiting", requestedBy: roleDef.person, requestedAt: NOW }); addHist("Equipment availability check requested."); notify("Equipment check requested"); }} />
        ) : null}
        {tab === "activities" ? <Activities acts={acts} fus={fus} open={open} canWork={canWork} onComplete={setCompleting} onLog={() => setDialog("log")} /> : null}
        {tab === "proposals" ? <Proposals opp={opp} props={props} setProps={setProps} approvals={approvals} setApprovals={setApprovals} canEdit={canWork} isFounder={roleDef.canConfigureSales} notify={notify} addHist={addHist} /> : null}
        {tab === "confirmation" ? <Confirmation opp={current} stage={stage} canChange={rights.canChange} /> : null}
        {tab === "history" ? <HistoryTab hist={hist} /> : null}
      </div>

      <LogActivityDialog opp={opp} open={dialog === "log"} onClose={() => setDialog(null)} onSave={(a) => {
        setActs((x) => [{ id: `l${x.length}`, oppId: opp.id, type: a.type, at: NOW, by: roleDef.person, text: a.text, internal: a.internal }, ...x]);
        addHist(`${a.internal ? "Activity" : "Client response"} recorded.`); notify("Activity saved");
      }} />
      <ScheduleNextDialog opp={opp} open={dialog === "schedule"} onClose={() => setDialog(null)} onSave={(f) => {
        setFus((x) => [...x, { id: `s${x.length}`, oppId: opp.id, owner, title: f.title, dueAt: f.dueAt, createdAt: NOW, kind: f.kind }]);
        addHist(`Next action scheduled: ${f.title}, ${fmtDue(f.dueAt)}.`); notify("Next action scheduled");
      }} />
      {completing ? <CompleteFollowUpDialog key={completing.id} opp={opp} followUp={completing} open onClose={() => setCompleting(null)} onDone={(r) => onCompleted(completing, r)} /> : null}
      {dialog === "move" ? <MoveDialog key={stage} opp={opp} stage={stage} open onClose={() => setDialog(null)} onMoved={onMoved} /> : null}
      <Sheet open={dialog === "reassign"} onClose={() => setDialog(null)} title="Reassign owner">
        <form noValidate className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (!reassignWhy.trim()) { setReassignErr("Give a reason. It is kept in the history."); return; }
          addHist(`Owner changed from ${personName(owner)} to ${personName(newOwner)} by ${personName(roleDef.person)}. Reason: ${reassignWhy.trim()}`);
          setOwner(newOwner); setDialog(null); setReassignWhy(""); setReassignErr(null); notify(`Owner is now ${personName(newOwner)}`);
        }}>
          <p className="text-sm text-muted-foreground">Only Juzar and Rafi can assign or reassign owners.</p>
          <Field label="New owner" htmlFor="ra-owner" required><Select id="ra-owner" value={newOwner} onChange={(e) => setNewOwner(e.target.value as PersonId)}>{SALES_USERS.filter((p) => p !== owner).map((p) => <option key={p} value={p}>{personName(p)}</option>)}</Select></Field>
          <Field label="Reason" htmlFor="ra-why" required error={reassignErr}><Textarea id="ra-why" rows={2} value={reassignWhy} onChange={(e) => setReassignWhy(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" size="sm">Reassign</Button></div>
        </form>
      </Sheet>
      {node}
    </>
  );
}

function Overview({ opp, owner, next }: { opp: Opportunity; owner: PersonId; next: FollowUp | null }) {
  const firstResp = opp.firstResponseAt ? `${Math.max(0, Math.round((Date.parse(`${opp.firstResponseAt}:00Z`) - Date.parse(`${opp.createdAt}T09:00:00Z`)) / 3600000))} h after it was logged` : "No first response recorded yet";
  const closed = opp.stage === "won" || opp.stage === "lost";
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel title="Brief"><p className="text-sm">{opp.brief}</p></Panel>
        <Panel title="Who is involved" help="The agency and the end client are separate relationships. Each contact shows their role on this opportunity.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agency</h3><p className="mt-1 text-sm font-medium">{opp.agencyId ? orgById(opp.agencyId).name : "No agency (direct client)"}</p></div>
            <div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">End client</h3><p className="mt-1 text-sm font-medium">{opp.endClientId ? orgById(opp.endClientId).name : "Not recorded"}</p></div>
          </div>
          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacts</h3>
          {opp.contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts linked yet.</p> : (
            <div className="grid gap-3 md:grid-cols-2">{opp.contacts.map((c) => <ContactCard key={c.contactId} contact={contactById(c.contactId)} roleOnOpportunity={c.role} />)}</div>
          )}
        </Panel>
      </div>
      <div className="space-y-6">
        <Panel title="Next action">
          {next ? (<><p className="text-sm font-medium">{next.title}</p><Deadline dueAt={next.dueAt} className="mt-1" /></>) : <p className="text-sm text-muted-foreground">{closed ? "Closed. No next action." : "None scheduled."}</p>}
        </Panel>
        <Panel title="Status">
          <dl className="space-y-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Commercial</dt><dd className="mt-0.5 flex flex-wrap items-center gap-2"><Chip tone={commercialStatus(opp) === "Commercially won" ? "good" : "neutral"}>{commercialStatus(opp)}</Chip>{commercialStatus(opp) !== "Commercially won" ? <span className="text-xs text-muted-foreground">Needs a purchase order or authorised email</span> : null}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Equipment</dt><dd className="mt-0.5"><AvailabilityChip o={opp} /><p className="mt-1 text-xs text-muted-foreground">{availabilityDetail(opp)}</p></dd></div>
          </dl>
        </Panel>
        <Panel title="Key facts">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Value">{money(opp.value, opp.currency)}</Fact>
            <Fact label="Budget as stated">{opp.budgetNote ?? "Not known"}</Fact>
            <Fact label="Source">{opp.source}</Fact>
            <Fact label="Owner">{personName(owner)}</Fact>
            <Fact label="Created">{fmtDate(opp.createdAt)}</Fact>
            <Fact label="First response">{firstResp}</Fact>
            <Fact label="Client" className="col-span-2"><ClientLine o={opp} /></Fact>
          </dl>
        </Panel>
      </div>
    </div>
  );
}

type Sched = { prepStart: string; installStart: string; eventStart: string; eventEnd: string; dismantle: string; returnBy: string };
function Scope({ opp, current, sched, setSched, techs, setTechs, canEdit, onSave, onRequestCheck }: {
  opp: Opportunity; current: Opportunity; sched: Sched; setSched: (s: Sched) => void; techs: Tech[]; setTechs: (t: Tech[]) => void; canEdit: boolean; onSave: () => void; onRequestCheck: () => void;
}) {
  const a = current.availability;
  const stale = a.state === "confirmed" && a.covers ? !sameSnapshot(a.covers, snapshot(current)) : false;
  const set = (k: keyof Sched) => (e: React.ChangeEvent<HTMLInputElement>) => setSched({ ...sched, [k]: e.target.value });
  const schedule: { label: string; value: string | null }[] = [
    { label: "Preparation starts", value: sched.prepStart || null }, { label: "Installation starts", value: sched.installStart || null },
    { label: "Show", value: sched.eventStart ? fmtRange(sched.eventStart, sched.eventEnd || null) : null }, { label: "Dismantling", value: sched.dismantle || null }, { label: "Equipment returned by", value: sched.returnBy || null },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel title="Scope"><p className="text-sm">{opp.scope}</p><h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exclusions</h3><p className="mt-1 text-sm">{opp.exclusions}</p></Panel>
        <Panel title="Full schedule" description="Leave a date blank while it is not known.">
          <ol className="mb-4 grid gap-2 sm:grid-cols-5">
            {schedule.map((s) => <li key={s.label} className="rounded-md border border-border px-3 py-2"><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-sm font-medium">{s.value ? (s.label === "Show" ? s.value : fmtDate(s.value)) : <span className="font-normal text-muted-foreground">Not confirmed</span>}</p></li>)}
          </ol>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Preparation starts" htmlFor="d-prep"><Input id="d-prep" type="date" disabled={!canEdit} value={sched.prepStart} onChange={set("prepStart")} /></Field>
              <Field label="Installation starts" htmlFor="d-install"><Input id="d-install" type="date" disabled={!canEdit} value={sched.installStart} onChange={set("installStart")} /></Field>
              <Field label="Show starts" htmlFor="d-start"><Input id="d-start" type="date" disabled={!canEdit} value={sched.eventStart} onChange={set("eventStart")} /></Field>
              <Field label="Show ends" htmlFor="d-end"><Input id="d-end" type="date" disabled={!canEdit} value={sched.eventEnd} onChange={set("eventEnd")} /></Field>
              <Field label="Dismantling" htmlFor="d-dis"><Input id="d-dis" type="date" disabled={!canEdit} value={sched.dismantle} onChange={set("dismantle")} /></Field>
              <Field label="Equipment returned by" htmlFor="d-ret"><Input id="d-ret" type="date" disabled={!canEdit} value={sched.returnBy} onChange={set("returnBy")} /></Field>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Technologies and quantities</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {techs.map((t, i) => (
                  <li key={t.name} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                    <label htmlFor={`q-${i}`} className="min-w-0 flex-1">{t.name}</label>
                    <Input id={`q-${i}`} type="number" min={1} aria-label={`Quantity of ${t.name}`} disabled={!canEdit} value={t.qty} onChange={(e) => setTechs(techs.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} className="h-8 w-20" />
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Location: {opp.location ?? "Not recorded"}</p>{canEdit ? <Button type="submit" size="sm">Save changes</Button> : <span className="text-xs text-muted-foreground">Read only for you</span>}</div>
          </form>
        </Panel>
      </div>
      <Panel title="Equipment availability" help="A check that the technology is free for these dates and quantities. It is not a stock reservation, and it is separate from commercial confirmation. Inventory is not part of this release.">
        <AvailabilityChip o={current} />
        {stale ? (
          <div role="alert" className="mt-3 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm"><strong>Needs repeating.</strong> The dates, technologies or quantities changed after the check, so it no longer applies.</div>
        ) : null}
        <p className="mt-3 text-sm">{availabilityDetail(current)}</p>
        {a.state === "confirmed" && a.covers ? (
          <dl className="mt-3 space-y-2 border-t border-border/70 pt-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Checked by</dt><dd>{personName(a.by)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Checked on</dt><dd>{fmtDateTime(a.at)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">The check covers</dt><dd>{coverageText(a.covers)}</dd></div>
          </dl>
        ) : null}
        {canEdit && a.state !== "awaiting" ? <Button size="sm" variant={stale ? "default" : "outline"} className="mt-4" onClick={onRequestCheck}>Request equipment check</Button> : null}
      </Panel>
    </div>
  );
}

function Activities({ acts, fus, open, canWork, onComplete, onLog }: { acts: Activity[]; fus: FollowUp[]; open: boolean; canWork: boolean; onComplete: (f: FollowUp) => void; onLog: () => void }) {
  const sorted = [...fus].sort((a, b) => Number(!!a.doneAt) - Number(!!b.doneAt) || a.dueAt.localeCompare(b.dueAt));
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <Panel title="Timeline" actions={<Button size="sm" onClick={onLog}><MessageSquarePlus className="h-4 w-4" aria-hidden />Log activity</Button>} flush>
          {acts.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing logged yet.</p> : (
            <ol className="divide-y divide-border/70">
              {[...acts].sort((a, b) => b.at.localeCompare(a.at)).map((a) => (
                <li key={a.id} className="flex gap-3 px-4 py-3">
                  <Phone className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1"><p className="text-sm">{a.text}</p><p className="mt-0.5 text-xs text-muted-foreground">{personName(a.by)} · {fmtDateTime(a.at)}</p></div>
                  <span className="shrink-0 self-start">{a.internal ? <Chip>Internal note</Chip> : a.type === "client_response" ? <Chip tone="info">Client response</Chip> : <Chip>Activity</Chip>}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
      <div className="lg:col-span-2">
        <Panel title="Follow-ups" flush>
          <ul className="divide-y divide-border/70">
            {sorted.map((f) => (
              <li key={f.id} className="space-y-1.5 px-4 py-3">
                <p className="text-sm font-medium">{f.title}</p>
                <Deadline dueAt={f.dueAt} done={f.doneAt} />
                {f.doneAt && f.outcome ? <p className="text-xs text-muted-foreground">Outcome: {f.outcome}</p> : null}
                <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Details</summary><p className="mt-1">Created {fmtDateTime(f.createdAt)}{f.doneAt ? ` · Completed ${fmtDateTime(f.doneAt)}` : ""}</p></details>
                {!f.doneAt && open ? <Button size="sm" variant="outline" disabled={!canWork} onClick={() => onComplete(f)}><CheckCheck className="h-3.5 w-3.5" aria-hidden />Complete</Button> : null}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function versionBadges(p: ProposalVersion, all: ProposalVersion[]) {
  const latestDraft = [...all].filter((x) => x.status === "draft").sort((a, b) => b.version - a.version)[0];
  const latestSent = [...all].filter((x) => x.status === "sent" || x.status === "accepted").sort((a, b) => b.version - a.version)[0];
  return { latestDraft: latestDraft?.id === p.id, latestSent: latestSent?.id === p.id };
}
const STATUS_LABEL = { draft: "Draft", sent: "Sent", superseded: "Superseded", accepted: "Accepted" } as const;

function Proposals({ opp, props, setProps, approvals, setApprovals, canEdit, isFounder, notify, addHist }: {
  opp: Opportunity; props: ProposalVersion[]; setProps: (p: ProposalVersion[]) => void; approvals: ApprovalRecord[]; setApprovals: (a: ApprovalRecord[]) => void;
  canEdit: boolean; isFounder: boolean; notify: (m: string) => void; addHist: (w: string) => void;
}) {
  const { roleDef } = usePreview();
  const z = ZOHO.find((x) => x.oppId === opp.id) ?? null;
  const [mode, setMode] = useState<"file" | "link">("file");
  const [fileName, setFileName] = useState<{ name: string; kb: number } | null>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [changesFor, setChangesFor] = useState<ProposalVersion | null>(null);
  const [instruction, setInstruction] = useState("");
  const [instrErr, setInstrErr] = useState<string | null>(null);
  const versions = [...props].sort((a, b) => b.version - a.version);
  const latest = versions[0];
  const nextVersion = (latest?.version ?? 0) + 1;
  const policy = APPROVAL_POLICY[opp.company];
  const recFor = (v: number) => approvals.find((r) => r.version === v);

  function addVersion(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "file" && !fileName) { setErr("Choose a file."); return; }
    if (mode === "link" && !/^https?:\/\/\S+\.\S+/.test(url.trim())) { setErr("Paste a full link starting with https://"); return; }
    setErr(null);
    const base = { id: `np${props.length}`, oppId: opp.id, version: nextVersion, author: roleDef.person, date: TODAY, status: "draft" as const, note: note.trim() || "No note" };
    setProps([{ ...base, ...(mode === "file" ? { kind: "file" as const, fileName: fileName!.name, sizeKb: fileName!.kb } : { kind: "link" as const, url: url.trim() }) }, ...props]);
    addHist(`Proposal version ${nextVersion} added as a draft.`); setFileName(null); setUrl(""); setNote(""); notify(`Version ${nextVersion} added`);
  }
  function markSent(p: ProposalVersion) {
    setProps(props.map((x) => (x.id === p.id ? { ...x, status: "sent" as const, sentOn: TODAY } : x.status === "sent" ? { ...x, status: "superseded" as const } : x)));
    addHist(`Version ${p.version} recorded as sent.${policy.policy === "required" && recFor(p.version)?.state !== "approved" ? " No internal approval on record." : ""}`);
    notify(`Version ${p.version} recorded as sent`);
  }

  const policyChip =
    policy.policy === "not_configured" ? <Chip tone="warn">Approval requirements not configured</Chip>
    : policy.policy === "not_required" ? <Chip>No approval required</Chip>
    : <Chip tone="info">Approval required</Chip>;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel title="Versions" description="Built in Canva or ChatGPT; kept here as a file or a link." flush>
          {versions.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No proposal added yet.</p> : (
            <ul className="divide-y divide-border/70">
              {versions.map((p) => {
                const b = versionBadges(p, props);
                const rec = recFor(p.version);
                const sentWithoutApproval = (p.status === "sent" || p.status === "accepted") && policy.policy === "required" && rec?.state !== "approved";
                return (
                  <li key={p.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">{p.kind === "file" ? <FileText className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}Version {p.version}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {b.latestDraft ? <Chip tone="info">Latest draft</Chip> : null}{b.latestSent ? <Chip tone="good">Latest sent</Chip> : null}
                        <Chip tone={p.status === "superseded" ? "neutral" : p.status === "draft" ? "info" : "good"}>{STATUS_LABEL[p.status]}</Chip>
                      </div>
                    </div>
                    <p className="break-all text-sm">{p.kind === "file" ? `File: ${proposalSource(p)}${p.sizeKb ? ` (${(p.sizeKb / 1024).toFixed(1)} MB)` : ""}` : `Link: ${p.url ?? "none"}`}</p>
                    <p className="text-xs text-muted-foreground">{personName(p.author)} · added {fmtDate(p.date)}{p.sentOn ? ` · recorded as sent ${fmtDate(p.sentOn)}` : ""}</p>
                    <p className="text-sm">{p.note}</p>
                    {sentWithoutApproval ? <p className="text-xs"><Chip tone="warn">No internal approval on record</Chip> <span className="text-muted-foreground">Recording that it was sent is not an approval.</span></p> : null}
                    {p.status === "draft" && canEdit ? <Button size="sm" variant="outline" onClick={() => markSent(p)}>Record as sent</Button> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        {canEdit ? (
          <Panel title={`Add version ${nextVersion}`} help="Files and links are stored as given. A pasted link is only as private as its own sharing settings. Nothing is uploaded in this preview.">
            <form noValidate className="space-y-4" onSubmit={addVersion}>
              <fieldset className="flex flex-wrap gap-3"><legend className="sr-only">How to add it</legend>
                {([["file", "Upload file", Upload], ["link", "Add link", Link2]] as const).map(([v, l, Icon]) => (
                  <label key={v} className={cn("flex min-w-[9rem] cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium", mode === v ? "border-accent bg-accent/10" : "border-border")}><input type="radio" name="pv-mode" checked={mode === v} onChange={() => { setMode(v); setErr(null); }} /><Icon className="h-4 w-4" aria-hidden />{l}</label>
                ))}
              </fieldset>
              {mode === "file" ? (
                <Field label="File" htmlFor="pv-file" required error={err} hint="PDF, PowerPoint or Word. Choosing a file here does not upload it anywhere.">
                  <Input id="pv-file" type="file" accept=".pdf,.ppt,.pptx,.doc,.docx" onChange={(e) => { const f = e.target.files?.[0]; setFileName(f ? { name: f.name, kb: Math.round(f.size / 1024) } : null); }} />
                </Field>
              ) : (
                <Field label="Link" htmlFor="pv-url" required error={err} hint="From Canva, Drive or similar. Check its sharing settings yourself.">
                  <Input id="pv-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
                </Field>
              )}
              <Field label="What changed" htmlFor="pv-note"><Input id="pv-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">Planned access: only people with Sales access, with each download recorded. Not active in this preview.</p>
              <Button type="submit" size="sm">Add as draft</Button>
            </form>
          </Panel>
        ) : null}
      </div>

      <div className="space-y-6">
        <Panel title="Zoho Books references" help="Zoho Books is the source for quotes, invoices and payments. These references and dates are entered by hand. A quote sent, an invoice issued and a payment received are three separate facts.">
          <ol className="space-y-3 text-sm">
            <li><p className="font-medium">1. Quote sent</p><p className="text-xs text-muted-foreground">{z?.quoteRef ? `${z.quoteRef} · ${fmtDate(z.quoteSentOn)}` : "Not recorded"}</p></li>
            <li><p className="font-medium">2. Invoice issued</p><p className="text-xs text-muted-foreground">{z?.invoiceRef ? `${z.invoiceRef} · ${fmtDate(z.invoiceIssuedOn)}` : "Not recorded"}</p></li>
            <li><p className="font-medium">3. Customer payment received</p><p className="text-xs text-muted-foreground">{z?.paymentReceivedOn ? fmtDate(z.paymentReceivedOn) : "Not recorded"}</p></li>
          </ol>
        </Panel>
        <Panel title="Internal approval">
          <div className="space-y-3 text-sm">
            <div>{policyChip}</div>
            {policy.policy === "not_configured" ? <p className="text-muted-foreground">Ask a founder to set the rule for this company. Until then nothing here counts as approved.</p> : null}
            {policy.policy === "not_required" ? <p className="text-muted-foreground">{policy.note}</p> : null}
            {policy.policy === "required" ? (
              <ul className="space-y-2">
                {versions.map((p) => {
                  const rec = recFor(p.version);
                  return (
                    <li key={p.id} className="rounded-md border border-border p-2.5">
                      <p className="flex flex-wrap items-center gap-2 font-medium">Version {p.version}{" "}
                        {!rec ? <Chip tone="warn">No approval on record</Chip> : rec.state === "pending" ? <Chip tone="info">Pending approval</Chip> : rec.state === "approved" ? <Chip tone="good">Approved</Chip> : <Chip tone="warn">Changes requested</Chip>}
                      </p>
                      {rec ? <p className="mt-1 text-xs text-muted-foreground">Requested by {personName(rec.requestedBy)}, {fmtDateTime(rec.requestedAt)}{rec.decidedBy ? ` · Decided by ${personName(rec.decidedBy)}, ${fmtDateTime(rec.decidedAt!)}` : ""}</p> : null}
                      {rec?.instruction ? <p className="mt-1 text-sm">“{rec.instruction}”</p> : null}
                      {rec?.state === "approved" ? <p className="mt-1 text-xs text-muted-foreground">The approved version is locked. A change makes a new version that needs its own approval.</p> : null}
                      {!rec && canEdit && p.id === latest?.id ? <Button size="sm" variant="outline" className="mt-2" onClick={() => { setApprovals([...approvals, { oppId: opp.id, version: p.version, state: "pending", requestedBy: roleDef.person, requestedAt: NOW }]); addHist(`Approval requested for version ${p.version}.`); notify("Approval requested"); }}>Request approval</Button> : null}
                      {rec?.state === "changes_requested" && canEdit && p.id === latest?.id ? <Button size="sm" variant="outline" className="mt-2" onClick={() => { setApprovals([...approvals.filter((r) => r.version !== p.version), { oppId: opp.id, version: p.version, state: "pending", requestedBy: roleDef.person, requestedAt: NOW }]); notify("Approval requested again"); }}>Request approval again</Button> : null}
                      {rec?.state === "pending" && isFounder ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => { setApprovals(approvals.map((r) => (r === rec ? { ...r, state: "approved" as const, decidedBy: roleDef.person, decidedAt: NOW, instruction: "Approved." } : r))); addHist(`Version ${p.version} approved.`); notify("Approved"); }}>Approve</Button>
                          <Button size="sm" variant="outline" onClick={() => { setChangesFor(p); }}>Request changes</Button>
                        </div>
                      ) : null}
                      {rec?.state === "pending" && !isFounder ? <p className="mt-1 text-xs text-muted-foreground">Waiting for a founder.</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </Panel>
      </div>

      <Sheet open={!!changesFor} onClose={() => setChangesFor(null)} title="Request changes">
        <form noValidate className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (!instruction.trim()) { setInstrErr("Say what needs to change."); return; }
          const v = changesFor!.version;
          setApprovals(approvals.map((r) => (r.version === v ? { ...r, state: "changes_requested" as const, decidedBy: roleDef.person, decidedAt: NOW, instruction: instruction.trim() } : r)));
          addHist(`Changes requested on version ${v}.`); setInstruction(""); setInstrErr(null); setChangesFor(null); notify("Changes requested");
        }}>
          <Field label="What needs to change" htmlFor="ch-text" required error={instrErr}><Textarea id="ch-text" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setChangesFor(null)}>Cancel</Button><Button type="submit" size="sm">Send back</Button></div>
        </form>
      </Sheet>
    </div>
  );
}

function Confirmation({ opp, stage, canChange }: { opp: Opportunity; stage: StageId; canChange: boolean }) {
  const won = stage === "won";
  const steps = [
    { label: "Commercially won", done: won, detail: won && opp.evidence ? `${opp.evidence.type}: ${opp.evidence.reference}, dated ${fmtDate(opp.evidence.date)}` : "Needs a purchase order or an authorised email." },
    { label: "Handover prepared", done: won && opp.handover === "prepared", detail: won && opp.handover === "prepared" ? "Prepared by the owner." : won ? "Not prepared yet." : "Available once the opportunity is won." },
    { label: "Accepted by the Project Manager", done: false, detail: "Comes in a later release." },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel title="Commercial confirmation" help="Winning needs a purchase order or an authorised email. Equipment availability does not count towards it.">
          <ol className="space-y-4">
            {steps.map((s, i) => (
              <li key={s.label} className="flex gap-3">
                {s.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-[hsl(var(--os-good))]" aria-hidden /> : <Circle className="mt-0.5 h-5 w-5 flex-none text-muted-foreground" aria-hidden />}
                <div><p className="text-sm font-medium">{i + 1}. {s.label} <span className="font-normal text-muted-foreground">· {s.done ? "Done" : "Not yet"}</span></p><p className="text-sm text-muted-foreground">{s.detail}</p></div>
              </li>
            ))}
          </ol>
          {stage === "lost" ? <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">Lost on {fmtDate(opp.closedAt)}. Reason: {opp.lostReason}.</p> : null}
        </Panel>
        <Panel title="Equipment availability"><AvailabilityChip o={opp} /><p className="mt-2 text-sm text-muted-foreground">{availabilityDetail(opp)}</p></Panel>
      </div>
      <Panel title="Actions">
        <div className="space-y-2">
          {won ? <PLink href={`/os-preview/sales/opportunities/${opp.ref}/handover`} className={cn(buttonVariants({ size: "sm" }), "w-full")}>{opp.handover === "prepared" ? "Open handover package" : "Prepare handover package"}</PLink> : null}
          {!won && stage !== "lost" && canChange ? <PLink href={`/os-preview/sales/opportunities/${opp.ref}/close`} className={cn(buttonVariants({ size: "sm" }), "w-full")}>Mark Won or Lost</PLink> : null}
          {!won && stage !== "lost" && !canChange ? <Restriction>Only the owner or a founder can close this opportunity.</Restriction> : null}
          {won || stage === "lost" ? <p className="text-xs text-muted-foreground">Reopening or correcting a closed opportunity is limited to the owner or a founder, and is recorded.</p> : null}
        </div>
      </Panel>
    </div>
  );
}

function HistoryTab({ hist }: { hist: HistoryEntry[] }) {
  return (
    <Panel title="History" flush>
      <ol className="divide-y divide-border/70">
        {[...hist].sort((a, b) => b.at.localeCompare(a.at)).map((h, i) => (
          <li key={i} className="flex gap-3 px-4 py-3"><History className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden /><div><p className="text-sm">{h.what}</p><p className="text-xs text-muted-foreground">{personName(h.by)} · {fmtDateTime(h.at)}</p></div></li>
        ))}
      </ol>
    </Panel>
  );
}
