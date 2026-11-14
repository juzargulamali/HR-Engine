"use client";

import { useState } from "react";
import { saveEnquiryPlanning } from "@/lib/actions/operations";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { UpcomingRow } from "@/lib/operations/model";

/**
 * The Operations side of a flagged enquiry: provisional Project Manager, risk, capacity conflict and a question for Sales. Saving writes the planning row and a line in the
 * enquiry's history, where Sales reads it. The button reads "Name a provisional Project Manager" when that is the known next step, otherwise "Plan". It does not create a project, book anyone or reserve stock, and the dialog says so next to the field where that could be assumed.
 */
export function PlanningDialog({ row, people, label = "Plan", primary = false }: { row: UpcomingRow; people: { id: string; name: string }[]; label?: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [question, setQuestion] = useState(row.planning?.question ?? "");
  const close = () => { setOpen(false); setNotice(null); };
  const p = row.planning;
  return (
    <>
      <Button type="button" variant={primary ? "default" : "outline"} size="sm" onClick={() => setOpen(true)} data-testid={`ops-plan-${row.reference}`}>{label}</Button>
      <Modal open={open} onClose={close} title={`Plan ${row.reference}`} description="Sales sees this on the enquiry.">
        {notice ? (
          <div className="space-y-3"><Alert role="status">{notice}</Alert><Button type="button" onClick={close}>Close</Button></div>
        ) : (
          <ActionForm action={saveEnquiryPlanning} submitLabel="Save planning" onDone={(s) => { const n = (s as { notice?: string | null }).notice; if (n) setNotice(n); else close(); }}>
            <input type="hidden" name="opportunityId" value={row.id} />
            <input type="hidden" name="questionChanged" value={question.trim() !== (p?.question ?? "").trim() ? "1" : "0"} />
            <Field label="Provisional Project Manager" htmlFor="ops-pm" hint="Creates no project, books nobody and reserves no stock." help={<p>A note for planning. The real assignment happens on the handover once the enquiry is won.</p>}>
              <Select id="ops-pm" name="provisionalPmId" defaultValue={p?.provisional_pm_id ?? ""}>
                <option value="">Nobody yet</option>
                {people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Operational risk" htmlFor="ops-risk">
                <Select id="ops-risk" name="risk" defaultValue={p?.risk ?? "unknown"}>
                  <option value="unknown">Not assessed</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                </Select>
              </Field>
              <Field label="Why" htmlFor="ops-risk-note"><Input id="ops-risk-note" name="riskNote" maxLength={500} defaultValue={p?.risk_note ?? ""} /></Field>
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="capacityConflict" className="mt-1" defaultChecked={p?.capacity_conflict ?? false} /> Capacity conflict: this job clashes with other work</label>
            <Field label="What it clashes with" htmlFor="ops-capacity"><Input id="ops-capacity" name="capacityNote" maxLength={500} defaultValue={p?.capacity_note ?? ""} /></Field>
            <Field label="Ask Sales to confirm" htmlFor="ops-question" hint={p?.answer ? "Sales has answered. Changing the question clears that answer and asks again." : "Sales answers on the enquiry. No separate notice is sent."} help={<p>Sales sees the question on the enquiry, in its Operations planning panel and its history, and answers there.</p>}>
              <Textarea id="ops-question" name="question" rows={3} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)} />
            </Field>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
