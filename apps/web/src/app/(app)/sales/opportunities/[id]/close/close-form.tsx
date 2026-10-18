"use client";

import { useState } from "react";
import Link from "next/link";
import { markLost, markWon } from "@/lib/actions/crm";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { cn } from "@/lib/utils";
import { composeReason, OTHER_LOST_REASON } from "../helpers";

export interface CloseFormProps {
  opportunityId: string;
  version: number;
  initialOutcome: "won" | "lost";
  /** The opportunity is on hold: it can be marked Lost but not Won until resumed (the database refuses Won). */
  onHold: boolean;
  valueText: string;
  hasValue: boolean;
  openFollowUps: number;
  today: string;
  lostReasons: readonly string[];
  evidenceTypes: readonly { id: string; label: string }[];
}

const Step = ({ children }: { children: React.ReactNode }) => <li className="break-words">{children}</li>;

/**
 * Won and Lost on one page, with a clear choice. Won needs evidence (a purchase order or authorised email, its reference
 * and its date) and a value; Lost needs a reason. The page says what will happen before anything is confirmed.
 */
export function CloseForm(p: CloseFormProps) {
  const [outcome, setOutcome] = useState<"won" | "lost">(p.onHold ? "lost" : p.initialOutcome);
  const [evidenceType, setEvidenceType] = useState(p.evidenceTypes[0]?.id ?? "purchase_order");
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const followUpText = p.openFollowUps === 0 ? "There are no open follow-ups to cancel." : `${p.openFollowUps} open follow-up${p.openFollowUps === 1 ? " is" : "s are"} cancelled.`;
  const lostReason = choice === "" ? "" : composeReason(choice, note, OTHER_LOST_REASON);
  const back = (
    <Link href={`/sales/opportunities/${p.opportunityId}`} className={cn(buttonVariants({ variant: "ghost" }))}>Cancel</Link>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card className="p-4">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Outcome</legend>
            <div className="flex flex-wrap gap-3">
              {(["won", "lost"] as const).map((o) => {
                const disabled = o === "won" && p.onHold;
                return (
                  <label key={o} className={cn("flex min-w-[9rem] items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer", outcome === o ? "border-accent bg-accent/10" : "border-border")}>
                    <input type="radio" name="outcome" value={o} checked={outcome === o} disabled={disabled} onChange={() => setOutcome(o)} />
                    {o === "won" ? "Won" : "Lost"}
                  </label>
                );
              })}
            </div>
            {p.onHold ? <p className="mt-2 text-sm text-muted-foreground">This opportunity is on hold. Resume it first if it has been won; it can be marked Lost directly.</p> : null}
          </fieldset>
        </Card>

        {outcome === "won" ? (
          <Card className="p-4">
            <h2 className="mb-1 text-sm font-semibold">Evidence of the win</h2>
            <p className="mb-4 text-sm text-muted-foreground">Winning needs a purchase order or an authorised email. A sent or accepted proposal, or an equipment check, is not enough.</p>
            <div className="mb-4 rounded-md border border-border p-3 text-sm">
              <p className="text-sm text-muted-foreground">Confirmed value</p>
              <p className="font-medium">{p.valueText}</p>
              {!p.hasValue ? (
                <Alert className="mt-2" variant="warning">
                  The value must be set before it can be marked Won. <Link href={`/sales/opportunities/${p.opportunityId}?tab=scope`} className="font-medium underline">Go to the opportunity and use Edit details</Link>, then come back.
                </Alert>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">This is the value that will be recorded as won. Wrong? <Link href={`/sales/opportunities/${p.opportunityId}?tab=scope`} className="font-medium underline">Edit it first</Link>.</p>
              )}
            </div>
            <ActionForm action={markWon} submitLabel="Confirm as won" pendingLabel="Saving…" secondary={back}>
              <input type="hidden" name="id" value={p.opportunityId} />
              <input type="hidden" name="expectedVersion" value={p.version} />
              <Field label="Type of confirmation" htmlFor="won-type">
                <Select id="won-type" name="evidenceType" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
                  {p.evidenceTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              </Field>
              <Field label={evidenceType === "purchase_order" ? "PO number" : "Email reference (sender and subject)"} htmlFor="won-ref">
                <Input id="won-ref" name="evidenceReference" required />
              </Field>
              <Field label="Date on the document" htmlFor="won-date" hint="Not in the future.">
                <Input id="won-date" name="evidenceDate" type="date" required max={p.today} />
              </Field>
              <Field label="Note (optional)" htmlFor="won-note"><Textarea id="won-note" name="note" rows={2} /></Field>
              <p className="text-sm text-muted-foreground">Add the purchase order or the email itself under Files (purpose: Purchase order or Authorised email) so the document is kept with the reference. <Link href={`/sales/opportunities/${p.opportunityId}?tab=proposals`} className="font-medium underline">Open Files</Link></p>
              {!p.hasValue ? <Alert variant="destructive">Set the value first: the database will not record a win without one.</Alert> : null}
            </ActionForm>
          </Card>
        ) : (
          <Card className="p-4">
            <h2 className="mb-4 text-sm font-semibold">Why was it lost?</h2>
            <ActionForm action={markLost} submitLabel="Confirm as lost" pendingLabel="Saving…" variant="destructive" secondary={back}>
              <input type="hidden" name="id" value={p.opportunityId} />
              <input type="hidden" name="expectedVersion" value={p.version} />
              <input type="hidden" name="reason" value={lostReason} />
              <Field label="Reason" htmlFor="lost-reason">
                <Select id="lost-reason" value={choice} onChange={(e) => setChoice(e.target.value)} required>
                  <option value="">Choose a reason…</option>
                  {p.lostReasons.map((r) => <option key={r} value={r}>{r}</option>)}
                  <option value={OTHER_LOST_REASON}>{OTHER_LOST_REASON}</option>
                </Select>
              </Field>
              <Field label={choice === OTHER_LOST_REASON ? "Reason in your own words (required)" : "Note (optional)"} htmlFor="lost-note">
                <Textarea id="lost-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} required={choice === OTHER_LOST_REASON} />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>

      <aside aria-label="What will happen" className="space-y-4">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">{outcome === "won" ? "If you confirm as won" : "If you confirm as lost"}</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {outcome === "won" ? (
              <>
                <Step>The stage becomes Won and the evidence (type, reference and date) is recorded on the opportunity.</Step>
                <Step>{followUpText}</Step>
                <Step>A Sales handover draft is created for the Project Manager. Delivery starts later, when you submit the project handover and the Project Manager accepts it.</Step>
                <Step>Afterwards only the handover, files, proposal acceptance and (for founders) the value can change.</Step>
              </>
            ) : (
              <>
                <Step>The stage becomes Lost and the reason is kept for reporting.</Step>
                <Step>{followUpText}</Step>
                <Step>The opportunity becomes read-only. It cannot be reopened from here.</Step>
              </>
            )}
          </ul>
        </Card>
        <p className="text-sm text-muted-foreground">Only the owner or a founder can do this. It is recorded in the history. Nothing is sent to anyone.</p>
      </aside>
    </div>
  );
}
