"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Download, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { BUDGETARY_NOTICE, NOTE_HEADINGS, QUOTATION_CURRENCIES, REVIEW_PRICING_LABEL, clausesToNotes, isUnsectionedTitle, noteParagraphs, reviewPricingSentence, validateQuotationImageMeta, type PaymentMilestone } from "@enginious-hr/domain";
import {
  createQuotationRevision, decideQuotationApproval, deleteQuotationLine, deleteQuotationSection, issueQuotation, reorderQuotation, requestQuotationApproval, saveEstimateDraft,
  saveQuotationSection, setQuotationLineImage,
} from "@/lib/actions/quotations";
import { finalizeCrmUpload, prepareCrmUpload } from "@/lib/actions/crmFiles";
import { createClient } from "@/lib/supabase/client";
import { applyPartial, applySaved, buildDraftPayload, initialDetails, isRowDirty, liveCalc, rowIssue, rowsFromServer, savedDetails, type DetailsState, type NotesState, type RowState } from "@/lib/crm/quotations/builder-state";
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
// The builder: three steps, one draft, one Save draft button
// ---------------------------------------------------------------------------------------------------------------------------------
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

export function EstimateBuilder(p: BuilderProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("details");
  const [baseDetails, setBaseDetails] = useState<DetailsState>(() => savedDetails(p.header));
  const [details, setDetails] = useState<DetailsState>(() => initialDetails(p.header, p.suggestion.kind === "single" ? p.suggestion.orgId : "", p.suggestedCurrency));
  const [baseNotes, setBaseNotes] = useState<NotesState>(() => notesOf(p.header));
  const [notes, setNotes] = useState<NotesState>(() => notesOf(p.header));
  const [rows, setRows] = useState<RowState[]>(() => rowsFromServer(p.lines, p.sections));
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [touched, setTouched] = useState(false);
  const [recipientChecked, setRecipientChecked] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const newKey = useRef(0);

  const patchDetails = (patch: Partial<DetailsState>) => { setDetails((d) => ({ ...d, ...patch })); edited(); };
  const patchNotes = (patch: Partial<NotesState>) => { setNotes((n) => ({ ...n, ...patch })); edited(); };
  const edited = () => { setTouched(true); setSave((s) => (s.kind === "saving" ? s : { kind: "idle" })); };

  const dirtyDetails = JSON.stringify(details) !== JSON.stringify(baseDetails);
  const dirtyNotes = JSON.stringify(notes) !== JSON.stringify(baseNotes);
  const dirtyRows = rows.some(isRowDirty);
  const dirty = dirtyDetails || dirtyNotes || dirtyRows;
  useUnsavedChanges(useId(), touched && dirty);

  const vat = useMemo(() => { const v = p.vatChoices.find((x) => x.id === details.vatChoiceId); return v ? toVat(v.kind, v.label, v.rate) : null; }, [p.vatChoices, details.vatChoiceId]);
  const { calc, numbers } = useMemo(() => liveCalc(rows, p.sections, details.currency, vat, p.vatChoices), [rows, p.sections, details.currency, vat, p.vatChoices]);
  const cur = details.currency;

  const onSave = async () => {
    const bad = rows.map((r, i) => ({ r, i })).find(({ r }) => isRowDirty(r) && rowIssue(r));
    if (bad) { setSave({ kind: "error", message: `Item ${numbers.get(bad.r.key) ?? bad.i + 1}: ${rowIssue(bad.r)}` }); setStep("boq"); return; }
    setSave({ kind: "saving" });
    try {
      const result = await saveEstimateDraft(buildDraftPayload(p.ids, details, notes, rows));
      if (result.error) {
        setRows((r) => applyPartial(r, result.created));
        setSave({ kind: "error", message: result.error });
        return;
      }
      setBaseDetails(details);
      setBaseNotes(notes);
      setRows((r) => applySaved(r, result.created));
      setSave({ kind: "saved" });
      router.refresh();
    } catch {
      setSave({ kind: "error", message: "The save did not reach the server. Check your connection." });
    }
  };

  const addRow = (sectionId: string | null) => {
    const key = `new-${(newKey.current += 1)}`;
    setRows((r) => [...r, { key, id: null, sectionId, description: "", unit: "", quantity: "1", unitPrice: "", vatChoiceId: "", saved: null }]);
    setFocusKey(key);
    setStep("boq");
  };
  const patchRow = (key: string, patch: Partial<RowState>) => { setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x))); edited(); };
  const dropLocalRow = (key: string) => setRows((r) => r.filter((x) => x.key !== key));

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const statusText = save.kind === "saving" ? "Saving…" : save.kind === "saved" && !dirty ? "Saved" : save.kind === "error" ? "Could not save, try again." : dirty ? "Unsaved changes" : "Nothing to save";

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
        <BoqStep p={p} rows={rows} numbers={numbers} calc={calc} cur={cur} dirty={dirty} patchRow={patchRow} addRow={addRow} dropLocalRow={dropLocalRow} focusKey={focusKey} />
      ) : null}
      {step === "finalise" ? (
        <FinaliseStep p={p} details={details} notes={notes} patchNotes={patchNotes} calc={calc} cur={cur} dirty={dirty} recipientChecked={recipientChecked} setRecipientChecked={setRecipientChecked} />
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-1 space-y-2 rounded-lg border border-border bg-card/95 p-3 shadow-sm backdrop-blur" data-testid="builder-bar">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm tabular-nums" aria-label="Running totals">
          <span>Total excl. VAT <strong>{money(calc.net, cur)}</strong></span>
          <span>VAT {calc.vatChosen ? <strong>{money(calc.vat, cur)}</strong> : <span className="text-muted-foreground">not chosen yet</span>}</span>
          <span className="text-base">Total incl. VAT <strong>{money(calc.gross, cur)}</strong></span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            role={save.kind === "error" ? "alert" : "status"}
            data-testid="save-state"
            className={cn("text-sm font-medium", save.kind === "error" ? "text-destructive" : save.kind === "saved" && !dirty ? "text-[hsl(var(--os-green))]" : "text-muted-foreground")}>
            {statusText}
            {save.kind === "error" ? <span className="block font-normal">{save.message}</span> : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" disabled={stepIndex === 0} onClick={() => setStep(STEPS[stepIndex - 1]!.id)}>Back</Button>
            <Button type="button" variant="outline" disabled={save.kind === "saving"} onClick={onSave}>{save.kind === "saving" ? "Saving…" : "Save draft"}</Button>
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
function BoqStep({ p, rows, numbers, calc, cur, dirty, patchRow, addRow, dropLocalRow, focusKey }: {
  p: BuilderProps; rows: RowState[]; numbers: Map<string, string>; calc: ReturnType<typeof liveCalc>["calc"]; cur: string; dirty: boolean;
  patchRow: (key: string, patch: Partial<RowState>) => void; addRow: (sectionId: string | null) => void; dropLocalRow: (key: string) => void; focusKey: string | null;
}) {
  const { run, pending, error } = useRun();
  const titled = [...p.sections].filter((s) => !isUnsectionedTitle(s.title)).sort((a, b) => a.position - b.position);
  const loose = p.sections.find((s) => isUnsectionedTitle(s.title)) ?? null;
  const looseRows = rows.filter((r) => r.sectionId === null);
  const move = (i: number, d: -1 | 1) => run(() => reorderQuotation(p.ids.opportunityId, p.ids.proposalId, "sections", null, swap(p.sections.map((s) => s.id), p.sections.findIndex((s) => s.id === titled[i]!.id), p.sections.findIndex((s) => s.id === titled[i + d]!.id))));
  const calcOf = (id: string | null) => calc.sections.find((s) => (id === null ? s.unsectioned : s.id === id));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Type each item straight into its row. Sections are optional: add items first, and add a section only if you want headings. Line totals and subtotals update as you type.</p>
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}

      <div aria-hidden className="hidden gap-2 px-3 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5rem_7rem_9rem_auto]">
        <span>#</span><span>Description</span><span>Unit</span><span>Qty</span><span>Unit price</span><span>VAT</span><span className="w-[7.5rem]" />
      </div>
      <section aria-label="Items without a section" className="rounded-lg border border-border">
        {looseRows.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">No items yet. Add the first item below.</p> : (
          <ul className="divide-y divide-border/70">
            {looseRows.map((r) => <ItemRow key={r.key} p={p} row={r} number={numbers.get(r.key) ?? ""} cur={cur} patchRow={patchRow} dropLocalRow={dropLocalRow} autoFocus={focusKey === r.key} dirty={dirty} siblings={looseRows} scopeId={loose?.id ?? null} />)}
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
              <Button type="button" variant="ghost" size="sm" disabled={pending || dirty || i === 0} onClick={() => move(i, -1)} aria-label={`Move section ${s.title} up`}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending || dirty || i === titled.length - 1} onClick={() => move(i, 1)} aria-label={`Move section ${s.title} down`}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending || dirty} onClick={() => { if (confirm(`Delete the section "${s.title}" and its ${secRows.length} item(s)?`)) run(() => deleteQuotationSection(p.ids.opportunityId, p.ids.proposalId, s.id)); }} aria-label={`Delete section ${s.title}`}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
            {secRows.length > 0 ? (
              <ul className="divide-y divide-border/70">
                {secRows.map((r) => <ItemRow key={r.key} p={p} row={r} number={numbers.get(r.key) ?? ""} cur={cur} patchRow={patchRow} dropLocalRow={dropLocalRow} autoFocus={focusKey === r.key} dirty={dirty} siblings={secRows} scopeId={s.id} />)}
              </ul>
            ) : <p className="px-3 py-3 text-sm text-muted-foreground">No items in this section yet.</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
              <Button type="button" variant="outline" size="sm" onClick={() => addRow(s.id)}><Plus className="h-4 w-4" aria-hidden /> Add item to this section</Button>
              <p className="text-sm tabular-nums">Section subtotal: <strong>{money(cs?.net, cur)}</strong> <span className="text-muted-foreground">excl. VAT · VAT {money(cs?.vat)} · incl. {money(cs?.gross)}</span></p>
            </div>
          </section>
        );
      })}
      {dirty ? <p className="text-sm text-muted-foreground">Save the draft before adding a section, deleting a section or moving things around.</p> : null}
      <AddSection ids={p.ids} disabled={dirty} />
    </div>
  );
}

function ItemRow({ p, row, number, cur, patchRow, dropLocalRow, autoFocus, dirty, siblings, scopeId }: {
  p: BuilderProps; row: RowState; number: string; cur: string; patchRow: (k: string, x: Partial<RowState>) => void; dropLocalRow: (k: string) => void; autoFocus: boolean; dirty: boolean;
  siblings: RowState[]; scopeId: string | null;
}) {
  const { run, pending, error } = useRun();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const issue = row.description || row.quantity || row.unitPrice ? rowIssue(row) : null;
  const savedLine = row.id ? p.lines.find((l) => l.id === row.id) : undefined;
  const idx = siblings.findIndex((x) => x.key === row.key);
  const label = number || "new item";
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
        <Button type="button" variant="ghost" size="sm" disabled={pending || dirty || idx <= 0 || !row.id} onClick={() => run(() => reorderQuotation(p.ids.opportunityId, p.ids.proposalId, "lines", scopeId, swap(siblings.map((x) => x.id!), idx, idx - 1)))} aria-label={`Move item ${label} up`}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending || dirty || idx === siblings.length - 1 || !row.id} onClick={() => run(() => reorderQuotation(p.ids.opportunityId, p.ids.proposalId, "lines", scopeId, swap(siblings.map((x) => x.id!), idx, idx + 1)))} aria-label={`Move item ${label} down`}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} aria-label={`Delete item ${label}`}
          onClick={() => { if (!row.id) return dropLocalRow(row.key); if (confirm(`Delete item ${label}?`)) run(() => deleteQuotationLine(p.ids.opportunityId, p.ids.proposalId, row.id!), () => dropLocalRow(row.key)); }}><Trash2 className="h-4 w-4" aria-hidden /></Button>
      </div>
      <div className="min-w-0 space-y-1 lg:col-start-2 lg:col-end-8">
        <ItemFigures p={p} row={row} cur={cur} />
        {issue ? <p className="text-sm text-destructive" role="status">{issue}</p> : null}
        {savedLine ? <LinePicture ids={p.ids} line={savedLine} url={p.imageUrls[savedLine.image_file_id ?? ""] ?? null} name={p.imageNames[savedLine.image_file_id ?? ""] ?? null} /> : <p className="text-sm text-muted-foreground">Save the draft to add a photo to this item.</p>}
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

function AddSection({ ids, disabled }: { ids: Ids; disabled: boolean }) {
  return (
    <ActionForm action={saveQuotationSection} submitLabel="Add section" resetOnSuccess disabled={disabled}>
      <input type="hidden" name="opportunityId" value={ids.opportunityId} />
      <input type="hidden" name="proposalId" value={ids.proposalId} />
      <Field label="Add a section (optional)" htmlFor="est-new-section" hint="Only if you want headings, for example Fabrication, AV or Installation. Items can stay without a section."><Input id="est-new-section" name="title" required maxLength={120} placeholder="e.g. Fabrication" autoComplete="off" /></Field>
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

/** The photo beside an item: upload through the existing CRM file flow (quarantine, server checks), then attach. */
function LinePicture({ ids, line, url, name }: { ids: Ids; line: QuotationLineRow; url: string | null; name: string | null }) {
  const { run, pending, error, setError } = useRun();
  const [phase, setPhase] = useState<string>("");
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    const problem = validateQuotationImageMeta({ name: file.name, size: file.size, type: file.type });
    if (problem) return setError(problem);
    try {
      setPhase("Checking…");
      const prepared = await prepareCrmUpload({ opportunityId: ids.opportunityId, name: file.name, size: file.size, type: file.type, purpose: "proposal", label: "Estimate item photo" });
      if (prepared.error !== null) return setError(prepared.error);
      setPhase("Uploading privately…");
      const { error: up } = await createClient().storage.from("crm-quarantine").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      if (up) return setError("The upload did not complete. Check your connection and try again.");
      setPhase("Checking the file's contents…");
      const done = await finalizeCrmUpload(prepared.intentId);
      if (done.error || !done.fileId) return setError(done.error ?? "The photo could not be added.");
      run(() => setQuotationLineImage(ids.opportunityId, ids.proposalId, line.id, line.section_id, done.fileId!));
    } catch {
      setError("Something went wrong while uploading. Try again.");
    } finally {
      setPhase("");
    }
  }
  return (
    <div className="space-y-1">
      {line.image_file_id ? (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt={name ? `Photo: ${name}` : "Item photo"} className="h-14 w-14 rounded border border-border object-contain" /> : null}
          <span className="text-sm text-muted-foreground">{name ?? "Photo attached"}</span>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setQuotationLineImage(ids.opportunityId, ids.proposalId, line.id, line.section_id, null))}>Remove photo</Button>
        </div>
      ) : (
        <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline">
          <ImagePlus className="h-4 w-4" aria-hidden /> Add photo
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} disabled={pending || !!phase} />
        </label>
      )}
      {phase ? <p className="text-sm text-muted-foreground" role="status">{phase}</p> : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Step 3: Preview & finalise
// ---------------------------------------------------------------------------------------------------------------------------------
const excerpt = (text: string, n = 180) => { const t = text.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t; };

function FinaliseStep({ p, details, notes, patchNotes, calc, cur, dirty, recipientChecked, setRecipientChecked }: {
  p: BuilderProps; details: DetailsState; notes: NotesState; patchNotes: (x: Partial<NotesState>) => void; calc: ReturnType<typeof liveCalc>["calc"]; cur: string; dirty: boolean;
  recipientChecked: boolean; setRecipientChecked: (v: boolean) => void;
}) {
  const { run, pending, error } = useRun();
  const [editing, setEditing] = useState(false);
  const recipient = [...p.parties, ...p.others].find((o) => o.id === details.billToOrgId);
  const vatLabel = p.vatChoices.find((v) => v.id === details.vatChoiceId)?.label;
  const items = calc.sections.reduce((n, s) => n + s.lines.length, 0);
  const assumptions = noteParagraphs(notes.assumptions);
  const nextSteps = noteParagraphs(notes.nextSteps);
  const blockers = [...(dirty ? ["Save the draft first: finalising uses what is saved."] : []), ...p.blockers];
  const canFinalise = blockers.length === 0 && recipientChecked && !pending;
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
            <p className="text-sm text-muted-foreground">Changes are kept in the draft; press Save draft to store them.</p>
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
        {blockers.length ? (
          <div>
            <p className="text-sm font-medium">Before this can be finalised</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        ) : <p className="text-sm text-muted-foreground">Everything needed to finalise is in place.</p>}
        {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={recipientChecked} onChange={(e) => setRecipientChecked(e.target.checked)} />
          <span>I have checked who this estimate is addressed to{recipient ? ` (${recipient.name})` : ""}, and the currency and VAT.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {p.needsApproval && !p.approvalPending ? (
            <Button type="button" variant="outline" disabled={pending || dirty} onClick={() => run(() => requestQuotationApproval(p.ids.opportunityId, p.ids.proposalId))}>Request approval</Button>
          ) : null}
          <Button type="button" disabled={!canFinalise} onClick={() => { if (confirm("Finalise this estimate? A frozen copy is made and this draft becomes read-only. Nothing is sent to anyone, and nothing is reserved or promised.")) run(() => issueQuotation(p.ids.opportunityId, p.ids.proposalId)); }}>Finalise estimate</Button>
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

