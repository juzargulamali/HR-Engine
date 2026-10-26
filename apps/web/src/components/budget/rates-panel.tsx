"use client";

import { useState } from "react";
import { RATE_KEYS, RATE_LABELS_BY_KEY, moneyText, suggestedRate, type RateKey } from "@enginious-hr/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/projects/parts";
import { addBudgetCategory, setBudgetRate } from "@/lib/actions/projectBudget";
import type { PbxBudgetView } from "@/types/budget";
import { ActionMessage, Field, cleanDecimal, useAction } from "./shared";

function RateRow({ view, rateKey }: { view: PbxBudgetView; rateKey: RateKey }) {
  const currency = view.budget?.currency ?? view.default_currency ?? "AED";
  const current = view.rates.find((r) => r.rate_key === rateKey)?.amount ?? null;
  const suggestion = current === null ? suggestedRate(currency, rateKey) : null;
  const [amount, setAmount] = useState(current === null ? "" : String(current));
  const a = useAction();
  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_auto] sm:items-end"
      onSubmit={(e) => { e.preventDefault(); a.run(() => setBudgetRate({ projectId: view.project.id, companyId: view.project.company_id, currency, rateKey, amount }), undefined, "Rate saved."); }}
    >
      <div className="text-sm">
        <div className="font-medium">{RATE_LABELS_BY_KEY[rateKey]} ({currency})</div>
        <div className="text-[13px] text-muted-foreground">
          {current !== null ? `Confirmed: ${moneyText(current, currency)}` : suggestion !== null ? `Not confirmed yet. Project Managers are only offered ${moneyText(suggestion, currency)} as a suggestion.` : `No rate set for ${currency}. Project Managers type their own figure.`}
        </div>
      </div>
      <Field label="New rate" htmlFor={`rate-${rateKey}`}><Input id={`rate-${rateKey}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanDecimal(e.target.value))} /></Field>
      <div className="space-y-1">
        <Button type="submit" variant="outline" disabled={a.pending || amount === ""}>{a.pending ? "Saving…" : current === null ? "Confirm rate" : "Change rate"}</Button>
      </div>
      <div className="sm:col-span-3"><ActionMessage error={a.error} notice={a.notice} /></div>
    </form>
  );
}

function AddCategory({ view }: { view: PbxBudgetView }) {
  const a = useAction();
  const [label, setLabel] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); a.run(() => addBudgetCategory({ projectId: view.project.id, companyId: view.project.company_id, label }), () => setLabel(""), "Category added.") }}>
      <Field label="Add an expense category for this company" htmlFor="pbx-newcat" hint="The six standard categories are always there. Add another only when it will be used again."><Input id="pbx-newcat" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} /></Field>
      <Button type="submit" variant="outline" disabled={a.pending || label.trim().length < 2}>{a.pending ? "Adding…" : "Add category"}</Button>
      <div className="basis-full"><ActionMessage error={a.error} notice={a.notice} /></div>
    </form>
  );
}

/** Finance only: the company's petrol and meal rates for the budget's currency, and extra categories. A rate set for one currency is never used for another. */
export function RatesPanel({ view }: { view: PbxBudgetView }) {
  if (!view.viewer.is_finance) return null;
  const currency = view.budget?.currency ?? view.default_currency ?? "AED";
  return (
    <Panel title={`Company rates and categories (${view.project.company_name ?? "this company"}, ${currency})`} description="Used to fill in new budget lines. A rate you set for one currency is never applied to another.">
      <div className="space-y-4">
        {RATE_KEYS.map((k) => <RateRow key={`${k}:${currency}`} view={view} rateKey={k} />)}
        <AddCategory view={view} />
      </div>
    </Panel>
  );
}
