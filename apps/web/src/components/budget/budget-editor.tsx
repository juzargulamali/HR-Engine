"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  ACTIVITIES, ACTIVITY_LABELS, BASIS_FIELDS, BASIS_LABELS, BUDGET_BASES, DEFAULT_CATEGORIES, QTY_LABELS, RATE_LABELS, RATE_LABELS_BY_KEY, inclusiveDays, moneyText, rowTotal, suggestedRate, sumMoney,
  type BudgetActivity, type BudgetBasis, type RateKey,
} from "@enginious-hr/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveBudgetDraft, submitBudget, discardDraft } from "@/lib/actions/projectBudget";
import type { PbxBudgetView, PbxVersion } from "@/types/budget";
import { ActionMessage, Field, cleanDecimal, money, useAction } from "./shared";

interface DraftRow {
  key: string;
  category_id: string;
  date_from: string;
  date_to: string;
  activity: BudgetActivity;
  description: string;
  basis: BudgetBasis;
  people: string;
  days: string;
  qty: string;
  rate: string;
  fixed: string;
  rate_key: RateKey | "";
}

const asText = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
let seq = 0;
const newKey = () => `r${++seq}`;

function fromVersion(v: PbxVersion): DraftRow[] {
  return v.rows.map((r) => ({
    key: newKey(), category_id: r.category_id ?? "", date_from: r.date_from ?? "", date_to: r.date_to ?? "", activity: r.activity, description: r.description, basis: r.basis,
    people: asText(r.people), days: asText(r.days), qty: asText(r.qty), rate: asText(r.rate), fixed: asText(r.fixed), rate_key: (r.rate_key as RateKey | null) ?? "",
  }));
}

const FIELD_LABEL: Record<"people" | "days", string> = { people: "People", days: "Days" };

/**
 * The draft budget of one version: lines grouped under Food, Transport, Contractor badges / access, Accommodation, Truck / logistics and Other, each with the
 * fields its calculation basis needs and nothing else. The total of every line, every category and the whole budget is shown as you type, using the same
 * rules as the database (@enginious-hr/domain rowTotal); what is stored is always the database's own figure.
 */
export function BudgetEditor({ view, version }: { view: PbxBudgetView; version: PbxVersion }) {
  const currency = view.budget!.currency;
  const [rows, setRows] = useState<DraftRow[]>(() => fromVersion(version));
  const [periodStart, setPeriodStart] = useState(version.period_start ?? "");
  const [periodEnd, setPeriodEnd] = useState(version.period_end ?? "");
  const [people, setPeople] = useState<string[]>(() => version.people.map((p) => p.id));
  const [note, setNote] = useState(version.note ?? "");
  const [rv, setRv] = useState(version.row_version);
  const [dirty, setDirty] = useState(false);
  const save = useAction();
  const submit = useAction();
  const discard = useAction();
  const busy = save.pending || submit.pending || discard.pending;

  const rate = (key: RateKey): number | null => view.rates.find((r) => r.rate_key === key)?.amount ?? null;
  const touch = () => setDirty(true);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const categories = view.categories;
  const groups = useMemo(() => {
    const order = [...DEFAULT_CATEGORIES.map((c) => c.key), ...categories.filter((c) => !DEFAULT_CATEGORIES.some((d) => d.key === c.key)).map((c) => c.key)];
    return order.map((k) => categories.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c);
  }, [categories]);

  const totals = rows.map((r) => rowTotal({ basis: r.basis, people: r.people, days: r.days, qty: r.qty, rate: r.rate, fixed: r.fixed }, currency));
  const grand = sumMoney(totals, currency);
  const incomplete = rows.filter((_, i) => totals[i] === null).length;

  const update = (key: string, patch: Partial<DraftRow>) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); touch(); };
  const addRow = (category_id: string) => {
    const cat = categories.find((c) => c.id === category_id);
    const meal = cat?.key === "food";
    setRows((rs) => [...rs, { key: newKey(), category_id, date_from: "", date_to: "", activity: "other", description: "", basis: meal ? "per_person_day" : "fixed", people: "", days: "", qty: "", rate: "", fixed: "", rate_key: "" }]);
    touch();
  };
  const remove = (key: string) => { setRows((rs) => rs.filter((r) => r.key !== key)); touch(); };

  const payloadRows = () => rows.map((r) => ({
    category_id: r.category_id, date_from: r.date_from || null, date_to: r.date_to || null, activity: r.activity, description: r.description, basis: r.basis,
    people: r.people || null, days: r.days || null, qty: r.qty || null, rate: r.rate || null, fixed: r.fixed || null, rate_key: r.rate_key || null,
  }));
  const base = { projectId: view.project.id, versionId: version.id, periodStart: periodStart || null, periodEnd: periodEnd || null, people, note: note || null };

  const doSave = () => save.run(() => saveBudgetDraft({ ...base, expected: rv, rows: payloadRows() }), (r) => { if (r.version !== undefined) setRv(r.version); setDirty(false); }, "Draft saved.");
  const doSubmit = () =>
    submit.run(async () => {
      const saved = await saveBudgetDraft({ ...base, expected: rv, rows: payloadRows() });
      if (saved.error) return saved;
      const v = saved.version ?? rv;
      setRv(v);
      return submitBudget({ projectId: view.project.id, versionId: version.id, expected: v, requestId: submit.getRequestId() });
    }, () => setDirty(false), "Submitted to Finance.");

  const isAddition = version.kind === "addition";
  const empty = rows.length === 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Expense period starts" htmlFor="pbx-ps"><Input id="pbx-ps" type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); touch(); }} /></Field>
        <Field label="Expense period ends" htmlFor="pbx-pe" hint="Changing this does not change the project's own dates."><Input id="pbx-pe" type="date" value={periodEnd} min={periodStart || undefined} onChange={(e) => { setPeriodEnd(e.target.value); touch(); }} /></Field>
        <div className="sm:col-span-2">
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">People this budget covers</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-border p-2.5">
              {view.people.map((p) => (
                <label key={p.id} className="flex min-h-8 items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={people.includes(p.id)} onChange={(e) => { setPeople((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id))); touch(); }} />
                  {p.name}{p.role === "pm" ? " (Project Manager)" : ""}
                </label>
              ))}
              {view.people.length === 0 ? <span className="text-sm text-muted-foreground">No project members yet.</span> : null}
            </div>
          </fieldset>
        </div>
      </div>

      {groups.map((cat) => {
        const mine = rows.filter((r) => r.category_id === cat.id);
        const sub = sumMoney(mine.map((r) => totals[rows.indexOf(r)]), currency);
        return (
          <section key={cat.id} aria-labelledby={`cat-${cat.id}`} className="rounded-lg border border-border">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary/40 px-3 py-2">
              <h3 id={`cat-${cat.id}`} className="text-sm font-semibold">{cat.label}</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-muted-foreground">{mine.length > 0 ? `Subtotal ${moneyText(sub, currency)}` : "No lines"}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => addRow(cat.id)} disabled={busy}><Plus className="h-4 w-4" aria-hidden />Add line<span className="sr-only"> to {cat.label}</span></Button>
              </div>
            </header>
            {mine.length > 0 ? (
              <ul className="divide-y divide-border">
                {mine.map((r) => (
                  <li key={r.key} className="p-3">
                    <RowFields row={r} currency={currency} total={totals[rows.indexOf(r)] ?? null} petrol={rate("petrol_per_km")} meal={rate("meal_per_person")} disabled={busy} onChange={(p) => update(r.key, p)} onRemove={() => remove(r.key)} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}

      <Field label={isAddition ? "Why is more budget needed? (shown to Finance)" : "Note for Finance (optional)"} htmlFor="pbx-note">
        <Textarea id="pbx-note" rows={3} maxLength={2000} value={note} onChange={(e) => { setNote(e.target.value); touch(); }} />
      </Field>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{isAddition ? "Requested additional budget" : "Total budget"}</div>
          <div className="font-heading text-xl font-semibold tabular-nums">{money(grand, currency)}</div>
          {incomplete > 0 ? <div className="text-[13px] text-[hsl(var(--os-amber))]">{incomplete} line{incomplete === 1 ? "" : "s"} still need a number (not counted yet).</div> : null}
          {dirty ? <div className="text-[13px] text-muted-foreground">Unsaved changes</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => { if (window.confirm("Discard this draft? Nothing here will be kept.")) discard.run(() => discardDraft({ projectId: view.project.id, versionId: version.id })); }} disabled={busy}>Discard draft</Button>
          <Button type="button" variant="outline" onClick={doSave} disabled={busy}>{save.pending ? "Saving…" : "Save draft"}</Button>
          <Button type="button" onClick={doSubmit} disabled={busy || empty || incomplete > 0} title={empty ? "Add at least one line" : incomplete > 0 ? "Finish every line first" : undefined}>
            {submit.pending ? "Submitting…" : isAddition ? "Submit request to Finance" : "Submit to Finance"}
          </Button>
        </div>
      </div>
      <div className="space-y-1" aria-live="polite">
        <ActionMessage error={save.error ?? submit.error ?? discard.error} notice={save.notice ?? submit.notice} />
      </div>
    </div>
  );
}

function RowFields({ row, currency, total, petrol, meal, disabled, onChange, onRemove }: {
  row: DraftRow; currency: string; total: number | null; petrol: number | null; meal: number | null; disabled: boolean; onChange: (p: Partial<DraftRow>) => void; onRemove: () => void;
}) {
  const fields = BASIS_FIELDS[row.basis];
  const id = row.key;
  const span = inclusiveDays(row.date_from, row.date_to);
  const suggestPetrol = row.basis === "per_km" ? (petrol !== null ? { value: petrol, confirmed: true } : suggestedRate(currency, "petrol_per_km") !== null ? { value: suggestedRate(currency, "petrol_per_km")!, confirmed: false } : null) : null;
  const mealCapable = row.basis === "per_person" || row.basis === "per_person_day";
  const suggestMeal = mealCapable ? (meal !== null ? { value: meal, confirmed: true } : suggestedRate(currency, "meal_per_person") !== null ? { value: suggestedRate(currency, "meal_per_person")!, confirmed: false } : null) : null;
  const rateKey: RateKey | null = suggestPetrol ? "petrol_per_km" : suggestMeal ? "meal_per_person" : null;
  const sug = suggestPetrol ?? suggestMeal;
  const configured = row.rate_key === "petrol_per_km" ? petrol : row.rate_key === "meal_per_person" ? meal : null;
  const differs = row.rate_key && configured !== null && row.rate !== "" && Number(row.rate) !== configured;

  const setBasis = (basis: BudgetBasis) => onChange({ basis, rate_key: basis === "per_km" || basis === "per_person" || basis === "per_person_day" ? row.rate_key : "" });

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Description" htmlFor={`${id}-d`}><Input id={`${id}-d`} value={row.description} maxLength={300} placeholder="For example: Lunch for the install team" disabled={disabled} onChange={(e) => onChange({ description: e.target.value })} /></Field>
        <Field label="Activity" htmlFor={`${id}-a`}>
          <Select id={`${id}-a`} value={row.activity} disabled={disabled} onChange={(e) => onChange({ activity: e.target.value as BudgetActivity })}>
            {ACTIVITIES.map((a) => <option key={a} value={a}>{ACTIVITY_LABELS[a]}</option>)}
          </Select>
        </Field>
        <Field label="How is it calculated?" htmlFor={`${id}-b`}>
          <Select id={`${id}-b`} value={row.basis} disabled={disabled} onChange={(e) => setBasis(e.target.value as BudgetBasis)}>
            {BUDGET_BASES.map((b) => <option key={b} value={b}>{BASIS_LABELS[b]}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
        <Field label={row.basis === "fixed" ? "Date, or first day" : "First day"} htmlFor={`${id}-f`}><Input id={`${id}-f`} type="date" value={row.date_from} disabled={disabled} onChange={(e) => onChange({ date_from: e.target.value })} /></Field>
        <Field label="Last day (if a range)" htmlFor={`${id}-t`}><Input id={`${id}-t`} type="date" value={row.date_to} min={row.date_from || undefined} disabled={disabled} onChange={(e) => onChange({ date_to: e.target.value })} /></Field>
        {fields.map((f) => {
          const label = f === "people" || f === "days" ? FIELD_LABEL[f] : f === "qty" ? QTY_LABELS[row.basis] ?? "Quantity" : f === "rate" ? RATE_LABELS[row.basis] : "Total amount";
          return (
            <Field key={f} label={f === "rate" || f === "fixed" ? `${label} (${currency})` : label} htmlFor={`${id}-${f}`}
              hint={f === "days" && span !== null && row.days === "" ? undefined : f === "fixed" ? "Covers the whole period; it is never multiplied by days." : undefined}>
              <Input id={`${id}-${f}`} inputMode="decimal" value={row[f]} disabled={disabled} onChange={(e) => onChange({ [f]: cleanDecimal(e.target.value) } as Partial<DraftRow>)} />
            </Field>
          );
        })}
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <div className="text-right">
            <div className="text-[13px] text-muted-foreground">Line total</div>
            <div className="font-semibold tabular-nums" data-testid="line-total">{total === null ? "—" : money(total, currency)}</div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled} aria-label={`Remove the line ${row.description || "without a description"}`}><Trash2 className="h-4 w-4" aria-hidden /></Button>
        </div>
      </div>
      {fields.includes("days") && span !== null && row.days === "" ? (
        <p className="text-[13px] text-muted-foreground">These dates cover {span} day{span === 1 ? "" : "s"}. <button type="button" className="font-medium underline underline-offset-2" onClick={() => onChange({ days: String(span) })}>Use {span}</button></p>
      ) : null}
      {sug && rateKey && row.rate === "" ? (
        <p className="text-[13px] text-muted-foreground">
          {sug.confirmed ? `Company rate: ${RATE_LABELS_BY_KEY[rateKey]} ${moneyText(sug.value, currency)}.` : `Suggested ${RATE_LABELS_BY_KEY[rateKey].toLowerCase()} ${moneyText(sug.value, currency)} — not yet confirmed by Finance.`}{" "}
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => onChange({ rate: String(sug.value), rate_key: sug.confirmed ? rateKey : "" })}>Use {sug.value}</button>
        </p>
      ) : null}
      {differs ? <p className="text-[13px] text-[hsl(var(--os-amber))]">Differs from the company rate ({moneyText(configured!, currency)}). Finance will see both.</p> : null}
    </div>
  );
}
