"use client";

import { useState } from "react";
import { ArrowRightLeft, CheckCircle2, Circle, FileText, History, Phone, UserCog } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ACTIVITIES, FOLLOWUPS, HISTORY, NOW, PROPOSALS, SALES_USERS, TODAY, ZOHO, contactById, fmtDate, fmtDateTime, orgById, personName, relDays, stageLabel, COMPANIES, money,
  type FollowUp, type Opportunity, type PersonId, type ProposalVersion, type StageId, type Activity, type HistoryEntry, oppByRef } from "../_lib/data";
import { PLink, usePreview } from "./context";
import { AvailabilityChip, Chip, DueChip, Field, PageHeader, Panel, Restriction, StageChip, Tabs, availabilityDetail, useNotice, Sheet } from "./ui";
import { ClientLine, useOppRights } from "./sales-bits";
import { MoveDialog, type MoveResult } from "./move-dialog";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "scope", label: "Scope & Dates" },
  { id: "activities", label: "Activities" },
  { id: "proposals", label: "Proposals & Quotes" },
  { id: "confirmation", label: "Confirmation & Handover" },
  { id: "history", label: "History" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>;
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
  const [hist, setHist] = useState<HistoryEntry[]>(HISTORY[opp.id] ?? [{ at: `${opp.createdAt}T09:00`, by: opp.createdBy, what: `Created enquiry (source: ${opp.source}). Owner set to ${personName(opp.createdBy)} (creator).` }]);
  const [dates, setDates] = useState({ install: opp.installStart ?? "", start: opp.eventStart ?? "", end: opp.eventEnd ?? "" });
  const [invalidated, setInvalidated] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [reassign, setReassign] = useState(false);
  const [newOwner, setNewOwner] = useState<PersonId>(SALES_USERS.find((p) => p !== opp.owner)!);
  const [reassignWhy, setReassignWhy] = useState("");
  const [reassignErr, setReassignErr] = useState<string | null>(null);

  const open = stage !== "won" && stage !== "lost";
  const openFus = fus.filter((f) => !f.doneAt).sort((a, b) => a.due.localeCompare(b.due));
  const next = openFus[0] ?? null;
  const availability = invalidated ? ({ state: "unverified" } as const) : opp.availability;
  const addHist = (what: string) => setHist((h) => [{ at: NOW, by: roleDef.person, what }, ...h]);

  function onMoved(r: MoveResult) {
    setStage(r.stage);
    if (r.stage === "on_hold") setHold({ reason: r.holdReason, review: r.holdReview });
    if (r.nextAction) setFus((f) => [...f, { id: `n${f.length}`, oppId: opp.id, owner, title: r.nextAction!, due: r.nextDate!, scheduledAt: NOW, kind: "other" }]);
    addHist(`Stage ${stageLabel(stage)} → ${stageLabel(r.stage)}.${r.holdReason ? ` Reason: ${r.holdReason}. Review ${r.holdReview}.` : ""}`);
    notify(`Moved to ${stageLabel(r.stage)}`);
  }

  return (
    <>
      <PageHeader
        eyebrow={`${opp.ref} · ${COMPANIES[opp.company].name.replace(" (sample entity)", "")}`}
        title={opp.title}
        description={undefined}
        actions={
          <>
            {rights.canChange && open ? <Button size="sm" variant="outline" onClick={() => setMoving(true)}><ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />Change stage</Button> : null}
            {rights.canChange && open ? <PLink href={`/os-preview/sales/opportunities/${opp.ref}/close`} className={cn(buttonVariants({ size: "sm" }))}>Mark Won or Lost</PLink> : null}
            {rights.canAssign && open ? <Button size="sm" variant="outline" onClick={() => setReassign(true)}><UserCog className="h-3.5 w-3.5" aria-hidden />Reassign owner</Button> : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StageChip stage={stage} />
        {stage === "on_hold" ? <Chip tone="warn">Review {fmtDate(hold.review)}</Chip> : null}
        {opp.waiting === "client" && open && stage !== "on_hold" ? <Chip>Waiting for client</Chip> : null}
        <AvailabilityChip a={availability} />
        <span className="text-sm text-muted-foreground">Owner <strong className="text-foreground">{personName(owner)}</strong></span>
      </div>
      {!rights.canChange && open ? <div className="mb-4"><Restriction>{rights.reason}</Restriction></div> : null}

      {open && !next ? (
        <div role="alert" className="mb-4 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-foreground">This opportunity has no next action. Add one under Activities so it does not get forgotten.</div>
      ) : null}

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Opportunity sections" />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-5">
        {tab === "overview" ? <Overview opp={opp} owner={owner} stage={stage} next={next} availability={availability} /> : null}
        {tab === "scope" ? (
          <Scope opp={opp} dates={dates} setDates={setDates} canEdit={rights.canChange && open} availability={availability} invalidated={invalidated}
            onSave={() => {
              const changed = dates.install !== (opp.installStart ?? "") || dates.start !== (opp.eventStart ?? "") || dates.end !== (opp.eventEnd ?? "");
              if (changed && opp.availability.state === "confirmed" && !invalidated) {
                setInvalidated(NOW);
                addHist("Event dates changed. Earlier availability confirmation invalidated and must be re-confirmed.");
                notify("Dates saved. The earlier availability confirmation no longer applies.");
              } else { addHist("Scope and dates updated."); notify("Dates saved"); }
            }} />
        ) : null}
        {tab === "activities" ? <Activities opp={opp} open={open} owner={owner} acts={acts} setActs={setActs} fus={fus} setFus={setFus} next={next} notify={notify} addHist={addHist} /> : null}
        {tab === "proposals" ? <Proposals opp={opp} props={props} setProps={setProps} canEdit={rights.canChange && open} notify={notify} addHist={addHist} /> : null}
        {tab === "confirmation" ? <Confirmation opp={opp} stage={stage} canChange={rights.canChange} /> : null}
        {tab === "history" ? <HistoryTab hist={hist} /> : null}
      </div>

      {moving ? <MoveDialog key={stage} opp={opp} stage={stage} open onClose={() => setMoving(false)} onMoved={onMoved} /> : null}
      <Sheet open={reassign} onClose={() => setReassign(false)} title="Reassign owner">
        <form noValidate className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (!reassignWhy.trim()) { setReassignErr("Give a reason. It is kept in the history."); return; }
          addHist(`Owner changed from ${personName(owner)} to ${personName(newOwner)} by ${personName(roleDef.person)}. Reason: ${reassignWhy.trim()}`);
          setOwner(newOwner); setReassign(false); setReassignWhy(""); setReassignErr(null); notify(`Owner is now ${personName(newOwner)}`);
        }}>
          <p className="text-sm text-muted-foreground">Only Juzar and Rafi can assign or reassign owners. HR, Finance and technical-admin roles cannot.</p>
          <Field label="New owner" htmlFor="ra-owner" required><Select id="ra-owner" value={newOwner} onChange={(e) => setNewOwner(e.target.value as PersonId)}>{SALES_USERS.filter((p) => p !== owner).map((p) => <option key={p} value={p}>{personName(p)}</option>)}</Select></Field>
          <Field label="Reason" htmlFor="ra-why" required error={reassignErr}><Textarea id="ra-why" rows={2} value={reassignWhy} onChange={(e) => setReassignWhy(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setReassign(false)}>Cancel</Button><Button type="submit" size="sm">Reassign</Button></div>
        </form>
      </Sheet>
      {node}
    </>
  );
}

function Overview({ opp, owner, stage, next, availability }: { opp: Opportunity; owner: PersonId; stage: StageId; next: FollowUp | null; availability: Opportunity["availability"] }) {
  const firstResp = opp.firstResponseAt ? `${Math.max(0, Math.round((Date.parse(opp.firstResponseAt) - Date.parse(`${opp.createdAt}T09:00`)) / 3600000))} h after the enquiry was logged` : "No first response recorded yet";
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel title="Brief"><p className="text-sm">{opp.brief}</p></Panel>
        <Panel title="Who is involved" description="The agency and the end client are separate relationships.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agency</h3><p className="mt-1 text-sm font-medium">{opp.agencyId ? orgById(opp.agencyId).name : "No agency (direct client)"}</p></div>
            <div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">End client</h3><p className="mt-1 text-sm font-medium">{opp.endClientId ? orgById(opp.endClientId).name : "Not recorded"}</p></div>
          </div>
          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacts on this opportunity</h3>
          {opp.contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts linked yet.</p> : (
            <ul className="divide-y divide-border/70">
              {opp.contacts.map((c) => { const ct = contactById(c.contactId); return (
                <li key={c.contactId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><strong>{ct.name}</strong> <span className="text-muted-foreground">· {ct.role} at {orgById(ct.orgId).name}</span></span><Chip>{c.role}</Chip></li>
              ); })}
            </ul>
          )}
        </Panel>
      </div>
      <div className="space-y-6">
        <Panel title="Next action">
          {next ? (<><p className="text-sm font-medium">{next.title}</p><p className="mt-1 text-xs text-muted-foreground">Scheduled {fmtDateTime(next.scheduledAt)} · due {fmtDate(next.due)}</p><div className="mt-2"><DueChip due={next.due} /></div></>) : <p className="text-sm text-muted-foreground">{stage === "won" || stage === "lost" ? "Closed. No next action." : "None set."}</p>}
        </Panel>
        <Panel title="Key facts">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Value">{money(opp.value, opp.currency)}</Fact>
            <Fact label="Currency">{opp.currency} <span className="text-muted-foreground">({COMPANIES[opp.company].name.replace(" (sample entity)", "")})</span></Fact>
            <Fact label="Budget as stated">{opp.budgetNote ?? "Not known"}</Fact>
            <Fact label="Source">{opp.source}</Fact>
            <Fact label="Owner">{personName(owner)}</Fact>
            <Fact label="Created">{fmtDate(opp.createdAt)} by {personName(opp.createdBy)}</Fact>
            <Fact label="First response">{firstResp}</Fact>
            <Fact label="Client">{<ClientLine o={opp} />}</Fact>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{availabilityDetail(availability)}</p>
        </Panel>
      </div>
    </div>
  );
}

function Scope({ opp, dates, setDates, canEdit, availability, invalidated, onSave }: {
  opp: Opportunity; dates: { install: string; start: string; end: string }; setDates: (d: { install: string; start: string; end: string }) => void;
  canEdit: boolean; availability: Opportunity["availability"]; invalidated: string | null; onSave: () => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel title="Scope"><p className="text-sm">{opp.scope}</p><h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exclusions</h3><p className="mt-1 text-sm">{opp.exclusions}</p>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Technologies requested</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">{opp.technologies.map((t) => <Chip key={t}>{t}</Chip>)}</div>
        </Panel>
        <Panel title="Dates and place" description="Leave blank while unknown.">
          <form className="grid gap-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
            <Field label="Install starts" htmlFor="d-install"><Input id="d-install" type="date" disabled={!canEdit} value={dates.install} onChange={(e) => setDates({ ...dates, install: e.target.value })} /></Field>
            <Field label="Event starts" htmlFor="d-start"><Input id="d-start" type="date" disabled={!canEdit} value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} /></Field>
            <Field label="Event ends" htmlFor="d-end"><Input id="d-end" type="date" disabled={!canEdit} value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })} /></Field>
            <div className="sm:col-span-3 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Location: {opp.location ?? "Not recorded"}</p>{canEdit ? <Button type="submit" size="sm">Save dates</Button> : <span className="text-xs text-muted-foreground">Read only for you</span>}</div>
          </form>
        </Panel>
      </div>
      <Panel title="Technology availability" description="Sales checks technology-level availability. There is no stock calendar here.">
        <AvailabilityChip a={availability} />
        <p className="mt-2 text-sm">{invalidated ? "The dates changed after the last confirmation, so it no longer applies. It needs to be confirmed again." : availabilityDetail(availability)}</p>
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          <li>Material changes (dates, quantities, location, technology) invalidate an earlier confirmation.</li>
          <li>Who may confirm availability is still to be decided.</li>
        </ul>
        {canEdit ? <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled>Request confirmation</Button><span className="self-center text-[11px] text-muted-foreground">Shown for design only</span></div> : null}
      </Panel>
    </div>
  );
}

function Activities({ opp, open, owner, acts, setActs, fus, setFus, next, notify, addHist }: {
  opp: Opportunity; open: boolean; owner: PersonId; acts: Activity[]; setActs: (a: Activity[]) => void; fus: FollowUp[]; setFus: (f: FollowUp[]) => void; next: FollowUp | null;
  notify: (m: string) => void; addHist: (w: string) => void;
}) {
  const { roleDef } = usePreview();
  const [kind, setKind] = useState<"internal" | "client">("internal");
  const [type, setType] = useState<Activity["type"]>("note");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [nxt, setNxt] = useState({ title: "", due: "" });
  const [nxtErr, setNxtErr] = useState<string | null>(null);

  const allFus = [...fus].sort((a, b) => a.due.localeCompare(b.due));
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <Panel title="Record an activity" description="Anyone with Sales access can add to the timeline.">
          <form noValidate className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) { setErr("Write what happened."); return; }
            setErr(null);
            setActs([{ id: `new-${acts.length}`, oppId: opp.id, type: kind === "client" ? "client_response" : type, at: NOW, by: roleDef.person, text: text.trim(), internal: kind === "internal" }, ...acts]);
            addHist(`${kind === "client" ? "Client response" : "Activity"} recorded.`);
            setText(""); notify("Activity recorded");
          }}>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">What kind of entry is this</legend>
              <label className="flex items-center gap-2"><input type="radio" name="kind" checked={kind === "internal"} onChange={() => setKind("internal")} />Internal note (never shown to the client)</label>
              <label className="flex items-center gap-2"><input type="radio" name="kind" checked={kind === "client"} onChange={() => setKind("client")} />Recorded client response</label>
            </fieldset>
            {kind === "internal" ? <Field label="Type" htmlFor="ac-type"><Select id="ac-type" value={type} onChange={(e) => setType(e.target.value as Activity["type"])}><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option></Select></Field> : null}
            <Field label={kind === "client" ? "What the client said or sent" : "Note"} htmlFor="ac-text" required error={err}><Textarea id="ac-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
            <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">If a reminder email fails to send, this entry is still saved and the failure is shown here.</p><Button type="submit" size="sm">Save entry</Button></div>
          </form>
        </Panel>
        <Panel title="Timeline" flush>
          {acts.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No activity recorded yet.</p> : (
            <ol className="divide-y divide-border/70">
              {[...acts].sort((a, b) => b.at.localeCompare(a.at)).map((a) => (
                <li key={a.id} className="flex gap-3 px-4 py-3">
                  <Phone className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                  <div className="min-w-[12rem] flex-1"><p className="text-sm">{a.text}</p><p className="mt-0.5 text-xs text-muted-foreground">{personName(a.by)} · {fmtDateTime(a.at)}</p></div>
                  {a.internal ? <Chip>Internal note</Chip> : a.type === "client_response" ? <Chip tone="info">Client response</Chip> : <Chip tone="neutral">Recorded activity</Chip>}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
      <div className="space-y-6 lg:col-span-2">
        <Panel title="Follow-ups" description="Scheduled and completed times are both kept." flush>
          <ul className="divide-y divide-border/70">
            {allFus.map((f) => (
              <li key={f.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{f.title}</p><DueChip due={f.due} done={f.doneAt} /></div>
                <p className="mt-0.5 text-xs text-muted-foreground">Scheduled {fmtDateTime(f.scheduledAt)} · due {fmtDate(f.due)}{f.doneAt ? ` · completed ${fmtDateTime(f.doneAt)}` : ""}</p>
                {!f.doneAt && open ? <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => { setFus(fus.map((x) => (x.id === f.id ? { ...x, doneAt: NOW } : x))); addHist(`Follow-up “${f.title}” completed.`); notify("Follow-up marked done"); }}>Mark done</Button> : null}
              </li>
            ))}
          </ul>
        </Panel>
        {open && !next ? (
          <Panel title="Set the next action">
            <form noValidate className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              if (!nxt.title.trim() || !nxt.due) { setNxtErr("Enter the action and its date."); return; }
              setNxtErr(null); setFus([...fus, { id: `n${fus.length}`, oppId: opp.id, owner, title: nxt.title.trim(), due: nxt.due, scheduledAt: NOW, kind: "other" }]); setNxt({ title: "", due: "" }); notify("Next action set");
            }}>
              <Field label="Next action" htmlFor="nx-title" required><Input id="nx-title" value={nxt.title} onChange={(e) => setNxt({ ...nxt, title: e.target.value })} /></Field>
              <Field label="Date" htmlFor="nx-due" required error={nxtErr}><Input id="nx-due" type="date" value={nxt.due} onChange={(e) => setNxt({ ...nxt, due: e.target.value })} /></Field>
              <Button type="submit" size="sm">Save next action</Button>
            </form>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function Proposals({ opp, props, setProps, canEdit, notify, addHist }: { opp: Opportunity; props: ProposalVersion[]; setProps: (p: ProposalVersion[]) => void; canEdit: boolean; notify: (m: string) => void; addHist: (w: string) => void }) {
  const { roleDef } = usePreview();
  const z = ZOHO.find((x) => x.oppId === opp.id) ?? null;
  const [file, setFile] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const versions = [...props].sort((a, b) => b.version - a.version);
  const latest = versions[0]?.version ?? 0;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Panel title="Proposal versions" description="Proposals are built in Canva or ChatGPT outside the app. Here we keep the version, author, date, status and a secure file or link." flush>
          {versions.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No proposal recorded yet.</p> : (
            <ul className="divide-y divide-border/70">
              {versions.map((p) => (
                <li key={p.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium"><FileText className="mr-1 inline h-3.5 w-3.5" aria-hidden />Version {p.version}</p><Chip tone={p.status === "sent" ? "info" : p.status === "accepted" ? "good" : "neutral"}>{p.status === "sent" ? "Sent" : p.status === "accepted" ? "Accepted" : p.status === "draft" ? "Draft" : "Superseded"}</Chip></div>
                  <p className="text-xs text-muted-foreground">{personName(p.author)} · {fmtDate(p.date)} · {p.file}</p>
                  <p className="mt-0.5 text-sm">{p.note}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {canEdit ? (
          <Panel title="Record a new version">
            <form noValidate className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              if (!file.trim()) { setErr("Add the secure link or file name."); return; }
              setErr(null);
              setProps([{ id: `np${props.length}`, oppId: opp.id, version: latest + 1, author: roleDef.person, date: TODAY, status: "draft", file: file.trim(), note: note.trim() || "No note" }, ...props.map((p) => (p.status === "sent" ? { ...p, status: "superseded" as const } : p))]);
              addHist(`Proposal version ${latest + 1} recorded as draft.`); setFile(""); setNote(""); notify(`Version ${latest + 1} recorded`);
            }}>
              <Field label="Secure link or file" htmlFor="pv-file" required error={err}><Input id="pv-file" value={file} onChange={(e) => setFile(e.target.value)} placeholder="Link to the PDF in secure storage" /></Field>
              <Field label="What changed" htmlFor="pv-note"><Input id="pv-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <Button type="submit" size="sm">Record version {latest + 1}</Button>
            </form>
          </Panel>
        ) : null}
      </div>
      <div className="space-y-6">
        <Panel title="Zoho Books references" description="Zoho Books stays the source for quotes, invoices and payments. These are references with dates entered by hand.">
          <ol className="space-y-3 text-sm">
            <li><p className="font-medium">1. Quotation sent</p><p className="text-xs text-muted-foreground">{z?.quoteRef ? `${z.quoteRef} · ${fmtDate(z.quoteSentOn)}` : "Not recorded"}</p></li>
            <li><p className="font-medium">2. Invoice issued</p><p className="text-xs text-muted-foreground">{z?.invoiceRef ? `${z.invoiceRef} · ${fmtDate(z.invoiceIssuedOn)}` : "Not recorded"}</p></li>
            <li><p className="font-medium">3. Payment received</p><p className="text-xs text-muted-foreground">{z?.paymentReceivedOn ? fmtDate(z.paymentReceivedOn) : "Not recorded"}</p></li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">A quotation sent is not an invoice issued, and neither is a payment received.</p>
        </Panel>
        <Panel title="Internal commercial approval">
          {opp.id === "45" ? (
            <div className="space-y-1.5 text-sm"><Chip tone="good">Approved · version 3 locked</Chip><p className="text-xs text-muted-foreground">Requested by Daniel Okafor on 12 Oct 2026. Approver instruction: “Hold margin; no discount beyond what is in version 3.” Decided 14 Oct 2026.</p><p className="text-xs text-muted-foreground">Changing the price creates a new version that needs a new approval. Approved pricing is never edited silently.</p></div>
          ) : (
            <p className="text-sm text-muted-foreground">No approval rule is configured, so none is required. When a rule exists (value thresholds, who approves) it is set in Sales settings by the founders.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Confirmation({ opp, stage, canChange }: { opp: Opportunity; stage: StageId; canChange: boolean }) {
  const won = stage === "won";
  const steps = [
    { label: "Commercially won", done: won, detail: won && opp.evidence ? `${opp.evidence.type}: ${opp.evidence.reference}, dated ${fmtDate(opp.evidence.date)}` : "Needs a purchase order or an authorised email as evidence." },
    { label: "Handover prepared", done: won && opp.handover === "prepared", detail: won && opp.handover === "prepared" ? "Package prepared by the owner." : won ? "Not prepared yet." : "Available after the opportunity is won." },
    { label: "Accepted by the Project Manager", done: false, detail: "A later release. Until then the package is the record; no project is created." },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Panel title="Where this stands" className="lg:col-span-2">
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={s.label} className="flex gap-3">
              {s.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-[hsl(var(--os-good))]" aria-hidden /> : <Circle className="mt-0.5 h-5 w-5 flex-none text-muted-foreground" aria-hidden />}
              <div><p className="text-sm font-medium">{i + 1}. {s.label} <span className="font-normal text-muted-foreground">· {s.done ? "Done" : "Not yet"}</span></p><p className="text-sm text-muted-foreground">{s.detail}</p></div>
            </li>
          ))}
        </ol>
        {stage === "lost" ? <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-[hsl(var(--os-bad))]">Lost on {fmtDate(opp.closedAt)}. Reason: {opp.lostReason}.</p> : null}
      </Panel>
      <Panel title="Actions">
        <div className="space-y-2">
          {won ? <PLink href={`/os-preview/sales/opportunities/${opp.ref}/handover`} className={cn(buttonVariants({ size: "sm" }), "w-full")}>{opp.handover === "prepared" ? "Open handover package" : "Prepare handover package"}</PLink> : null}
          {(stage !== "won" && stage !== "lost") && canChange ? <PLink href={`/os-preview/sales/opportunities/${opp.ref}/close`} className={cn(buttonVariants({ size: "sm" }), "w-full")}>Mark Won or Lost</PLink> : null}
          {(stage !== "won" && stage !== "lost") && !canChange ? <Restriction>Only the owner or a founder can close this opportunity.</Restriction> : null}
          {(stage === "won" || stage === "lost") ? <p className="text-xs text-muted-foreground">Reopening or correcting a closed opportunity is audited and limited to the owner or a founder.</p> : null}
        </div>
      </Panel>
    </div>
  );
}

function HistoryTab({ hist }: { hist: HistoryEntry[] }) {
  return (
    <Panel title="History" description="Every change is kept. Nothing here can be edited." flush>
      <ol className="divide-y divide-border/70">
        {[...hist].sort((a, b) => b.at.localeCompare(a.at)).map((h, i) => (
          <li key={i} className="flex gap-3 px-4 py-3"><History className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden /><div><p className="text-sm">{h.what}</p><p className="text-xs text-muted-foreground">{personName(h.by)} · {fmtDateTime(h.at)} · {relDays(h.at)}</p></div></li>
        ))}
      </ol>
    </Panel>
  );
}
