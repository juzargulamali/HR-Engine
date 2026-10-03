import { formatRecordedDuration } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { CLASSIFICATION_LABELS, EVENT_TYPE_LABELS, REVIEW_FLAG_LABELS, ROUTE_LABELS, workModeLabel } from "@/lib/recovery/labels";
import type { RecoveryDayClassification, RecoveryWindowReviewFlag } from "@/types/database.types";
import { AcknowledgeReductionForm, VerifyWindowForm } from "./window-review-forms";

export interface WindowEvidenceData {
  requestId: string;
  eventType: string;
  proposedDays: number;
  applicantRoute: string | null;
  routingIssue: string | null;
  needsAcknowledgement: boolean;
  blocker: string | null;
  canVerify: boolean;
  timeZone: string;
  countryCode: string;
  policyVersionLabel: string;
  rulesSummary: string;
  window: {
    id: string;
    index: number;
    start: string;
    end: string;
    startingLocalDate: string;
    classification: RecoveryDayClassification;
    holidayName: string | null;
    recordedSeconds: number;
    status: "open" | "closed";
    closedReason: string | null;
    entitlementDays: number;
    flags: RecoveryWindowReviewFlag[];
    hrVerificationRequired: boolean;
    hrVerifiedAt: string | null;
    hrVerificationNote: string | null;
    revisionNo: number;
  };
  periodStartedAt: string;
  allocations: { id: string; mode: string; projectName: string | null; leadName: string | null; start: string; end: string; seconds: number; byHr: boolean }[];
  revisions: { revisionNo: number; recordedSeconds: number; entitlementDays: number; reason: string; origin: string; createdAt: string }[];
  corrections: { id: string; reason: string; createdAt: string; originalIn: string | null; originalOut: string | null; correctedIn: string; correctedOut: string; actor: string }[];
  steps: { stepOrder: number; label: string; decision: string }[];
}

function fmt(iso: string, timeZone: string, withDate = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    ...(withDate ? { weekday: "short", day: "2-digit", month: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

/**
 * Everything an approver needs to decide a window-based Recovery Leave request
 * without leaving the page: the exact evidence (which sessions, which seconds
 * landed in THIS window), where and when it started, the rule that applied and
 * the policy version, what was corrected and by whom (original vs corrected),
 * what is still pending before it can be approved, and who decides it.
 */
export function RecoveryWindowEvidence({ data }: { data: WindowEvidenceData }) {
  const w = data.window;
  const original = data.revisions.find((r) => r.revisionNo === 1);
  const latest = data.revisions[data.revisions.length - 1];
  const wasChanged = data.revisions.length > 1 && original && latest && (original.recordedSeconds !== latest.recordedSeconds || original.entitlementDays !== latest.entitlementDays);

  return (
    <div className="space-y-2 text-xs text-muted-foreground" data-testid="window-evidence">
      <p>
        <span className="font-medium text-foreground">{EVENT_TYPE_LABELS[data.eventType] ?? data.eventType}</span>
        {data.eventType === "window_top_up" ? " — only the difference is requested" : null}
        {data.eventType === "window_reduction" ? " — only the difference is removed" : null}: <span className="font-medium text-foreground">{data.proposedDays} day{data.proposedDays === 1 ? "" : "s"}</span>
      </p>
      <p>
        Window {w.index}: {fmt(w.start, data.timeZone)} → {fmt(w.end, data.timeZone)} ({data.timeZone}, {data.countryCode}). Working period began {fmt(data.periodStartedAt, data.timeZone)}.
      </p>
      <p>
        Classified by its starting local date <span className="font-medium text-foreground">{w.startingLocalDate}</span>:{" "}
        <span className="font-medium text-foreground">{CLASSIFICATION_LABELS[w.classification]}</span>
        {w.holidayName ? ` (${w.holidayName})` : ""}. {data.rulesSummary} Policy {data.policyVersionLabel}.
      </p>
      <p>
        Recorded in this window: <span className="font-medium text-foreground">{formatRecordedDuration(w.recordedSeconds)}</span> →{" "}
        {w.entitlementDays} day{w.entitlementDays === 1 ? "" : "s"} entitlement
        {w.status === "closed" ? ` (window closed${w.closedReason === "rest" ? " by a completed rest" : " after 24 elapsed hours"})` : " (window still open)"}.
      </p>

      <ul className="space-y-0.5">
        {data.allocations.map((a) => (
          <li key={a.id}>
            {fmt(a.start, data.timeZone, false)}–{fmt(a.end, data.timeZone, false)} · {workModeLabel(a.mode)}
            {a.projectName ? ` · ${a.projectName}` : ""}
            {a.leadName ? ` · lead ${a.leadName}` : ""} · {formatRecordedDuration(a.seconds)}
            {a.byHr ? " · recorded by HR" : ""}
          </li>
        ))}
      </ul>

      {wasChanged && original && latest ? (
        <div className="rounded border border-warning/40 bg-warning/10 p-2">
          <p className="font-medium text-foreground">Corrected after the first calculation</p>
          <p>
            Original: {formatRecordedDuration(original.recordedSeconds)} → {original.entitlementDays} day. Now: {formatRecordedDuration(latest.recordedSeconds)} →{" "}
            {latest.entitlementDays} day.
          </p>
          {data.corrections.map((c) => (
            <p key={c.id}>
              {c.actor}, {fmt(c.createdAt, data.timeZone)}: {c.originalIn ? `${fmt(c.originalIn, data.timeZone)}–${c.originalOut ? fmt(c.originalOut, data.timeZone, false) : "open"} → ` : ""}
              {fmt(c.correctedIn, data.timeZone)}–{fmt(c.correctedOut, data.timeZone, false)}. Reason: {c.reason}
            </p>
          ))}
        </div>
      ) : null}

      {w.flags.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-foreground">Review conditions</p>
          {w.flags.map((f) => (
            <p key={f}>
              <Badge variant={REVIEW_FLAG_LABELS[f].needsVerification ? "warning" : "outline"}>{REVIEW_FLAG_LABELS[f].label}</Badge> {REVIEW_FLAG_LABELS[f].hint}
            </p>
          ))}
          {w.hrVerificationRequired ? (
            w.hrVerifiedAt ? (
              <p className="text-success">HR verified this window{w.hrVerificationNote ? `: ${w.hrVerificationNote}` : ""}.</p>
            ) : (
              <p className="text-warning">HR verification is still required before this can be approved.</p>
            )
          ) : null}
        </div>
      ) : null}

      <p>
        Route: <span className="font-medium text-foreground">{data.applicantRoute ? ROUTE_LABELS[data.applicantRoute] ?? data.applicantRoute : "Awaiting a project lead"}</span>
        {data.steps.length > 0 ? ` — ${data.steps.map((s) => `${s.label}: ${s.decision}`).join(" → ")}` : ""}
      </p>
      {data.routingIssue ? <p className="text-warning">Unresolved routing: {data.routingIssue}</p> : null}

      {data.blocker ? (
        <p className="rounded border border-warning/40 bg-warning/10 p-2 text-foreground" role="note">
          Cannot be approved yet: {data.blocker}
        </p>
      ) : null}
      {data.canVerify && w.hrVerificationRequired && !w.hrVerifiedAt && w.status === "closed" ? <VerifyWindowForm windowId={w.id} /> : null}
      {data.canVerify && data.needsAcknowledgement ? <AcknowledgeReductionForm requestId={data.requestId} /> : null}
    </div>
  );
}
