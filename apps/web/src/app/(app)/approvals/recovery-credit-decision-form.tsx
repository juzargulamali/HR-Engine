"use client";

import { useState, useTransition } from "react";
import { adjustRecoveryCreditRequest, decideRecoveryCreditRequest } from "@/lib/actions/recoveryCredit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";

/**
 * The single HR decision screen for a Recovery Leave credit — replaces the
 * old two-step manager-then-HR DecisionButtons flow. HR can:
 *   1. Correct the work date/hours (adjust_recovery_credit_request() —
 *      requires a reason whenever it actually changes something; the
 *      ORIGINAL Jibble/manual values below never change).
 *   2. Record whom they checked the work with (required before Approve —
 *      the product brief: verify with the relevant project lead outside
 *      the application first; that person is never an app user/approver).
 *   3. Approve or reject.
 * Any current HR Admin in the company may open and decide this — it's a
 * shared queue, not assigned to one specific person (see
 * decide_leave_approval()'s null-approver_id branch in schema.sql) —
 * concurrent decisions are still safe: the underlying RPC locks the row and
 * a second HR Admin's decide call after the first one commits fails with
 * "already been decided" instead of double-posting the ledger.
 */
export function RecoveryCreditDecisionForm({
  requestId,
  originalWorkDate,
  originalHours,
  currentWorkDate,
  currentDays,
  wasCorrected,
}: {
  requestId: string;
  originalWorkDate: string;
  originalHours: number | null;
  currentWorkDate: string;
  currentDays: number;
  wasCorrected: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [workDate, setWorkDate] = useState(currentWorkDate);
  const [hours, setHours] = useState(originalHours != null ? String(originalHours) : "");
  const [reason, setReason] = useState("");
  const [checkedWith, setCheckedWith] = useState("");
  const [comments, setComments] = useState("");

  function saveCorrection() {
    setError(null);
    startTransition(async () => {
      const result = await adjustRecoveryCreditRequest({
        requestId,
        correctedWorkDate: workDate,
        correctedHours: Number(hours),
        correctionReason: reason.trim() || undefined,
        checkedWith: checkedWith.trim() || undefined,
      });
      setError(result.error);
      setSaved(!result.error);
    });
  }

  function approve() {
    if (!checkedWith.trim()) {
      setError("Record whom you checked this work with before approving.");
      return;
    }
    if (!window.confirm("Approve this recovery credit? This posts the comp-day credit immediately.")) return;
    setError(null);
    startTransition(async () => {
      const result = await decideRecoveryCreditRequest({ requestId, decision: "approved", checkedWith: checkedWith.trim() });
      setError(result.error);
    });
  }

  function confirmReject() {
    setError(null);
    startTransition(async () => {
      const result = await decideRecoveryCreditRequest({
        requestId,
        decision: "rejected",
        checkedWith: checkedWith.trim() || undefined,
        comments: comments.trim() || undefined,
      });
      setError(result.error);
      if (!result.error) setRejecting(false);
    });
  }

  return (
    <div className="flex w-72 flex-col gap-2 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Original: {originalWorkDate}
        {originalHours != null ? `, ${originalHours}h` : ""}
        {wasCorrected ? " — HR corrected below" : ""}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`work-date-${requestId}`} className="text-xs">
            Work date
          </Label>
          <Input id={`work-date-${requestId}`} type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`hours-${requestId}`} className="text-xs">
            Hours
          </Label>
          <Input
            id={`hours-${requestId}`}
            type="number"
            step="0.25"
            min="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for correction (required if you change date/hours)"
        rows={2}
        className="text-xs"
      />
      <Button size="sm" variant="outline" disabled={pending} onClick={saveCorrection}>
        Save correction
      </Button>
      {saved ? <p className="text-xs text-muted-foreground">Saved — current proposed credit: {currentDays} day(s).</p> : null}

      <div className="space-y-1 border-t border-border pt-2">
        <Label htmlFor={`checked-with-${requestId}`} className="text-xs">
          Checked with (required to approve)
        </Label>
        <Input
          id={`checked-with-${requestId}`}
          value={checkedWith}
          onChange={(e) => setCheckedWith(e.target.value)}
          placeholder="e.g. Project lead's name"
          className="h-8 text-xs"
        />
      </div>

      {rejecting ? (
        <div className="flex flex-col gap-1.5">
          <Textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Reason for rejecting" rows={2} className="text-xs" />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" disabled={pending} onClick={confirmReject}>
              Confirm reject
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={approve}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}
