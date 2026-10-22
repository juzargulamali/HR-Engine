"use client";

import { useEffect, useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChanges } from "@/components/workspace/unsaved";
import { draftFromCandidate, unitProblemFor, type Candidate, type FormContext, type FormLocation, type FormTransfer } from "@/lib/inventory/stock-candidates";
import {
  ADJUST_WORDS, KIND_CONFIG, formatInZone, localToUtcIso, nowLocalInput, parseLines, sourceFor, summaryRows, validateInput,
  type AdjustAction, type LineDraft, type MovementInput, type MovementKind, type ReturnFrom, type SummaryInput,
} from "@/lib/inventory/stock-movements";
import { LinesEditor, type HeldSource } from "./lines-editor";
import { DonePanel, ReviewPanel } from "./movement-review";
import type { MovementServices } from "./movement-services";
import { EmployeePicker, ProjectSelect, RequestSelect, type PickedEmployee } from "./pickers";
import { useMovementFlow } from "./use-movement-flow";

export interface MovementInitial {
  locationId?: string;
  employee?: PickedEmployee;
  projectId?: string;
  requestId?: string;
  candidates?: readonly Candidate[];
  transferId?: string;
  adjustAction?: AdjustAction;
  kitUnitId?: string;
  kitLabel?: string;
  rentalId?: string;
  returnFrom?: ReturnFrom;
  repairReference?: string;
  /** Words put in the search box when the form opens. */
  search?: string;
}

export interface MovementFormProps {
  kind: MovementKind;
  services: MovementServices;
  context: FormContext;
  initial?: MovementInitial;
  onClose?: () => void;
  /** Called once a movement has been recorded (the page refreshes what it shows). */
  onRecorded?: () => void;
  /** Overrides the heading (the unit panel names the thing). */
  title?: string;
}

const DISPATCHABLE = (status: string) => !["completed", "archived", "on_hold"].includes(status);

/**
 * One form for every movement of stock: receive, issue, dispatch, return, transfer and the specialist ones. Always the same three steps:
 * fill in -> review (a summary of what, how much, from, to, who and when) -> Confirm. The Confirm button sends ONE request with the key made
 * when the form opened. See useMovementFlow for what happens after a failure.
 */
export function MovementForm({ kind, services, context, initial, onClose, onRecorded, title }: MovementFormProps) {
  const cfg = KIND_CONFIG[kind];
  const uid = useId();
  const transfersHere = context.transfers;

  // ---- what the person chose -------------------------------------------------------------------------------------
  const firstTransfer = initial?.transferId ? transfersHere.find((t) => t.id === initial.transferId) : transfersHere.length === 1 ? transfersHere[0] : undefined;
  const [transferId, setTransferId] = useState(kind === "receive_transfer" ? (firstTransfer?.id ?? "") : "");
  const transfer: FormTransfer | undefined = transfersHere.find((t) => t.id === transferId);
  const [locationId, setLocationId] = useState(() => {
    if (kind === "receive_transfer") return firstTransfer?.toLocationId ?? "";
    const wanted = initial?.locationId && context.locations.some((l) => l.id === initial.locationId) ? initial.locationId : null;
    const fromUnit = initial?.candidates?.find((c) => c.locationId && context.locations.some((l) => l.id === c.locationId))?.locationId;
    return wanted ?? fromUnit ?? (context.locations.length === 1 ? context.locations[0]!.id : "");
  });
  const effectiveLocationId = kind === "receive_transfer" ? (transfer?.toLocationId ?? "") : locationId;
  const location: FormLocation | undefined = context.locations.find((l) => l.id === effectiveLocationId) ?? context.destinations.find((l) => l.id === effectiveLocationId);
  const projectKindFirst = context.projects[0];
  const companyId = location?.companyId ?? (kind === "project_transfer" ? (projectKindFirst?.companyId ?? context.locations[0]?.companyId ?? "") : "");
  const tz = location?.timezone ?? context.locations[0]?.timezone ?? "Asia/Dubai";
  const multiCompany = new Set(context.locations.map((l) => l.companyId)).size > 1;

  const [employee, setEmployee] = useState<PickedEmployee | null>(initial?.employee ?? null);
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [toProjectId, setToProjectId] = useState("");
  const [requestId, setRequestId] = useState(initial?.requestId ?? "");
  const [returnFrom, setReturnFrom] = useState<ReturnFrom | "">(initial?.returnFrom ?? "");
  const [usedBy, setUsedBy] = useState<"" | "employee" | "project">(initial?.employee ? "employee" : initial?.projectId ? "project" : "");
  const [toLocationId, setToLocationId] = useState("");
  const [carrier, setCarrier] = useState("");
  const [reference, setReference] = useState("");
  const [expectedReturn, setExpectedReturn] = useState("");
  const [expectedArrival, setExpectedArrival] = useState("");
  const [repairReference, setRepairReference] = useState(initial?.repairReference ?? "");
  const [reason, setReason] = useState("");
  const [adjustAction, setAdjustAction] = useState<AdjustAction>(initial?.adjustAction ?? "missing");
  const [note, setNote] = useState("");
  const [isRental, setIsRental] = useState(false);
  const [rentalSupplier, setRentalSupplier] = useState("");
  const [rentalRef, setRentalRef] = useState("");
  const [rentalDeadline, setRentalDeadline] = useState("");
  const [rentalProjectId, setRentalProjectId] = useState("");
  const [rentalId, setRentalId] = useState(initial?.rentalId ?? "");
  const [receiveAll, setReceiveAll] = useState(true);
  const [currency, setCurrency] = useState("AED");

  // ---- the list --------------------------------------------------------------------------------------------------
  const [start] = useState(() => {
    const drafts: LineDraft[] = [];
    const skipped: string[] = [];
    for (const c of initial?.candidates ?? []) {
      const why = unitProblemFor(kind, c, initial?.adjustAction);
      if (why) { skipped.push(why); continue; }
      if (drafts.some((d) => (c.unitId && d.unitId === c.unitId) || (!c.unitId && d.itemId === c.itemId && d.binId === (c.binId ?? "")))) continue;
      drafts.push(draftFromCandidate(c, kind, `i${drafts.length + 1}`));
    }
    return { drafts, skipped };
  });
  const [drafts, setDrafts] = useState<LineDraft[]>(start.drafts);
  const [problem, setProblem] = useState<string | null>(null);
  const [lineError, setLineError] = useState<{ id: string; message: string } | null>(null);

  // Returns and project moves start from what the holder has.
  const [heldList, setHeldList] = useState<{ key: string; candidates: Candidate[]; error: string | null } | null>(null);
  const holderKey = kind === "return" ? (returnFrom === "employee" && employee ? `e:${employee.id}` : returnFrom === "project" && projectId ? `p:${projectId}` : "") : kind === "project_transfer" && projectId ? `p:${projectId}` : "";
  useEffect(() => {
    if (!holderKey || !companyId) return;
    let cancelled = false;
    const [type, id] = holderKey.split(":");
    services.held({ companyId, employeeId: type === "e" ? id : null, projectId: type === "p" ? id : null })
      .then((r) => { if (!cancelled) setHeldList({ key: holderKey, candidates: r.candidates, error: r.error }); })
      .catch(() => { if (!cancelled) setHeldList({ key: holderKey, candidates: [], error: "What they hold could not be loaded. Try again." }); });
    return () => { cancelled = true; };
  }, [holderKey, companyId, services]);
  const heldLoaded = heldList && heldList.key === holderKey ? heldList : null;

  const flow = useMovementFlow(services, companyId, kind);
  const locked = flow.uncertain && flow.phase !== "done";
  const dirty = drafts.length > 0 || note.trim() !== "" || reason.trim() !== "";
  useUnsavedChanges(uid, dirty && flow.phase !== "done");

  const eligibleProjects = context.projects.filter((p) => p.companyId === companyId && (kind === "dispatch" ? DISPATCHABLE(p.status) : true));
  const destProjects = eligibleProjects.filter((p) => DISPATCHABLE(p.status));
  const requestsFor = (pid: string, empId: string | undefined, kindOfRequest: "project" | "employee") =>
    context.requests.filter((r) => r.companyId === companyId && r.kind === kindOfRequest && (kindOfRequest === "project" ? r.projectId === pid : empId ? r.employeeId === empId : false));
  const chosenRequest = context.requests.find((r) => r.id === requestId);

  const destinations = context.destinations.filter((l) => l.companyId === companyId && l.id !== effectiveLocationId);
  const source = sourceFor(kind, adjustAction);

  const held: HeldSource | null = (() => {
    if (source === "held") {
      if (!holderKey) return null;
      return { candidates: heldLoaded?.candidates ?? [], loading: !heldLoaded, error: heldLoaded?.error ?? null, emptyText: kind === "return" ? (returnFrom === "project" ? "This project holds nothing that is recorded as dispatched to it." : "This employee holds nothing that is recorded as issued to them.") : "Nothing recorded on that project.", title: kind === "return" ? "What they are holding" : "What the project is holding" };
    }
    if (source === "transit") {
      if (!transfer || receiveAll) return null;
      return { candidates: transfer.held, loading: false, error: null, emptyText: "Nothing is on the way for this transfer any more.", title: `On the way (${transfer.code})` };
    }
    return null;
  })();

  /** A unit scanned or added in a return must be held by whoever is returning it. */
  const acceptHeld = (c: Candidate): string | null => {
    if (kind === "return") {
      if (c.type === "unit") {
        if (c.custody !== "employee" && c.custody !== "project") return `${c.code} is not out with an employee or on a project, so there is nothing to return.`;
        if (returnFrom === "employee" && employee && c.employeeId !== employee.id) return `${c.code} is not recorded with ${employee.name}.`;
        if (returnFrom === "project" && projectId && c.projectId !== projectId) return `${c.code} is not recorded on the chosen project.`;
        if (returnFrom === "employee" && c.custody === "project") return `${c.code} is on a project, not with an employee.`;
        if (returnFrom === "project" && c.custody === "employee") return `${c.code} is with an employee, not on a project.`;
      } else if (c.type === "counted" && !holderKey) return "Say who is returning it first.";
    }
    if (kind === "project_transfer") {
      if (c.type === "unit" && (c.custody !== "project" || (projectId && c.projectId !== projectId))) return `${c.code} is not recorded on the project it is moving from.`;
    }
    return null;
  };
  const onHolderFound = (c: Candidate) => {
    if (kind !== "return" || holderKey) return;
    if (c.custody === "employee" && c.employeeId) { setReturnFrom("employee"); setEmployee({ id: c.employeeId, name: c.employeeName ?? "Employee" }); }
    else if (c.custody === "project" && c.projectId) { setReturnFrom("project"); setProjectId(c.projectId); }
  };

  // ---- building the request --------------------------------------------------------------------------------------
  const toIso = (local: string): string | undefined => (local ? (localToUtcIso(local, tz) ?? undefined) : undefined);

  function prepare(key: string): { input: MovementInput } | { error: string; lineId?: string } {
    const needsLines = source !== "kit";
    const isEverything = (kind === "receive_transfer" && receiveAll) || kind === "unpack_kit";
    const parsed = needsLines && !isEverything ? parseLines(kind, drafts, { canSeeCosts: !!context.canSeeCostsByCompany[companyId], currency }) : ({ ok: true as const, lines: [] as MovementInput["lines"], units: 0, quantities: 0 });
    if (!parsed.ok) return { error: parsed.error, lineId: parsed.lineId };
    if (expectedReturn && !toIso(expectedReturn)) return { error: "The expected return is not a valid date and time" };
    if (expectedArrival && !toIso(expectedArrival)) return { error: "The expected arrival is not a valid date and time" };
    if (isRental && rentalDeadline && !toIso(rentalDeadline)) return { error: "The rental return deadline is not a valid date and time" };
    const expIso = toIso(expectedReturn);
    if (expIso && new Date(expIso).getTime() <= Date.now()) return { error: "The expected return must be in the future" };
    const arrIso = toIso(expectedArrival);
    if (arrIso && new Date(arrIso).getTime() <= Date.now()) return { error: "The expected arrival must be in the future" };
    const input: MovementInput = {
      kind, companyId, key, locationId: kind === "project_transfer" ? null : effectiveLocationId || null, lines: parsed.lines, note: note.trim() || undefined,
      employeeId: (kind === "issue" || (kind === "return" && returnFrom === "employee") || ((kind === "consume" || kind === "return_unused") && usedBy === "employee")) ? employee?.id : undefined,
      projectId: (kind === "dispatch" || kind === "project_transfer" || (kind === "return" && returnFrom === "project") || ((kind === "consume" || kind === "return_unused") && usedBy === "project")) ? (projectId || undefined) : undefined,
      toProjectId: kind === "project_transfer" ? (toProjectId || undefined) : undefined,
      requestId: requestId || undefined,
      expectedReturnAt: expIso,
      toLocationId: kind === "transfer" ? (toLocationId || undefined) : undefined,
      transferId: kind === "receive_transfer" ? (transferId || undefined) : undefined,
      carrier: kind === "transfer" ? carrier.trim() || undefined : undefined,
      reference: kind === "transfer" ? reference.trim() || undefined : undefined,
      expectedAt: kind === "transfer" ? arrIso : undefined,
      repairReference: kind === "repair_out" ? repairReference.trim() || undefined : undefined,
      reason: kind === "adjust" ? reason.trim() || undefined : undefined,
      adjustAction: kind === "adjust" ? adjustAction : undefined,
      kitUnitId: initial?.kitUnitId,
      rentalId: kind === "return_rental" ? (rentalId || undefined) : undefined,
      returnFrom: kind === "return" ? (returnFrom || undefined) : undefined,
      rental: kind === "receive" && isRental ? { supplierName: rentalSupplier, externalReference: rentalRef, returnDeadline: toIso(rentalDeadline) ?? "", projectId: rentalProjectId || undefined } : undefined,
    };
    const bad = validateInput(input);
    return bad ? { error: bad } : { input };
  }

  const names = {
    project: (id: string) => { const p = context.projects.find((x) => x.id === id); return p ? `${p.reference} ${p.name}` : undefined; },
  };
  const summary: SummaryInput = {
    kind, drafts, location: location?.name ?? "", toLocation: context.destinations.find((l) => l.id === toLocationId)?.name,
    employee: employee?.name, project: names.project(projectId), toProject: names.project(toProjectId), request: chosenRequest ? `${chosenRequest.code}${chosenRequest.title ? ` · ${chosenRequest.title}` : ""}` : undefined,
    returnFrom: returnFrom || undefined, expectedReturn: expectedReturn ? formatInZone(toIso(expectedReturn), tz) : chosenRequest?.expectedReturnAt && kind === "dispatch" ? `${formatInZone(chosenRequest.expectedReturnAt, tz)} (from the request)` : undefined,
    expectedArrival: expectedArrival ? formatInZone(toIso(expectedArrival), tz) : undefined, repairReference: repairReference.trim() || undefined, transferCode: transfer?.code,
    adjustAction: kind === "adjust" ? adjustAction : undefined, rentalSupplier: kind === "receive" && isRental ? rentalSupplier.trim() : kind === "return_rental" ? context.rentals.find((r) => r.id === rentalId)?.supplier : undefined,
    kit: initial?.kitLabel, note: note.trim() || undefined, reason: kind === "adjust" ? reason.trim() || undefined : undefined,
    everything: (kind === "receive_transfer" && receiveAll) || kind === "unpack_kit" || (cfg.linesOptional && drafts.length === 0),
    stillOutstanding: kind === "return" && heldLoaded ? heldLoaded.candidates.filter((c) => !drafts.some((d) => (c.unitId ? d.unitId === c.unitId : d.itemId === c.itemId && d.binId === (c.binId ?? "")))).length : undefined,
  };

  const onReview = (e: React.FormEvent) => {
    e.preventDefault();
    const res = prepare(flow.key);
    if ("error" in res) { setProblem(res.error); setLineError(res.lineId ? { id: res.lineId, message: res.error } : null); return; }
    setProblem(null);
    setLineError(null);
    flow.toReview();
  };

  const onConfirm = () => {
    const res = prepare(flow.key);
    if ("error" in res) { setProblem(res.error); flow.toEdit(); return; }
    void flow.confirm(() => res.input).then(() => undefined);
  };

  useEffect(() => { if (flow.phase === "done") onRecorded?.(); }, [flow.phase]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when it is recorded

  const heading = title ?? (kind === "adjust" ? ADJUST_WORDS[adjustAction].title : cfg.title);
  const confirmLabel = kind === "adjust" ? ADJUST_WORDS[adjustAction].confirm : cfg.confirm;

  const changeLocation = (id: string) => {
    if (id === locationId) return;
    const sameCompany = !id || !location || context.locations.find((l) => l.id === id)?.companyId === location.companyId;
    if (drafts.length > 0 && (source !== "catalogue" || !sameCompany)) { setDrafts([]); setProblem("The list was cleared because the location changed. Add the items again."); } else setProblem(null);
    setLocationId(id);
    setToLocationId("");
    if (!sameCompany) {
      // Another company has other employees, projects and requests.
      setRequestId("");
      setEmployee(null);
      setProjectId("");
    }
  };

  // ---- the three steps -------------------------------------------------------------------------------------------
  if (flow.phase === "done") {
    return <DonePanel flow={flow} onAnother={() => { setDrafts([]); setNote(""); setReason(""); setExpectedReturn(""); flow.startNew(); }} onClose={onClose} />;
  }
  if (flow.phase === "reviewing" || flow.phase === "sending") {
    return <ReviewPanel flow={flow} rows={summaryRows(summary)} confirmLabel={confirmLabel} onConfirm={onConfirm} />;
  }

  const noLocations = context.locations.length === 0;
  const needLocationField = kind !== "project_transfer" && kind !== "receive_transfer";
  const lineBins = location?.bins ?? [];
  return (
    <form onSubmit={onReview} className="space-y-5" aria-label={heading} data-step="edit" noValidate>
      <p className="text-sm text-muted-foreground">{cfg.lead}</p>
      {noLocations ? <Alert role="status">You are not set up to work at any location. Ask an Inventory founder to add a location to your access.</Alert> : null}
      {start.skipped.length > 0 ? <Alert variant="warning" role="status">Not added: {start.skipped.join(" ")}</Alert> : null}

      {kind === "receive_transfer" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-tr`} className="text-sm font-medium leading-none">Which transfer arrived?</label>
          <Select id={`${uid}-tr`} value={transferId} onChange={(e) => { setTransferId(e.target.value); setDrafts([]); setReceiveAll(true); }} disabled={locked}>
            <option value="">{transfersHere.length === 0 ? "No transfer is on its way to you" : "Choose a transfer…"}</option>
            {transfersHere.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.fromName} to {t.toName} · {t.held.length} line{t.held.length === 1 ? "" : "s"}</option>)}
          </Select>
          {transfer ? <p className="text-sm text-muted-foreground">Sent {formatInZone(transfer.dispatchedAt, tz)}{transfer.expectedAt ? `, expected ${formatInZone(transfer.expectedAt, tz)}` : ""}{transfer.carrier ? ` · ${transfer.carrier}` : ""}{transfer.reference ? ` · ref ${transfer.reference}` : ""}. It is not available at {transfer.toName} until you confirm it here.</p> : null}
        </div>
      ) : null}

      {needLocationField ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-loc`} className="text-sm font-medium leading-none">{cfg.locationLabel}</label>
          <Select id={`${uid}-loc`} value={locationId} onChange={(e) => changeLocation(e.target.value)} disabled={locked || noLocations} required>
            <option value="">Choose a location…</option>
            {context.locations.map((l) => <option key={l.id} value={l.id}>{l.name}{multiCompany ? ` · ${l.companyName}` : ""}</option>)}
          </Select>
        </div>
      ) : null}

      {kind === "adjust" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-act`} className="text-sm font-medium leading-none">What happened?</label>
          <Select id={`${uid}-act`} value={adjustAction} onChange={(e) => { setAdjustAction(e.target.value as AdjustAction); setDrafts([]); }} disabled={locked || !!initial?.adjustAction}>
            <option value="missing">It is missing</option>
            <option value="found">It was found</option>
            <option value="retire">Retire it (write off)</option>
          </Select>
        </div>
      ) : null}

      {kind === "return" ? (
        <fieldset className="space-y-2" disabled={locked}>
          <legend className="text-sm font-medium">Who is returning it?</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name={`${uid}-from`} checked={returnFrom === "employee"} onChange={() => { setReturnFrom("employee"); setDrafts([]); }} /> An employee</label>
            <label className="flex items-center gap-2"><input type="radio" name={`${uid}-from`} checked={returnFrom === "project"} onChange={() => { setReturnFrom("project"); setDrafts([]); }} /> A project</label>
          </div>
        </fieldset>
      ) : null}

      {(kind === "issue" || (kind === "return" && returnFrom === "employee") || (kind === "consume" && usedBy === "employee") || (kind === "return_unused" && usedBy === "employee")) ? (
        <EmployeePicker label={kind === "issue" ? "Who receives it?" : kind === "return" ? "Which employee?" : "Which employee?"} companyId={companyId} value={employee} onChange={(e) => { setEmployee(e); if (kind === "return") setDrafts([]); }} lookup={services.employees} disabled={locked} hint={kind === "issue" ? "Only active employees can receive equipment." : undefined} />
      ) : null}

      {(kind === "consume" || kind === "return_unused") ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-by`} className="text-sm font-medium leading-none">{kind === "consume" ? "Used by (optional)" : "Whose unused stock is it?"}</label>
          <Select id={`${uid}-by`} value={usedBy} onChange={(e) => { setUsedBy(e.target.value as "" | "employee" | "project"); setEmployee(null); setProjectId(""); setRequestId(""); }} disabled={locked}>
            {kind === "consume" ? <option value="">Not recorded</option> : <option value="">Choose…</option>}
            <option value="employee">An employee</option>
            <option value="project">A project</option>
          </Select>
        </div>
      ) : null}

      {(kind === "dispatch" || kind === "project_transfer" || (kind === "return" && returnFrom === "project") || ((kind === "consume" || kind === "return_unused") && usedBy === "project")) ? (
        <ProjectSelect label={kind === "project_transfer" ? "Moving from project" : kind === "return" ? "Which project?" : "Which project?"} projects={kind === "dispatch" || kind === "consume" ? eligibleProjects : context.projects.filter((p) => p.companyId === companyId)} value={projectId} onChange={(id) => { setProjectId(id); setRequestId(""); if (kind === "return" || kind === "project_transfer") setDrafts([]); }} disabled={locked} hint="Only projects you can see are listed." required />
      ) : null}

      {kind === "project_transfer" ? (
        <>
          <ProjectSelect label="Moving to project" projects={destProjects.filter((p) => p.id !== projectId)} value={toProjectId} onChange={(id) => { setToProjectId(id); setRequestId(""); }} disabled={locked} required />
          <RequestSelect label="Request of the project it is going to" requests={requestsFor(toProjectId, undefined, "project")} value={requestId} onChange={setRequestId} disabled={locked || !toProjectId} required hint="The destination project needs an open request, so the move matches what was asked for." />
        </>
      ) : null}

      {(kind === "dispatch" || (kind === "consume" && usedBy === "project")) && projectId ? (
        <RequestSelect label="Request (optional)" requests={requestsFor(projectId, undefined, "project")} value={requestId} onChange={setRequestId} disabled={locked} hint="Name the request so this matches what was reserved." />
      ) : null}
      {kind === "issue" && employee && requestsFor("", employee.id, "employee").length > 0 ? (
        <RequestSelect label="Request (optional)" requests={requestsFor("", employee.id, "employee")} value={requestId} onChange={setRequestId} disabled={locked} hint="Name the request so it is marked as issued." />
      ) : null}

      {kind === "transfer" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-to`} className="text-sm font-medium leading-none">Send to</label>
          <Select id={`${uid}-to`} value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} disabled={locked || !effectiveLocationId} required>
            <option value="">Choose the destination…</option>
            {destinations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <p className="text-sm text-muted-foreground">It will be in transit, and not available at the destination, until someone there records it as received.</p>
        </div>
      ) : null}

      {kind === "repair_out" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-rep`} className="text-sm font-medium leading-none">Repair reference</label>
          <Input id={`${uid}-rep`} value={repairReference} onChange={(e) => setRepairReference(e.target.value)} placeholder="The repairer or the job number" maxLength={200} disabled={locked} required />
        </div>
      ) : null}

      {kind === "return_rental" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-rt`} className="text-sm font-medium leading-none">Which rental?</label>
          <Select id={`${uid}-rt`} value={rentalId} onChange={(e) => { setRentalId(e.target.value); setDrafts([]); }} disabled={locked || !!initial?.rentalId} required>
            <option value="">Choose a rental…</option>
            {context.rentals.filter((r) => r.companyId === companyId || !companyId).map((r) => <option key={r.id} value={r.id}>{r.supplier} · ref {r.reference}</option>)}
          </Select>
        </div>
      ) : null}

      {source === "kit" ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Everything inside {initial?.kitLabel ?? "the kit"} goes back on the shelf at its location. The checklist lines show as missing again, and the history is kept.</p>
      ) : (kind === "receive_transfer" && !transfer) ? null : (
        <>
          {kind === "receive_transfer" && transfer ? (
            <fieldset className="space-y-2" disabled={locked}>
              <legend className="text-sm font-medium">What arrived?</legend>
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name={`${uid}-all`} checked={receiveAll} onChange={() => { setReceiveAll(true); setDrafts([]); }} /> Everything on the way ({transfer.held.length} line{transfer.held.length === 1 ? "" : "s"})</label>
                <label className="flex items-center gap-2"><input type="radio" name={`${uid}-all`} checked={!receiveAll} onChange={() => setReceiveAll(false)} /> Only some of it. The rest stays in transit.</label>
              </div>
              {receiveAll ? <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{transfer.held.map((c) => <li key={c.key}>{c.itemName}{c.code ? ` (${c.code})` : ""}{c.qty !== null ? `, ${c.qty} ${c.uom === "each" ? "" : c.uom}`.trimEnd() : ""}</li>)}</ul> : null}
            </fieldset>
          ) : null}
          {!(kind === "receive_transfer" && receiveAll) ? (
            <LinesEditor
              kind={kind} adjustAction={adjustAction} services={services} companyId={companyId} locationId={effectiveLocationId || null} bins={lineBins} drafts={drafts}
              onChange={(d) => { setDrafts(d); setLineError(null); }} held={held} rentalId={kind === "return_rental" ? (rentalId || null) : null}
              canSeeCosts={!!context.canSeeCostsByCompany[companyId]} disabled={locked || !companyId} lineError={lineError} acceptHeld={acceptHeld} onHolderFound={onHolderFound}
              initialQuery={initial?.search}
              emptyHint={!companyId ? "Choose the location first." : kind === "return" && !holderKey ? "Say who is returning it first, or scan a label." : undefined}
            />
          ) : null}
        </>
      )}

      {kind === "receive" && context.canSeeCostsByCompany[companyId] ? (
        <div className="space-y-1.5 sm:max-w-[12rem]">
          <label htmlFor={`${uid}-cur`} className="text-sm font-medium leading-none">Currency of the costs</label>
          <Input id={`${uid}-cur`} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} disabled={locked} />
        </div>
      ) : null}

      {cfg.expectedReturn !== "none" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-exp`} className="text-sm font-medium leading-none">{cfg.expectedReturn === "required" ? "Expected back" : "Expected back (optional)"}</label>
          <Input id={`${uid}-exp`} type="datetime-local" value={expectedReturn} min={nowLocalInput(tz)} onChange={(e) => setExpectedReturn(e.target.value)} disabled={locked} required={cfg.expectedReturn === "required" && !chosenRequest?.expectedReturnAt} />
          <p className="text-sm text-muted-foreground">Time at {location?.name ?? "the location"} ({tz.replace("_", " ")}). {kind === "dispatch" && chosenRequest?.expectedReturnAt ? `Left empty, the request's date is used: ${formatInZone(chosenRequest.expectedReturnAt, tz)}.` : "Overdue equipment is flagged and never counted as ready."}</p>
        </div>
      ) : null}

      {kind === "transfer" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-arr`} className="text-sm font-medium leading-none">Expected arrival (optional)</label>
            <Input id={`${uid}-arr`} type="datetime-local" value={expectedArrival} min={nowLocalInput(tz)} onChange={(e) => setExpectedArrival(e.target.value)} disabled={locked} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-car`} className="text-sm font-medium leading-none">Carrier (optional)</label>
            <Input id={`${uid}-car`} value={carrier} onChange={(e) => setCarrier(e.target.value)} maxLength={200} disabled={locked} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-ref`} className="text-sm font-medium leading-none">Reference (optional)</label>
            <Input id={`${uid}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} disabled={locked} />
          </div>
        </div>
      ) : null}

      {kind === "receive" ? (
        <fieldset className="space-y-3 rounded-md border border-border p-3" disabled={locked}>
          <legend className="px-1 text-sm font-medium">Rented, not owned?</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isRental} onChange={(e) => setIsRental(e.target.checked)} /> This equipment is rented and has to go back to its supplier</label>
          {isRental ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><label htmlFor={`${uid}-rs`} className="text-sm font-medium leading-none">Supplier</label><Input id={`${uid}-rs`} value={rentalSupplier} onChange={(e) => setRentalSupplier(e.target.value)} maxLength={160} /></div>
              <div className="space-y-1.5"><label htmlFor={`${uid}-rr`} className="text-sm font-medium leading-none">Supplier&rsquo;s reference</label><Input id={`${uid}-rr`} value={rentalRef} onChange={(e) => setRentalRef(e.target.value)} maxLength={160} /></div>
              <div className="space-y-1.5"><label htmlFor={`${uid}-rd`} className="text-sm font-medium leading-none">Has to go back by</label><Input id={`${uid}-rd`} type="datetime-local" value={rentalDeadline} min={nowLocalInput(tz)} onChange={(e) => setRentalDeadline(e.target.value)} /></div>
              <ProjectSelect label="For project (optional)" projects={context.projects.filter((p) => p.companyId === companyId)} value={rentalProjectId} onChange={setRentalProjectId} />
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground">Rented equipment never adds to what the company owns.</p>
        </fieldset>
      ) : null}

      {cfg.reason === "required" ? (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-why`} className="text-sm font-medium leading-none">Reason</label>
          <Textarea id={`${uid}-why`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} disabled={locked} required placeholder="Say why. A reason is needed every time and is kept with the record." />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={`${uid}-note`} className="text-sm font-medium leading-none">Note (optional)</label>
        <Textarea id={`${uid}-note`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} disabled={locked} />
      </div>

      {problem ? <Alert variant="destructive" role="alert">{problem}</Alert> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onClose ? <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button> : null}
        <Button type="submit" disabled={noLocations}>Review</Button>
      </div>
    </form>
  );
}
