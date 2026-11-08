"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { QUOTATION_CURRENCIES, validateQuotationImageMeta, type CalculatedQuotation, type PaymentMilestone } from "@enginious-hr/domain";
import {
  createQuotationRevision, deleteQuotationLine, deleteQuotationSection, issueQuotation, reorderQuotation, requestQuotationApproval, saveQuotationDetails,
  saveQuotationLine, saveQuotationSection, saveQuotationTerms, setQuotationLineImage,
} from "@/lib/actions/quotations";
import { finalizeCrmUpload, prepareCrmUpload } from "@/lib/actions/crmFiles";
import { createClient } from "@/lib/supabase/client";
import type { QuotationHeader, QuotationLineRow, QuotationSectionRow, VatChoiceRow } from "@/lib/crm/quotations/model";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
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

// ---------------------------------------------------------------------------------------------------------------------------------
// Details: bill-to, currency, VAT, validity, internal notes
// ---------------------------------------------------------------------------------------------------------------------------------
export function DetailsForm({ ids, header, vatChoices, enquiryParties, others }: { ids: Ids; header: QuotationHeader; vatChoices: VatChoiceRow[]; enquiryParties: OrgChoice[]; others: OrgChoice[] }) {
  const partyIds = new Set(enquiryParties.map((p) => p.id));
  return (
    <ActionForm action={saveQuotationDetails} submitLabel="Save details">
      <input type="hidden" name="opportunityId" value={ids.opportunityId} />
      <input type="hidden" name="proposalId" value={ids.proposalId} />
      <Field label="Bill to" htmlFor="q-billto" hint="You choose who is billed. Their name, place, country, VAT registration number / TRN and trade licence number are read from their account record and frozen when you issue.">
        <Select id="q-billto" name="billToOrgId" defaultValue={header.bill_to_org_id ?? ""}>
          <option value="">Not chosen yet</option>
          {enquiryParties.length ? <optgroup label="On this enquiry">{enquiryParties.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.detail})</option>)}</optgroup> : null}
          <optgroup label="Another organisation">{others.filter((o) => !partyIds.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup>
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Currency" htmlFor="q-currency" hint="One currency for the whole quotation.">
          <Select id="q-currency" name="currency" defaultValue={header.currency ?? ""}>
            <option value="">Not chosen yet</option>
            {QUOTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="VAT" htmlFor="q-vat" hint="Required before issuing. Not inferred from the client's country.">
          <Select id="q-vat" name="vatChoiceId" defaultValue={header.vat_choice_id ?? ""}>
            <option value="">Not chosen yet</option>
            {vatChoices.filter((v) => v.active || v.id === header.vat_choice_id).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Valid until (optional)" htmlFor="q-valid"><Input id="q-valid" name="validityDate" type="date" defaultValue={header.validity_date ?? ""} /></Field>
      </div>
      <Field label="Internal notes (never printed, never exported)" htmlFor="q-notes" hint="For your team only. Not part of the quotation the client receives.">
        <Textarea id="q-notes" name="internalNotes" rows={2} defaultValue={header.internal_notes ?? ""} />
      </Field>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sections and items
// ---------------------------------------------------------------------------------------------------------------------------------
const swap = <T,>(arr: T[], i: number, j: number) => { const a = [...arr]; [a[i], a[j]] = [a[j]!, a[i]!]; return a; };

export function SectionsEditor({ ids, header, sections, lines, calc, vatChoices, imageUrls, imageNames }: {
  ids: Ids; header: QuotationHeader; sections: QuotationSectionRow[]; lines: QuotationLineRow[]; calc: CalculatedQuotation; vatChoices: VatChoiceRow[];
  imageUrls: Record<string, string>; imageNames: Record<string, string>;
}) {
  const { run, pending, error } = useRun();
  const ordered = [...sections].sort((a, b) => a.position - b.position);
  const move = (i: number, d: -1 | 1) => run(() => reorderQuotation(ids.opportunityId, ids.proposalId, "sections", null, swap(ordered.map((s) => s.id), i, i + d)));
  const cur = header.currency ?? "";
  return (
    <div className="space-y-4">
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      {ordered.length === 0 ? <p className="text-sm text-muted-foreground">No sections yet. Add one (for example Fabrication, AV, Content, Software or Installation), then its items.</p> : null}
      {ordered.map((s, i) => {
        const cs = calc.sections.find((x) => x.id === s.id);
        const sectionLines = lines.filter((l) => l.section_id === s.id).sort((a, b) => a.position - b.position);
        return (
          <section key={s.id} aria-label={`Section ${s.title}`} className="rounded-lg border border-border">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/40 px-3 py-2">
              <h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{s.title}</h3>
              <RenameSection ids={ids} section={s} />
              <Button type="button" variant="ghost" size="sm" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label={`Move section ${s.title} up`}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending || i === ordered.length - 1} onClick={() => move(i, 1)} aria-label={`Move section ${s.title} down`}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { if (confirm(`Delete the section "${s.title}" and its ${sectionLines.length} item(s)?`)) run(() => deleteQuotationSection(ids.opportunityId, ids.proposalId, s.id)); }} aria-label={`Delete section ${s.title}`}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
            <ul className="divide-y divide-border/70">
              {sectionLines.map((l, li) => {
                const cl = cs?.lines.find((x) => x.id === l.id);
                return (
                  <li key={l.id} className="grid gap-2 px-3 py-3 sm:grid-cols-[2.5rem_1fr_auto]">
                    <span className="text-sm font-semibold tabular-nums" aria-label="Item number">{cl?.number ?? ""}</span>
                    <div className="min-w-0 space-y-1">
                      <p className="whitespace-pre-wrap break-words text-sm">{l.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {l.quantity}{l.unit ? ` ${l.unit}` : ""} × {money(String(l.unit_price))} · VAT: {cl?.vat ? cl.vat.label : "not chosen"}{l.vat_kind ? " (this item only)" : ""}
                      </p>
                      <LinePicture ids={ids} line={l} url={imageUrls[l.image_file_id ?? ""] ?? null} name={imageNames[l.image_file_id ?? ""] ?? null} />
                    </div>
                    <div className="space-y-1 text-right text-sm tabular-nums">
                      <p>{money(cl?.net, cur)} <span className="text-muted-foreground">excl. VAT</span></p>
                      <p className="text-muted-foreground">VAT {money(cl?.vatAmount)} · incl. {money(cl?.gross)}</p>
                      <div className="flex justify-end gap-1">
                        <Button type="button" variant="ghost" size="sm" disabled={pending || li === 0} onClick={() => run(() => reorderQuotation(ids.opportunityId, ids.proposalId, "lines", s.id, swap(sectionLines.map((x) => x.id), li, li - 1)))} aria-label={`Move item ${cl?.number} up`}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                        <Button type="button" variant="ghost" size="sm" disabled={pending || li === sectionLines.length - 1} onClick={() => run(() => reorderQuotation(ids.opportunityId, ids.proposalId, "lines", s.id, swap(sectionLines.map((x) => x.id), li, li + 1)))} aria-label={`Move item ${cl?.number} down`}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                        <LineDialog ids={ids} sectionId={s.id} line={l} vatChoices={vatChoices} />
                        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { if (confirm(`Delete item ${cl?.number}?`)) run(() => deleteQuotationLine(ids.opportunityId, ids.proposalId, l.id)); }} aria-label={`Delete item ${cl?.number}`}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
              <LineDialog ids={ids} sectionId={s.id} line={null} vatChoices={vatChoices} />
              <p className="text-sm tabular-nums">Section subtotal: <strong>{money(cs?.net, cur)}</strong> <span className="text-muted-foreground">excl. VAT · VAT {money(cs?.vat)} · incl. {money(cs?.gross)}</span></p>
            </div>
          </section>
        );
      })}
      <AddSection ids={ids} />
    </div>
  );
}

function AddSection({ ids }: { ids: Ids }) {
  return (
    <ActionForm action={saveQuotationSection} submitLabel="Add section" resetOnSuccess>
      <input type="hidden" name="opportunityId" value={ids.opportunityId} />
      <input type="hidden" name="proposalId" value={ids.proposalId} />
      <Field label="New section" htmlFor="q-new-section"><Input id="q-new-section" name="title" required maxLength={120} placeholder="e.g. Fabrication" autoComplete="off" /></Field>
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

function LineDialog({ ids, sectionId, line, vatChoices }: { ids: Ids; sectionId: string; line: QuotationLineRow | null; vatChoices: VatChoiceRow[] }) {
  const [open, setOpen] = useState(false);
  const k = line?.id ?? `new-${sectionId}`;
  return (
    <>
      {line ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Edit item"><Pencil className="h-4 w-4" aria-hidden /></Button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Add item</Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} size="wide" title={line ? "Edit item" : "Add item"} description="The item number is automatic and follows the order of the items. Amounts are calculated for you.">
        <ActionForm action={saveQuotationLine} submitLabel={line ? "Save item" : "Add item"} onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="opportunityId" value={ids.opportunityId} />
          <input type="hidden" name="proposalId" value={ids.proposalId} />
          <input type="hidden" name="sectionId" value={sectionId} />
          <input type="hidden" name="lineId" value={line?.id ?? ""} />
          <Field label="Description" htmlFor={`ld-${k}`}><Textarea id={`ld-${k}`} name="description" rows={4} required maxLength={4000} defaultValue={line?.description ?? ""} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Unit (optional)" htmlFor={`lu-${k}`}><Input id={`lu-${k}`} name="unit" maxLength={20} defaultValue={line?.unit ?? ""} placeholder="e.g. m2, set, day" /></Field>
            <Field label="Quantity" htmlFor={`lq-${k}`}><Input id={`lq-${k}`} name="quantity" required inputMode="decimal" defaultValue={line ? String(line.quantity) : ""} placeholder="1" /></Field>
            <Field label="Unit selling price" htmlFor={`lp-${k}`}><Input id={`lp-${k}`} name="unitPrice" required inputMode="decimal" defaultValue={line ? String(line.unit_price) : ""} placeholder="0.00" /></Field>
          </div>
          <Field label="VAT for this item" htmlFor={`lv-${k}`} hint="Leave as the quotation's VAT unless this item is different.">
            <Select id={`lv-${k}`} name="vatChoiceId" defaultValue={line?.vat_choice_id ?? ""}>
              <option value="">Same as the quotation</option>
              {vatChoices.filter((v) => v.active || v.id === line?.vat_choice_id).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </Select>
          </Field>
          <p className="text-sm text-muted-foreground">{line ? "The picture is changed from the item in the list." : "Add the picture after the item is saved."}</p>
        </ActionForm>
      </Modal>
    </>
  );
}

/** The picture shown beside an item: upload through the existing CRM file flow (quarantine, server checks), then attach. */
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
      const prepared = await prepareCrmUpload({ opportunityId: ids.opportunityId, name: file.name, size: file.size, type: file.type, purpose: "proposal", label: "Quotation item picture" });
      if (prepared.error !== null) return setError(prepared.error);
      setPhase("Uploading privately…");
      const { error: up } = await createClient().storage.from("crm-quarantine").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      if (up) return setError("The upload did not complete. Check your connection and try again.");
      setPhase("Checking the file's contents…");
      const done = await finalizeCrmUpload(prepared.intentId);
      if (done.error || !done.fileId) return setError(done.error ?? "The picture could not be added.");
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
          {url ? <img src={url} alt={name ? `Picture: ${name}` : "Item picture"} className="h-14 w-14 rounded border border-border object-cover" /> : null}
          <span className="text-sm text-muted-foreground">{name ?? "Picture attached"}</span>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setQuotationLineImage(ids.opportunityId, ids.proposalId, line.id, line.section_id, null))}>Remove picture</Button>
        </div>
      ) : (
        <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline">
          <ImagePlus className="h-4 w-4" aria-hidden /> Add picture
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} disabled={pending || !!phase} />
        </label>
      )}
      {phase ? <p className="text-sm text-muted-foreground" role="status">{phase}</p> : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Payment milestones and terms
// ---------------------------------------------------------------------------------------------------------------------------------
export function TermsEditor({ ids, header }: { ids: Ids; header: QuotationHeader }) {
  const [ms, setMs] = useState<PaymentMilestone[]>(header.milestones);
  const [cl, setCl] = useState(header.terms);
  const upd = <T,>(set: (f: (a: T[]) => T[]) => void, i: number, patch: Partial<T>) => set((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <ActionForm action={saveQuotationTerms} submitLabel="Save milestones and terms">
      <input type="hidden" name="opportunityId" value={ids.opportunityId} />
      <input type="hidden" name="proposalId" value={ids.proposalId} />
      <input type="hidden" name="termsLabel" value={header.terms_label ?? ""} />
      <input type="hidden" name="milestones" value={JSON.stringify(ms)} />
      <input type="hidden" name="clauses" value={JSON.stringify(cl)} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Payment milestones</legend>
        <p className="text-sm text-muted-foreground">Percentages must add up to 100, or amounts to the total including VAT. Leave empty for no schedule.</p>
        {ms.map((m, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_7rem_6rem_1fr_auto]">
            <Input aria-label={`Milestone ${i + 1} label`} placeholder="e.g. Deposit" value={m.label} onChange={(e) => upd(setMs, i, { label: e.target.value })} />
            <Select aria-label={`Milestone ${i + 1} type`} value={m.kind} onChange={(e) => upd(setMs, i, { kind: e.target.value as "percent" | "amount" })}><option value="percent">Percent</option><option value="amount">Amount</option></Select>
            <Input aria-label={`Milestone ${i + 1} value`} inputMode="decimal" placeholder={m.kind === "percent" ? "40" : "0.00"} value={m.value} onChange={(e) => upd(setMs, i, { value: e.target.value })} />
            <Input aria-label={`Milestone ${i + 1} due`} placeholder="Due, e.g. on acceptance" value={m.due ?? ""} onChange={(e) => upd(setMs, i, { due: e.target.value })} />
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove milestone ${i + 1}`} onClick={() => setMs((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setMs((a) => [...a, { label: "", kind: a[0]?.kind ?? "percent", value: "", due: "" }])}><Plus className="h-4 w-4" aria-hidden /> Add milestone</Button>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{header.terms_label ?? "Terms, assumptions and exclusions"}</legend>
        <p className="text-sm text-muted-foreground">Copied from your company&apos;s standard terms when this estimate was created. Edit freely here; the company template is changed under Sales settings.</p>
        {cl.map((c, i) => (
          <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
            <div className="flex gap-2">
              <Input aria-label={`Clause ${i + 1} title`} value={c.title} onChange={(e) => upd(setCl, i, { title: e.target.value })} />
              <Button type="button" variant="ghost" size="sm" disabled={i === 0} aria-label={`Move clause ${i + 1} up`} onClick={() => setCl((a) => swap(a, i, i - 1))}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
              <Button type="button" variant="ghost" size="sm" disabled={i === cl.length - 1} aria-label={`Move clause ${i + 1} down`} onClick={() => setCl((a) => swap(a, i, i + 1))}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove clause ${i + 1}`} onClick={() => setCl((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
            <Textarea aria-label={`Clause ${i + 1} text`} rows={3} value={c.body} onChange={(e) => upd(setCl, i, { body: e.target.value })} />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setCl((a) => [...a, { title: "", body: "" }])}><Plus className="h-4 w-4" aria-hidden /> Add clause</Button>
      </fieldset>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Request approval, issue, revise
// ---------------------------------------------------------------------------------------------------------------------------------
export function IssueBar({ ids, blockers, needsApproval, approvalPending, canRequestApproval }: { ids: Ids; blockers: string[]; needsApproval: boolean; approvalPending: boolean; canRequestApproval: boolean }) {
  const { run, pending, error } = useRun();
  const nonApproval = blockers.filter((b) => !/founder's approval/.test(b));
  return (
    <div className="space-y-3">
      {blockers.length ? (
        <div>
          <p className="text-sm font-medium">Before this can be issued</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      ) : <p className="text-sm text-muted-foreground">Everything needed to issue is in place.</p>}
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {needsApproval && !approvalPending && canRequestApproval ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => requestQuotationApproval(ids.opportunityId, ids.proposalId))}>Request founder approval</Button>
        ) : null}
        <Button type="button" disabled={pending || blockers.length > 0} onClick={() => { if (confirm("Issue this quotation? A frozen copy is made and this draft becomes read-only. Nothing is sent to anyone.")) run(() => issueQuotation(ids.opportunityId, ids.proposalId)); }}>Issue quotation</Button>
      </div>
      {nonApproval.length === 0 && needsApproval && blockers.length > 0 ? <p className="text-sm text-muted-foreground">Issuing needs the founder&apos;s approval first; editing the draft after approval asks for it again.</p> : null}
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

