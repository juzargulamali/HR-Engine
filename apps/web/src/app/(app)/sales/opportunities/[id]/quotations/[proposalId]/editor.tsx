"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Download, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { BUDGETARY_NOTICE, NOTE_HEADINGS, QUOTATION_CURRENCIES, REVIEW_PRICING_LABEL, clausesToNotes, isUnsectionedTitle, noteParagraphs, reviewPricingSentence, validateQuotationImageMeta, type PaymentMilestone } from "@enginious-hr/domain";
import {
  checkEstimateReady, createQuotationRevision, decideQuotationApproval, deleteQuotationLine, deleteQuotationSection, issueQuotation, reorderQuotation, requestQuotationApproval, saveEstimateDraft,
  saveQuotationSection, setQuotationLineImage,
} from "@/lib/actions/quotations";
import type { ActionState } from "@/lib/actions/companies";
import { finalizeCrmUpload, prepareCrmUpload } from "@/lib/actions/crmFiles";
import { createClient } from "@/lib/supabase/client";
import { applyWritten, buildDraftPayload, initialDetails, isBlankNewRow, isRowDirty, liveCalc, rowIssue, rowsFromServer, savedDetails, splitRows, type DetailsState, type NotesState, type RowState } from "@/lib/crm/quotations/builder-state";
import { createSaveQueue, type SaveOutcome } from "@/lib/crm/quotations/save-queue";
import { toVat, type QuotationHeader, type QuotationLineRow, type QuotationSectionRow, type RecipientSuggestion, type VatChoiceRow } from "@/lib/crm/quotations/model";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChanges } from "@/components/workspace/unsaved";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { cn } from "@/lib/utils";
import { money } from "./money";

export interface OrgChoice { id: string; name: string; detail: string }
interface Ids { opportunityId: string; proposalId: string }

/** Runs one server action, shows its refusal in words and refreshes the page on success. */
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error: string | null }>, then?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else { then?.(); router.refresh(); }
    });
  };
  return { run, pending, error, setError };
}

const swap = <T,>(arr: T[], i: number, j: number) => { const a = [...arr]; [a[i], a[j]] = [a[j]!, a[i]!]; return a; };
type Clause = { title: string; body: string };
type Step = "details" | "boq" | "finalise";
const STEPS: { id: Step; label: string }[] = [{ id: "details", label: "Details" }, { id: "boq", label: "BOQ" }, { id: "finalise", label: "Preview & finalise" }];

export interface BuilderProps {
  ids: Ids;
  header: QuotationHeader;
  sections: QuotationSectionRow[];
  lines: QuotationLineRow[];
  vatChoices: VatChoiceRow[];
  issuer: { legalName: string; trn: string | null; address: string | null; logoUrl: string | null };
  /** Only a System Administrator can change the issuer's details (Admin, Companies). */
  canEditCompany: boolean;
  parties: { id: string; name: string; role: "agency" | "client" }[];
  others: { id: string; name: string }[];
  suggestion: RecipientSuggestion;
  suggestedCurrency: string;
  imageUrls: Record<string, string>;
  imageNames: Record<string, string>;
  /** What still stands between the SAVED draft and finalising (the database repeats every check). */
  blockers: string[];
  needsApproval: boolean;
  approvalPending: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The builder: three steps, one draft, saved automatically as the person works
// ---------------------------------------------------------------------------------------------------------------------------------
/** The working copy. It lives in a ref (the authority, read by the saves) and is mirrored into state for drawing, so a save that starts a moment after a keystroke sees that keystroke. */
interface Work { details: DetailsState; notes: NotesState; rows: RowState[]; baseDetails: DetailsState; baseNotes: NotesState }

/** Typing is saved this long after the last keystroke (structural steps, Save draft and Finalise save at once). */
const AUTOSAVE_MS = 800;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** True when a save would send something: the details or notes differ from what is saved, or a COMPLETE item is new or changed. */
const hasUnsaved = (w: Work) => !same(w.details, w.baseDetails) || !same(w.notes, w.baseNotes) || splitRows(w.rows).ready.some(isRowDirty);
/** A sentence about items kept on screen because they cannot be saved as typed (null when there are none). */
function attentionOf(rows: readonly RowState[]): string | null {
  const { incomplete } = splitRows(rows);
  if (incomplete.length === 0) return null;
  const first = incomplete[0]!;
  const name = first.row.description.trim() ? `Item “${first.row.description.trim().slice(0, 40)}”` : "A new item";
  return `${name} is not saved yet: ${first.issue}${incomplete.length > 1 ? ` (and ${incomplete.length - 1} more)` : ""}`;
}

/** What the sections, pictures and Finalise parts of the screen may do to the saved draft. Each is queued behind the saves before it, so nothing is saved or created twice. */
interface Ops {
  /** Save now (typed changes included) and say how it went. */
  saveNow: () => Promise<SaveOutcome>;
  /** Run a step that changes the saved draft (add a section, move, delete) after the saves already queued. */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>;
  /** Delete one item (saved or not) in order with the saves; a message when it failed. */
  removeRow: (key: string) => Promise<string | null>;
  dropSectionRows: (sectionId: string) => void;
  /** Upload a picture and attach it to the item, saving the item first when it is not saved yet; a message when it failed. */
  attachPicture: (key: string, file: File, onPhase: (text: string) => void) => Promise<string | null>;
  removePicture: (key: string) => Promise<string | null>;
  /** Wait for every save and upload; null when all is saved, otherwise what needs attention. */
  settle: () => Promise<string | null>;
}

export function EstimateBuilder(p: BuilderProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("details");
  const [initial] = useState<Work>(() => ({
    details: initialDetails(p.header, p.suggestion.kind === "single" ? p.suggestion.orgId : "", p.suggestedCurrency), baseDetails: savedDetails(p.header),
    notes: notesOf(p.header), baseNotes: notesOf(p.header), rows: rowsFromServer(p.lines, p.sections),
  }));
  const work = useRef<Work>(initial);
  const [w, setW] = useState<Work>(initial);
  const commit = (f: (x: Work) => Work) => { work.current = f(work.current); setW(work.current); };
  const [touched, setTouched] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [recipientChecked, setRecipientChecked] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const newKey = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The one save: everything typed that can be saved as typed. Items that are incomplete stay on screen and are left out; items the server wrote take their id (and keep their key).
  const runSave = async (): Promise<SaveOutcome> => {
    const cur = work.current;
    const { ready } = splitRows(cur.rows);
    const payload = buildDraftPayload(p.ids, cur.details, cur.notes, ready);
    const lines = payload.lines ?? [];
    const attention = attentionOf(cur.rows);
    if (lines.length === 0 && same(cur.details, cur.baseDetails) && same(cur.notes, cur.baseNotes)) return { ok: true, attention };
    const result = await saveEstimateDraft(payload);
    // The baseline is what was SENT: anything typed while this save ran is still unsaved afterwards and goes in the next run.
    commit((x) => ({ ...x, rows: applyWritten(x.rows, lines, result.created), ...(result.error ? {} : { baseDetails: cur.details, baseNotes: cur.notes }) }));
    return result.error ? { ok: false, message: result.error } : { ok: true, attention };
  };
  // The queue is made once and always runs the latest `runSave` (which reads the working copy from `work`, so it never sees a stale render).
  const runSaveRef = useRef<() => Promise<SaveOutcome>>(runSave);
  useEffect(() => { runSaveRef.current = runSave; });
  // eslint-disable-next-line react-hooks/refs -- the ref is read when a save runs (an event), never while rendering
  const [queue] = useState(() => createSaveQueue(() => runSaveRef.current()));
  const busy = useSyncExternalStore(queue.subscribe, () => queue.busy, () => false);
  const last = useSyncExternalStore(queue.subscribe, () => queue.last, () => queue.last);

  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clearTimer, []);
  const saveNow = () => { clearTimer(); setWaiting(false); return queue.save(); };
  const scheduleSave = () => { clearTimer(); setWaiting(true); timer.current = setTimeout(() => { timer.current = null; setWaiting(false); void queue.save(); }, AUTOSAVE_MS); };
  const edited = () => { setTouched(true); scheduleSave(); };

  const patchDetails = (patch: Partial<DetailsState>) => { commit((x) => ({ ...x, details: { ...x.details, ...patch } })); edited(); };
  const patchNotes = (patch: Partial<NotesState>) => { commit((x) => ({ ...x, notes: { ...x.notes, ...patch } })); edited(); };
  const patchRow = (key: string, patch: Partial<RowState>) => { commit((x) => ({ ...x, rows: x.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) })); edited(); };
  const addRow = (sectionId: string | null) => {
    const key = `new-${(newKey.current += 1)}`;
    commit((x) => ({ ...x, rows: [...x.rows, { key, id: null, sectionId, description: "", unit: "", quantity: "1", unitPrice: "", vatChoiceId: "", saved: null }] }));
    setFocusKey(key);
    setStep("boq");
  };

  const rowOf = (key: string) => work.current.rows.find((r) => r.key === key);
  const refreshed = () => router.refresh();
  const ops: Ops = {
    saveNow,
    exclusive: (task) => { void saveNow(); return queue.exclusive(task); },
    removeRow: (key) => queue.exclusive(async () => {
      const r = rowOf(key);
      if (!r) return null;
      if (r.id) {
        const res = await deleteQuotationLine(p.ids.opportunityId, p.ids.proposalId, r.id);
        if (res.error) return res.error;
      }
      commit((x) => ({ ...x, rows: x.rows.filter((y) => y.key !== key) }));
      return null;
    }),
    dropSectionRows: (sectionId) => commit((x) => ({ ...x, rows: x.rows.filter((r) => r.sectionId !== sectionId) })),
    attachPicture: (key, file, onPhase) => queue.track((async () => {
      const problem = validateQuotationImageMeta({ name: file.name, size: file.size, type: file.type });
      if (problem) return problem;
      const row = rowOf(key);
      if (!row) return "That item was removed, so the photo was not added.";
      // An item that cannot be saved as typed has nothing to attach the photo to: say what is missing before uploading anything.
      const issue = isBlankNewRow(row) ? "Describe the item." : rowIssue(row);
      if (issue) return `Finish this item first, then add the photo. ${issue}`;
      try {
        const early = saveNow();   // the item is saved while the file uploads, so nothing waits twice
        onPhase("Checking…");
        const prepared = await prepareCrmUpload({ opportunityId: p.ids.opportunityId, name: file.name, size: file.size, type: file.type, purpose: "proposal", label: "Estimate item photo" });
        if (prepared.error !== null) return prepared.error;
        onPhase("Uploading privately…");
        const { error: up } = await createClient().storage.from("crm-quarantine").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
        if (up) return "The upload did not complete. Check your connection, then try again.";
        onPhase("Checking the file's contents…");
        const done = await finalizeCrmUpload(prepared.intentId);
        if (done.error || !done.fileId) return done.error ?? "The photo could not be added. Try again.";
        const fileId = done.fileId;
        await early;
        onPhase("Saving the item…");
        if (!rowOf(key)?.id) await saveNow();
        onPhase("Attaching…");
        const attached = await queue.exclusive(async () => {
          const cur = rowOf(key);
          if (!cur) return "That item was removed, so the photo was not added.";
          if (!cur.id) return "The item could not be saved, so the photo was not added. Check the item and try again.";
          return (await setQuotationLineImage(p.ids.opportunityId, p.ids.proposalId, cur.id, cur.sectionId, fileId)).error;
        });
        if (!attached) refreshed();
        return attached;
      } catch {
        return "Something went wrong while adding the photo. Your item is still here; try again.";
      }
    })()),
    removePicture: (key) => queue.exclusive(async () => {
      const cur = rowOf(key);
      if (!cur?.id) return null;
      const res = await setQuotationLineImage(p.ids.opportunityId, p.ids.proposalId, cur.id, cur.sectionId, null);
      if (!res.error) refreshed();
      return res.error;
    }),
    settle: async () => {
      // A few rounds: typing during the wait is saved too. Each round saves everything typed so far, then waits for pictures and steps still running.
      for (let round = 0; round < 3; round += 1) {
        const out = await saveNow();
        await queue.idle();
        if (!out.ok) return out.message;
        if (!queue.last.ok) return queue.last.message;
        const attention = attentionOf(work.current.rows);
        if (attention) return `${attention} Fix it or delete it, then try again.`;
        if (!hasUnsaved(work.current)) return null;
      }
      return "Your changes kept changing while saving. Wait a moment, then try again.";
    },
  };

  const { details, notes, rows } = w;
  const incomplete = splitRows(rows).incomplete;
  const unsaved = hasUnsaved(w);
  const pendingWork = busy || waiting || unsaved;
  useUnsavedChanges(useId(), touched && (pendingWork || incomplete.length > 0));

  const vat = useMemo(() => { const v = p.vatChoices.find((x) => x.id === details.vatChoiceId); return v ? toVat(v.kind, v.label, v.rate) : null; }, [p.vatChoices, details.vatChoiceId]);
  const { calc, numbers } = useMemo(() => liveCalc(rows, p.sections, details.currency, vat, p.vatChoices), [rows, p.sections, details.currency, vat, p.vatChoices]);
  const cur = details.currency;

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const saving = busy || waiting;
  const failed = !saving && !last.ok;
  const status = saving ? "Saving…" : failed ? "Could not save" : incomplete.length > 0 ? "Not saved yet" : touched ? "Saved" : "Changes are saved automatically";
  const detail = saving ? null : failed ? (last.ok ? null : last.message) : attentionOf(rows);

  return (
    <div className="space-y-4">
      <nav aria-label="Estimate steps">
        <ol className="grid grid-cols-3 gap-2">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setStep(s.id)}
                aria-current={s.id === step ? "step" : undefined}
                className={cn("flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  s.id === step ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-secondary/60")}>
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", s.id === step ? "bg-primary text-primary-foreground" : i < stepIndex ? "bg-[hsl(var(--os-green))] text-white" : "bg-secondary text-foreground")}>
                  {i < stepIndex ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0 truncate">{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {step === "details" ? (
        <DetailsStep p={p} details={details} patch={patchDetails} notes={notes} patchNotes={patchNotes} />
      ) : null}
      {step === "boq" ? (
        <BoqStep p={p} rows={rows} numbers={numbers} calc={calc} cur={cur} locked={pendingWork || incomplete.length > 0} hasIncomplete={incomplete.length > 0} saving={saving} patchRow={patchRow} addRow={addRow} ops={ops} focusKey={focusKey} />
      ) : null}
      {step === "finalise" ? (
        <FinaliseStep p={p} details={details} notes={notes} patchNotes={patchNotes} calc={calc} cur={cur} pendingWork={pendingWork} recipientChecked={recipientChecked} setRecipientChecked={setRecipientChecked} ops={ops} />
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 space-y-2 rounded-lg border border-border bg-card/95 p-3 shadow-sm backdrop-blur" data-testid="builder-bar">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm tabular-nums" aria-label="Running totals">
          <span>Total excl. VAT <strong>{money(calc.net, cur)}</strong></span>
          <span>VAT {calc.vatChosen ? <strong>{money(calc.vat, cur)}</strong> : <span className="text-muted-foreground">not chosen yet</span>}</span>
          <span className="text-base">Total incl. VAT <strong>{money(calc.gross, cur)}</strong></span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            role={failed ? "alert" : "status"}
            data-testid="save-state"
            className={cn("text-sm font-medium", failed ? "text-destructive" : status === "Saved" ? "text-[hsl(var(--os-green))]" : "text-muted-foreground")}>
            {status}
            {detail ? <span className="block font-normal">{detail}</span> : null}
            {failed ? <span className="block font-normal">Your changes are still on screen. They are saved again as soon as you press Save draft or keep editing.</span> : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" disabled={stepIndex === 0} onClick={() => setStep(STEPS[stepIndex - 1]!.id)}>Back</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => { setTouched(true); void saveNow(); }}>{saving ? "Saving…" : "Save draft"}</Button>
            {stepIndex < STEPS.length - 1 ? <Button type="button" onClick={() => setStep(STEPS[stepIndex + 1]!.id)}>Next: {STEPS[stepIndex + 1]!.label}</Button> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function notesOf(h: QuotationHeader): NotesState {
  const n = clausesToNotes(h.terms);
  return { internalNotes: h.internal_notes ?? "", assumptions: n.assumptions, nextSteps: n.nextSteps, exclusions: (h.exclusions ?? []).map((c) => ({ title: c.title, body: c.body })), milestones: (h.milestones ?? []).map((m) => ({ ...m, due: m.due ?? "" })) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Step 1: Details
// ---------------------------------------------------------------------------------------------------------------------------------
function DetailsStep({ p, details, patch, notes, patchNotes }: { p: BuilderProps; details: DetailsState; patch: (x: Partial<DetailsState>) => void; notes: NotesState; patchNotes: (x: Partial<NotesState>) => void }) {
  const partyIds = new Set(p.parties.map((x) => x.id));
  const otherOptions = p.others.filter((o) => !partyIds.has(o.id));
  const isOther = details.billToOrgId !== "" && !partyIds.has(details.billToOrgId);
  const reason = p.header.bill_to_org_id ? null : p.suggestion.reason;
  return (
    <div className="space-y-4">
      <section aria-label="Prepared by" className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-3">
          {p.issuer.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.issuer.logoUrl} alt="Company logo" className="h-10 w-16 rounded border border-border bg-white object-contain p-0.5" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Prepared by: {p.issuer.legalName}</p>
            <p className="break-words text-sm text-muted-foreground">{[p.issuer.trn ? `TRN ${p.issuer.trn}` : "No TRN recorded", p.issuer.address ?? "No address recorded"].join(" · ")}</p>
          </div>
          {p.canEditCompany ? <Link href="/admin/companies" className={buttonVariants({ variant: "outline", size: "sm" })}>Edit in Admin, Companies</Link> : <span className="text-sm text-muted-foreground">Only a System Administrator can change these details.</span>}
        </div>
      </section>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Prepared for</legend>
        {reason ? <p className="text-sm text-muted-foreground" data-testid="recipient-reason">{reason}</p> : null}
        <div className="space-y-1.5">
          {p.parties.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="recipient" value={o.id} checked={details.billToOrgId === o.id} onChange={() => patch({ billToOrgId: o.id })} className="h-4 w-4 accent-[hsl(var(--primary))]" />
              <span>{o.name} <span className="text-muted-foreground">({o.role === "agency" ? "agency" : "end client"})</span></span>
            </label>
          ))}
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="radio" name="recipient" checked={isOther} onChange={() => patch({ billToOrgId: otherOptions[0]?.id ?? "" })} disabled={otherOptions.length === 0} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            <span>Another organisation</span>
            <Select aria-label="Another organisation" className="max-w-xs" value={isOther ? details.billToOrgId : ""} onChange={(e) => patch({ billToOrgId: e.target.value })} disabled={otherOptions.length === 0}>
              <option value="">Choose…</option>
              {otherOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </label>
        </div>
        <p className="text-sm text-muted-foreground">Their name, place, country, VAT registration number / TRN and trade licence are read from their account record and frozen when you finalise. You confirm the recipient before finalising.</p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Currency" htmlFor="est-currency" hint={p.suggestedCurrency && !p.header.currency ? `Filled in from the enquiry (${p.suggestedCurrency}). You can change it.` : "One currency for the whole estimate."}>
          <Select id="est-currency" value={details.currency} onChange={(e) => patch({ currency: e.target.value })}>
            <option value="">Not chosen yet</option>
            {QUOTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="VAT" htmlFor="est-vat" hint="You choose this. It is not inferred from the client's country.">
          <Select id="est-vat" value={details.vatChoiceId} onChange={(e) => patch({ vatChoiceId: e.target.value })}>
            <option value="">Not chosen yet</option>
            {p.vatChoices.filter((v) => v.active || v.id === details.vatChoiceId).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
      </div>

      <MoreOptions details={details} patch={patch} notes={notes} patchNotes={patchNotes} />
    </div>
  );
}

function MoreOptions({ details, patch, notes, patchNotes }: { details: DetailsState; patch: (x: Partial<DetailsState>) => void; notes: NotesState; patchNotes: (x: Partial<NotesState>) => void }) {
  return (
    <details className="group rounded-lg border border-border" data-testid="more-options">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        More options <span className="font-normal text-muted-foreground">· notes for the client, payment details, review date, internal notes</span>
      </summary>
      <div className="space-y-5 border-t border-border p-3">
        <Field label="Internal notes (never printed, never exported)" htmlFor="est-internal" hint="For your team only. Not part of the estimate the client receives.">
          <Textarea id="est-internal" rows={2} value={notes.internalNotes} onChange={(e) => patchNotes({ internalNotes: e.target.value })} />
        </Field>
        <ClientNotesFields notes={notes} patchNotes={patchNotes} />
        <PaymentDetails notes={notes} patchNotes={patchNotes} />
        <Field label={`${REVIEW_PRICING_LABEL} (optional)`} htmlFor="est-review" hint="Prices are budgetary. This date says when pricing should be looked at again; it is not a price guarantee.">
          <Input id="est-review" type="date" className="max-w-xs" value={details.reviewPricingAfter} onChange={(e) => patch({ reviewPricingAfter: e.target.value })} />
        </Field>
      </div>
    </details>
  );
}

/** Assumptions, Exclusions and Next steps: optional, printed under their headings, an empty one is not printed at all. */
function ClientNotesFields({ notes, patchNotes }: { notes: NotesState; patchNotes: (x: Partial<NotesState>) => void }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Notes for the client (optional)</legend>
      <p className="text-sm text-muted-foreground">Each one prints under its own heading and only when it has text. The budgetary notice is always printed first and cannot be changed here.</p>
      <Field label={NOTE_HEADINGS.assumptions} htmlFor="est-assumptions" hint="Separate paragraphs with a blank line.">
        <Textarea id="est-assumptions" rows={4} maxLength={3000} value={notes.assumptions} onChange={(e) => patchNotes({ assumptions: e.target.value })} />
      </Field>
      <ClauseList legend={NOTE_HEADINGS.exclusions} hint="What the price does not include. Starts empty: add the items that apply." noun="Exclusion" items={notes.exclusions} set={(f) => patchNotes({ exclusions: f(notes.exclusions) })} />
      <Field label={NOTE_HEADINGS.nextSteps} htmlFor="est-next" hint="Separate paragraphs with a blank line.">
        <Textarea id="est-next" rows={4} maxLength={3000} value={notes.nextSteps} onChange={(e) => patchNotes({ nextSteps: e.target.value })} />
      </Field>
    </fieldset>
  );
}

/** An editable, reorderable list of titled paragraphs (the Exclusions). */
function ClauseList({ legend, hint, noun, items, set }: { legend: string; hint: string; noun: string; items: Clause[]; set: (f: (a: Clause[]) => Clause[]) => void }) {
  const lower = noun.toLowerCase();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-sm text-muted-foreground">{hint}</p>
      {items.map((c, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
          <div className="flex gap-2">
            <Input aria-label={`${noun} ${i + 1} title`} value={c.title} onChange={(e) => set((a) => a.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <Button type="button" variant="ghost" size="sm" disabled={i === 0} aria-label={`Move ${lower} ${i + 1} up`} onClick={() => set((a) => swap(a, i, i - 1))}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
            <Button type="button" variant="ghost" size="sm" disabled={i === items.length - 1} aria-label={`Move ${lower} ${i + 1} down`} onClick={() => set((a) => swap(a, i, i + 1))}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${lower} ${i + 1}`} onClick={() => set((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
          </div>
          <Textarea aria-label={`${noun} ${i + 1} text`} rows={3} value={c.body} onChange={(e) => set((a) => a.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => set((a) => [...a, { title: "", body: "" }])}><Plus className="h-4 w-4" aria-hidden /> Add {lower}</Button>
    </fieldset>
  );
}

/** Optional payment details, worded as an INDICATIVE schedule only (it asks for nothing and is not an acceptance step). */
function PaymentDetails({ notes, patchNotes }: { notes: NotesState; patchNotes: (x: Partial<NotesState>) => void }) {
  const ms = notes.milestones;
  const set = (f: (a: PaymentMilestone[]) => PaymentMilestone[]) => patchNotes({ milestones: f(ms) });
  const upd = (i: number, patch: Partial<PaymentMilestone>) => set((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Payment details (optional)</legend>
      <p className="text-sm text-muted-foreground">Printed as an indicative payment schedule. Percentages must add up to 100, or amounts to the total including VAT. Leave empty for none.</p>
      {ms.map((m, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_7rem_6rem_1fr_auto]">
          <Input aria-label={`Payment line ${i + 1} label`} placeholder="e.g. First instalment" value={m.label} onChange={(e) => upd(i, { label: e.target.value })} />
          <Select aria-label={`Payment line ${i + 1} type`} value={m.kind} onChange={(e) => upd(i, { kind: e.target.value as "percent" | "amount" })}><option value="percent">Percent</option><option value="amount">Amount</option></Select>
          <Input aria-label={`Payment line ${i + 1} value`} inputMode="decimal" placeholder={m.kind === "percent" ? "40" : "0.00"} value={m.value} onChange={(e) => upd(i, { value: e.target.value })} />
          <Input aria-label={`Payment line ${i + 1} timing`} placeholder="Timing, e.g. before mobilisation" value={m.due ?? ""} onChange={(e) => upd(i, { due: e.target.value })} />
          <Button type="button" variant="ghost" size="sm" aria-label={`Remove payment line ${i + 1}`} onClick={() => set((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => set((a) => [...a, { label: "", kind: a[0]?.kind ?? "percent", value: "", due: "" }])}><Plus className="h-4 w-4" aria-hidden /> Add payment line</Button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Step 2: BOQ (items inline, sections optional)
// ---------------------------------------------------------------------------------------------------------------------------------
function BoqStep({ p, rows, numbers, calc, cur, locked, hasIncomplete, saving, patchRow, addRow, ops, focusKey }: {
  p: BuilderProps; rows: RowState[]; numbers: Map<string, string>; calc: ReturnType<typeof liveCalc>["calc"]; cur: string;
  /** True while something is unsaved or saving: moving things around and deleting a section wait for the save. */
  locked: boolean; hasIncomplete: boolean; saving: boolean;
  patchRow: (key: string, patch: Partial<RowState>) => void; addRow: (sectionId: string | null) => void; ops: Ops; focusKey: string | null;
}) {
  const router = useRouter();
  const { run, pending, error } = useRun();
  const titled = [...p.sections].filter((s) => !isUnsectionedTitle(s.title)).sort((a, b) => a.position - b.position);
  const loose = p.sections.find((s) => isUnsectionedTitle(s.title)) ?? null;
  const looseRows = rows.filter((r) => r.sectionId === null);
  const move = (i: number, d: -1 | 1) => run(() => ops.exclusive(() => reorderQuotation(p.ids.opportunityId, p.ids.proposalId, "sections", null, swap(p.sections.map((s) => s.id), p.sections.findIndex((s) => s.id === titled[i]!.id), p.sections.findIndex((s) => s.id === titled[i + d]!.id)))));
  const calcOf = (id: string | null) => calc.sections.find((s) => (id === null ? s.unsectioned : s.id === id));
  // Adding a section needs no Save draft: whatever is typed is saved first (queued ahead of the step), then the section is created once.
  const addSection = async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
    const result = await ops.exclusive(() => saveQuotationSection(_prev, formData));
    if (!result.error) router.refresh();
    return result;
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Type each item straight into its row. Everything is saved as you go. Sections are optional: add items first, and add a section only if you want headings. Line totals and subtotals update as you type.</p>
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}

      <div aria-hidden className="hidden gap-2 px-3 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5rem_7rem_9rem_auto]">
        <span>#</span><span>Description</span><span>Unit</span><span>Qty</span><span>Unit price</span><span>VAT</span><span className="w-[7.5rem]" />
      </div>
      <section aria-label="Items without a section" className="rounded-lg border border-border">
        {looseRows.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">No items yet. Add the first item below.</p> : (
          <ul className="divide-y divide-border/70">
            {looseRows.map((r) => <ItemRow key={r.key} p={p} row={r} number={numbers.get(r.key) ?? ""} cur={cur} patchRow={patchRow} ops={ops} autoFocus={focusKey === r.key} locked={locked} siblings={looseRows} scopeId={loose?.id ?? null} />)}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <Button type="button" variant="outline" size="sm" onClick={() => addRow(null)}><Plus className="h-4 w-4" aria-hidden /> Add item</Button>
          {looseRows.length > 0 && titled.length > 0 ? <p className="text-sm tabular-nums">Subtotal, items without a section: <strong>{money(calcOf(null)?.net, cur)}</strong></p> : null}
        </div>
      </section>

      {titled.map((s, i) => {
        const secRows = rows.filter((r) => r.sectionId === s.id);
        const cs = calcOf(s.id);
        return (
          <section key={s.id} aria-label={`Section ${s.title}`} className="rounded-lg border border-border">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/40 px-3 py-2">
              <h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{s.title}</h3>
              <RenameSection ids={p.ids} section={s} />
              <Button type="button" variant="ghost" size="sm" disabled={pending || locked || i === 0} onClick={() => move(i, -1)} aria-label={`Move section ${s.title} up`}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending || locked || i === titled.length - 1} onClick={() => move(i, 1)} aria-label={`Move section ${s.title} down`}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending || locked} onClick={() => { if (confirm(`Delete the section "${s.title}" and its ${secRows.length} item(s)?`)) run(() => ops.exclusive(() => deleteQuotationSection(p.ids.opportunityId, p.ids.proposalId, s.id)), () => ops.dropSectionRows(s.id)); }} aria-label={`Delete section ${s.title}`}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
            {secRows.length > 0 ? (
              <ul className="divide-y divide-border/70">
                {secRows.map((r) => <ItemRow key={r.key} p={p} row={r} number={numbers.get(r.key) ?? ""} cur={cur} patchRow={patchRow} ops={ops} autoFocus={focusKey === r.key} locked={locked} siblings={secRows} scopeId={s.id} />)}
              </ul>
            ) : <p className="px-3 py-3 text-sm text-muted-foreground">No items in this section yet.</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
              <Button type="button" variant="outline" size="sm" onClick={() => addRow(s.id)}><Plus className="h-4 w-4" aria-hidden /> Add item to this section</Button>
              <p className="text-sm tabular-nums">Section subtotal: <strong>{money(cs?.net, cur)}</strong> <span className="text-muted-foreground">excl. VAT · VAT {money(cs?.vat)} · incl. {money(cs?.gross)}</span></p>
            </div>
          </section>
        );
      })}
      {hasIncomplete && !saving ? <p className="text-sm text-muted-foreground">Moving items or sections and deleting a section wait until every item is complete (or removed), because they work on the saved draft.</p> : null}
      <AddSection ids={p.ids} action={addSection} />
    </div>
  );
}

function ItemRow({ p, row, number, cur, patchRow, ops, autoFocus, locked, siblings, scopeId }: {
  p: BuilderProps; row: RowState; number: string; cur: string; patchRow: (k: string, x: Partial<RowState>) => void; ops: Ops; autoFocus: boolean; locked: boolean;
  siblings: RowState[]; scopeId: string | null;
}) {
  const { run, pending, error } = useRun();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const issue = row.description || row.quantity || row.unitPrice ? rowIssue(row) : null;
  const savedLine = row.id ? p.lines.find((l) => l.id === row.id) : undefined;
  // Reordering works on the saved items only (a blank new row has no id yet).
  const savedSiblings = siblings.filter((x) => x.id);
  const idx = savedSiblings.findIndex((x) => x.key === row.key);
  const label = number || "new item";
  const reorder = (to: number) => run(() => ops.exclusive(() => reorderQuotation(p.ids.opportunityId, p.ids.proposalId, "lines", scopeId, swap(savedSiblings.map((x) => x.id!), idx, to))));
  return (
    <li className="grid gap-2 px-3 py-3 lg:grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5rem_7rem_9rem_auto]">
      <span className="pt-2 text-sm font-semibold tabular-nums" aria-label="Item number">{number}</span>
      <Textarea ref={ref} aria-label={`Item ${label} description`} rows={2} placeholder="Describe the item" maxLength={4000} value={row.description} onChange={(e) => patchRow(row.key, { description: e.target.value })} />
      <Input aria-label={`Item ${label} unit`} placeholder="Unit" maxLength={20} value={row.unit} onChange={(e) => patchRow(row.key, { unit: e.target.value })} />
      <Input aria-label={`Item ${label} quantity`} inputMode="decimal" placeholder="Qty" value={row.quantity} onChange={(e) => patchRow(row.key, { quantity: e.target.value })} />
      <Input aria-label={`Item ${label} unit price`} inputMode="decimal" placeholder="Unit price" value={row.unitPrice} onChange={(e) => patchRow(row.key, { unitPrice: e.target.value })} />
      <Select aria-label={`Item ${label} VAT`} value={row.vatChoiceId} onChange={(e) => patchRow(row.key, { vatChoiceId: e.target.value })}>
        <option value="">Same as estimate</option>
        {p.vatChoices.filter((v) => v.active || v.id === row.vatChoiceId).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
      </Select>
      <div className="flex items-start justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" disabled={pending || locked || idx <= 0 || !row.id} onClick={() => reorder(idx - 1)} aria-label={`Move item ${label} up`}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending || locked || idx === savedSiblings.length - 1 || !row.id} onClick={() => reorder(idx + 1)} aria-label={`Move item ${label} down`}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} aria-label={`Delete item ${label}`}
          onClick={() => { if (row.id && !confirm(`Delete item ${label}?`)) return; run(async () => ({ error: await ops.removeRow(row.key) })); }}><Trash2 className="h-4 w-4" aria-hidden /></Button>
      </div>
      <div className="min-w-0 space-y-1 lg:col-start-2 lg:col-end-8">
        <ItemFigures p={p} row={row} cur={cur} />
        {issue ? <p className="text-sm text-destructive" role="status">{issue}</p> : null}
        <LinePicture imageFileId={savedLine?.image_file_id ?? null} url={p.imageUrls[savedLine?.image_file_id ?? ""] ?? null} name={p.imageNames[savedLine?.image_file_id ?? ""] ?? null}
          attach={(file, onPhase) => ops.attachPicture(row.key, file, onPhase)} remove={() => ops.removePicture(row.key)} />
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </div>
    </li>
  );
}

/** The row's own figures, from the typed values (the same shared calculation as the totals). */
function ItemFigures({ p, row, cur }: { p: BuilderProps; row: RowState; cur: string }) {
  const { calc } = useMemo(() => {
    const only: RowState = { ...row, sectionId: null };
    return liveCalc([only], [], cur, null, p.vatChoices);
  }, [row, cur, p.vatChoices]);
  const l = calc.sections[0]?.lines[0];
  if (rowIssue(row) || !l) return <p className="text-sm text-muted-foreground tabular-nums">Line total: —</p>;
  return <p className="text-sm tabular-nums">Line total <strong>{money(l.net, cur)}</strong> <span className="text-muted-foreground">excl. VAT{row.vatChoiceId ? "" : " (VAT is added at the estimate's rate in the totals)"}</span></p>;
}

function AddSection({ ids, action }: { ids: Ids; action: (prev: ActionState, formData: FormData) => Promise<ActionState> }) {
  return (
    <ActionForm action={action} submitLabel="Add section" resetOnSuccess>
      <input type="hidden" name="opportunityId" value={ids.opportunityId} />
      <input type="hidden" name="proposalId" value={ids.proposalId} />
      <Field label="Add a section (optional)" htmlFor="est-new-section" hint="Only if you want headings, for example Fabrication, AV or Installation. Items can stay without a section. No need to save the draft first."><Input id="est-new-section" name="title" required maxLength={120} placeholder="e.g. Fabrication" autoComplete="off" /></Field>
    </ActionForm>
  );
}

function RenameSection({ ids, section }: { ids: Ids; section: QuotationSectionRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Rename section ${section.title}`}><Pencil className="h-4 w-4" aria-hidden /></Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Rename section">
        <ActionForm action={saveQuotationSection} submitLabel="Save name" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="opportunityId" value={ids.opportunityId} />
          <input type="hidden" name="proposalId" value={ids.proposalId} />
          <input type="hidden" name="sectionId" value={section.id} />
          <Field label="Section name" htmlFor={`sec-${section.id}`}><Input id={`sec-${section.id}`} name="title" required maxLength={120} defaultValue={section.title} /></Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/**
 * The photo beside an item. The upload itself (private quarantine, server checks) and the attaching are done by the builder, which saves the item first when it is not
 * saved yet and queues the attach behind the saves. A failed upload keeps the chosen file here, so "Try again" needs no new pick.
 */
function LinePicture({ imageFileId, url, name, attach, remove }: {
  imageFileId: string | null; url: string | null; name: string | null;
  attach: (file: File, onPhase: (text: string) => void) => Promise<string | null>; remove: () => Promise<string | null>;
}) {
  const [phase, setPhase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<File | null>(null);
  const [added, setAdded] = useState(false);
  const working = useRef(false);
  async function send(file: File) {
    if (working.current) return;
    working.current = true;
    setError(null); setRetry(null); setAdded(false);
    setPhase("Checking…");
    try {
      const problem = await attach(file, setPhase);
      if (problem) { setError(problem); setRetry(file); } else setAdded(true);
    } finally {
      working.current = false;
      setPhase("");
    }
  }
  async function onRemove() {
    if (working.current) return;
    working.current = true;
    setError(null); setAdded(false);
    setPhase("Removing…");
    try { const problem = await remove(); if (problem) setError(problem); } finally { working.current = false; setPhase(""); }
  }
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void send(file);
  };
  return (
    <div className="space-y-1">
      {imageFileId ? (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt={name ? `Photo: ${name}` : "Item photo"} className="h-14 w-14 rounded border border-border object-contain" /> : null}
          <span className="text-sm text-muted-foreground">{name ?? "Photo attached"}</span>
          <Button type="button" variant="ghost" size="sm" disabled={!!phase} onClick={onRemove}>Remove photo</Button>
        </div>
      ) : (
        <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline">
          <ImagePlus className="h-4 w-4" aria-hidden /> Add photo
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} disabled={!!phase} />
        </label>
      )}
      {phase ? <p className="text-sm text-muted-foreground" role="status">{phase}</p> : null}
      {added && !imageFileId && !phase ? <p className="text-sm text-muted-foreground" role="status">Photo added.</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
          {retry ? <> <button type="button" className="font-medium underline underline-offset-2" onClick={() => void send(retry)}>Try again</button></> : null}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Step 3: Preview & finalise
// ---------------------------------------------------------------------------------------------------------------------------------
const excerpt = (text: string, n = 180) => { const t = text.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t; };

function FinaliseStep({ p, details, notes, patchNotes, calc, cur, pendingWork, recipientChecked, setRecipientChecked, ops }: {
  p: BuilderProps; details: DetailsState; notes: NotesState; patchNotes: (x: Partial<NotesState>) => void; calc: ReturnType<typeof liveCalc>["calc"]; cur: string;
  /** True while a save or upload is running or waiting, or something typed is not saved yet. */
  pendingWork: boolean; recipientChecked: boolean; setRecipientChecked: (v: boolean) => void; ops: Ops;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [phase, setPhase] = useState<"" | "waiting" | "checking" | "working">("");
  const [problem, setProblem] = useState<{ message: string; blockers: string[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const recipient = [...p.parties, ...p.others].find((o) => o.id === details.billToOrgId);
  const vatLabel = p.vatChoices.find((v) => v.id === details.vatChoiceId)?.label;
  const items = calc.sections.reduce((n, s) => n + s.lines.length, 0);
  const assumptions = noteParagraphs(notes.assumptions);
  const nextSteps = noteParagraphs(notes.nextSteps);
  const running = phase !== "" || refreshing;
  // While anything is saving or unsaved the list below (read from the SAVED draft) would be out of date: Finalise waits for the save and checks the saved estimate afresh.
  const blockers = pendingWork ? [] : p.blockers;
  const canFinalise = recipientChecked && !running && (pendingWork || blockers.length === 0);
  const done = () => startRefresh(() => router.refresh());

  /** Wait for every save and upload, then run `then`. Anything missing or failed is explained here and the estimate stays editable. */
  async function afterSaves(then: () => Promise<{ error: string | null; blockers?: string[] }>) {
    setProblem(null);
    setPhase("waiting");
    try {
      const why = await ops.settle();
      if (why) { setProblem({ message: why, blockers: [] }); return; }
      setPhase("checking");
      const r = await then();
      if (r.error || (r.blockers && r.blockers.length)) setProblem({ message: r.error ?? "This estimate cannot be finalised yet.", blockers: r.blockers ?? [] });
      done();
    } catch {
      setProblem({ message: "Something went wrong, so nothing was finalised. Your changes are saved; try again.", blockers: [] });
    } finally {
      setPhase("");
    }
  }
  const finalise = () => {
    if (!confirm("Finalise this estimate? A frozen copy is made and this draft becomes read-only. Nothing is sent to anyone, and nothing is reserved or promised.")) return;
    void afterSaves(async () => {
      const ready = await checkEstimateReady(p.ids.opportunityId, p.ids.proposalId);   // read fresh from what was just saved
      if (ready.error || ready.blockers.length) return ready;
      setPhase("working");
      return issueQuotation(p.ids.opportunityId, p.ids.proposalId);
    });
  };
  const requestApproval = () => void afterSaves(() => requestQuotationApproval(p.ids.opportunityId, p.ids.proposalId));
  const waitText = phase === "waiting" ? "Waiting for your changes and photos to finish saving…" : phase === "checking" ? "Checking the saved estimate…" : phase === "working" ? "Finalising…" : null;

  return (
    <div className="space-y-4">
      <section aria-label="Summary" className="grid gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-2">
        <div><p className="text-muted-foreground">Prepared for</p><p className="font-medium">{recipient ? recipient.name : <span className="text-muted-foreground">not chosen yet</span>}</p></div>
        <div><p className="text-muted-foreground">Currency and VAT</p><p className="font-medium">{cur || "Currency not chosen"} · {vatLabel ?? "VAT not chosen"}</p></div>
        <div><p className="text-muted-foreground">Items</p><p className="font-medium">{items}</p></div>
        <div><p className="text-muted-foreground">Total incl. VAT</p><p className="font-medium tabular-nums">{money(calc.gross, cur)}</p></div>
        {details.reviewPricingAfter ? <div className="sm:col-span-2"><p className="text-muted-foreground">{REVIEW_PRICING_LABEL}</p><p>{reviewPricingSentence(details.reviewPricingAfter)}</p></div> : null}
      </section>

      <section aria-label="What will print" className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">What the client file will say</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden /> Edit notes</Button>
        </div>
        <div className="rounded-md border border-[#C7A24B] bg-[#FBF5E3] p-3 text-sm text-[#2b2412] dark:bg-[#3a3015] dark:text-[#f5ecd0]" data-testid="notice-preview">
          <p className="text-xs font-semibold uppercase tracking-wide">Budgetary estimate · printed first on every estimate, cannot be changed</p>
          <p className="mt-1">{BUDGETARY_NOTICE}</p>
        </div>
        {assumptions.length === 0 && notes.exclusions.length === 0 && nextSteps.length === 0 && notes.milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes or payment details. Nothing else is printed after the totals.</p>
        ) : (
          <dl className="space-y-2 text-sm">
            {assumptions.length ? <div><dt className="font-medium">{NOTE_HEADINGS.assumptions}</dt><dd className="text-muted-foreground">{excerpt(assumptions[0]!)}{assumptions.length > 1 ? ` (+${assumptions.length - 1} more paragraph${assumptions.length > 2 ? "s" : ""})` : ""}</dd></div> : null}
            {notes.exclusions.length ? <div><dt className="font-medium">{NOTE_HEADINGS.exclusions}</dt><dd className="text-muted-foreground">{notes.exclusions.map((c) => c.title).filter(Boolean).slice(0, 4).join(", ")}{notes.exclusions.length > 4 ? ` and ${notes.exclusions.length - 4} more` : ""}</dd></div> : null}
            {nextSteps.length ? <div><dt className="font-medium">{NOTE_HEADINGS.nextSteps}</dt><dd className="text-muted-foreground">{excerpt(nextSteps[0]!)}{nextSteps.length > 1 ? ` (+${nextSteps.length - 1} more paragraph${nextSteps.length > 2 ? "s" : ""})` : ""}</dd></div> : null}
            {notes.milestones.length ? <div><dt className="font-medium">Indicative payment schedule</dt><dd className="text-muted-foreground">{notes.milestones.length} line{notes.milestones.length > 1 ? "s" : ""}</dd></div> : null}
          </dl>
        )}
        <Modal open={editing} onClose={() => setEditing(false)} size="wide" title="Edit notes for the client" description="These are the optional notes. The budgetary notice is not part of them.">
          <div className="space-y-4">
            <ClientNotesFields notes={notes} patchNotes={patchNotes} />
            <div className="flex justify-end"><Button type="button" onClick={() => setEditing(false)}>Done</Button></div>
            <p className="text-sm text-muted-foreground">Changes are saved automatically.</p>
          </div>
        </Modal>
      </section>

      <section aria-label="Download preview" className="flex flex-wrap items-center gap-2">
        <a href={`/api/sales/quotations/${p.ids.proposalId}/pdf`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download className="h-4 w-4" aria-hidden /> Download PDF</a>
        <a href={`/api/sales/quotations/${p.ids.proposalId}/xlsx`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download className="h-4 w-4" aria-hidden /> Download Excel (.xlsx)</a>
        <span className="text-xs text-muted-foreground">Downloads of a draft are marked DRAFT and show the last saved version. Nothing is sent to anyone.</span>
      </section>

      <section aria-label="Finalise" className="space-y-3 rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold">Finalise</h3>
        {pendingWork ? (
          <p className="text-sm text-muted-foreground" data-testid="finalise-pending">Your latest changes are still being saved. Finalise waits for them (and for any photo upload), then checks the saved estimate.</p>
        ) : blockers.length ? (
          <div>
            <p className="text-sm font-medium">Before this can be finalised</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        ) : <p className="text-sm text-muted-foreground">Everything needed to finalise is in place.</p>}
        {waitText ? <p className="text-sm font-medium" role="status" data-testid="finalise-wait">{waitText}</p> : null}
        {problem ? (
          <Alert variant="destructive" role="alert" data-testid="finalise-problem">
            <p>{problem.message}</p>
            {problem.blockers.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5">{problem.blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}
            <p className="mt-1">The estimate is still a draft and can be edited.</p>
          </Alert>
        ) : null}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={recipientChecked} onChange={(e) => setRecipientChecked(e.target.checked)} />
          <span>I have checked who this estimate is addressed to{recipient ? ` (${recipient.name})` : ""}, and the currency and VAT.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {p.needsApproval && !p.approvalPending ? (
            <Button type="button" variant="outline" disabled={running} onClick={requestApproval}>Request approval</Button>
          ) : null}
          <Button type="button" disabled={!canFinalise} onClick={finalise}>Finalise estimate</Button>
        </div>
        {p.needsApproval ? <p className="text-sm text-muted-foreground">This company needs approval of the exact version before it is finalised. Editing the draft after approval asks for it again.</p> : null}
        <p className="text-sm text-muted-foreground">Finalising freezes this version only. It does not reserve equipment, stock or dates, does not record anything as sent, and does not move the enquiry.</p>
      </section>
    </div>
  );
}

/** The reviewer screen for the approver: shows the version it was rendered with and approves or asks for changes. A version that changed after this screen opened cannot be approved from it. */
export function ApprovalReview({ ids, approvalId, seenHash }: { ids: Ids; approvalId: string; seenHash: string }) {
  const { run, pending, error } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2" data-testid="approval-review">
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      <Textarea aria-label="What needs to change (required to ask for changes)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => run(() => decideQuotationApproval(ids.opportunityId, ids.proposalId, approvalId, "approved", note, seenHash))}>Approve this version</Button>
        <Button type="button" variant="outline" disabled={pending || note.trim().length === 0} onClick={() => run(() => decideQuotationApproval(ids.opportunityId, ids.proposalId, approvalId, "changes_requested", note, seenHash))}>Ask for changes</Button>
      </div>
    </div>
  );
}

export function ReviseButton({ ids }: { ids: Ids }) {
  const router = useRouter();
  const { run, pending, error } = useRun();
  return (
    <div className="space-y-2">
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      <Button type="button" variant="outline" disabled={pending} onClick={() => { run(async () => { const r = await createQuotationRevision(ids.opportunityId, ids.proposalId); if (!r.error && r.proposalId) router.push(`/sales/opportunities/${ids.opportunityId}/quotations/${r.proposalId}`); return r; }); }}>Create revision</Button>
    </div>
  );
}

