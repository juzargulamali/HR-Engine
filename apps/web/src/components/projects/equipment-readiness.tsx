import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/projects/parts";
import { formatDateTime } from "@/lib/projects/format";
import {
  readinessLine, requestHref, REVIEW_BOOKING_SENTENCE, REVIEW_FIELD_LABEL, reviewByText, reviewChangeText, STILL_OUT_HEADING, stillOutText,
  type EquipmentReview, type RequestReadiness, type StillOut,
} from "@/lib/projects/equipment-readiness-model";
import { EquipmentReviewForm } from "./equipment-review-form";

/** One request's "Readiness" line: the state in a word (never colour alone) and the counts behind it. */
export function ReadinessLine({ request }: { request: RequestReadiness }) {
  const l = readinessLine(request);
  return (
    <span className="text-muted-foreground" data-testid={`readiness-${request.id}`}>
      Readiness: <Badge variant={l.tone === "red" ? "destructive" : l.tone === "amber" ? "warning" : "outline"}>{l.label}</Badge>{l.detail ? <span> · {l.detail}</span> : null}
    </span>
  );
}

/**
 * "Review equipment booking": a committed project date changed while a request was with the warehouse. Each line says which date, what it was and is, who changed it and when,
 * and links to the request, where the warehouse changes the booking (with its conflict checks). "Mark as reviewed" only records that someone looked.
 */
export function EquipmentReviewPanel({ reviews, projectId, canReview }: { reviews: readonly EquipmentReview[]; projectId: string; canReview: boolean }) {
  if (reviews.length === 0) return null;
  return (
    <Panel id="equipment-review" title="Review equipment booking" description="⚠ A project date changed after the equipment was requested." className="border-[hsl(var(--os-amber)/0.5)]">
      <p className="mb-3 text-sm">{REVIEW_BOOKING_SENTENCE}</p>
      <ul className="divide-y divide-border text-sm" data-testid="equipment-reviews">
        {reviews.map((v) => (
          <li key={v.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
            <p className="break-words"><span className="font-mono font-medium">{v.requestCode}</span> <span className="text-muted-foreground">·</span> <span className="font-medium">{REVIEW_FIELD_LABEL[v.field]}</span> <span className="text-muted-foreground">·</span> {reviewChangeText(v)}</p>
            <p className="text-[13px] text-muted-foreground">{reviewByText(v)}</p>
            <p><Link href={requestHref(v.requestId)} className="font-medium text-accent underline-offset-4 hover:underline">Open request {v.requestCode} to change its dates</Link></p>
            {canReview ? <EquipmentReviewForm reviewId={v.id} projectId={projectId} /> : <p className="text-[13px] text-muted-foreground">The Project Manager or the warehouse marks this as reviewed.</p>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** On a finished project with equipment not yet returned: how much is out per request, when it is expected back and whether that is overdue. */
export function StillOutNotice({ out, linkRequests = true, className }: { out: StillOut; linkRequests?: boolean; className?: string }) {
  return (
    <Alert variant="warning" role="status" className={className} data-testid="equipment-still-out">
      <p className="font-semibold">{STILL_OUT_HEADING}</p>
      <ul className="mt-1 space-y-0.5">
        {out.requests.map((r) => (
          <li key={r.id} className="break-words">Request {linkRequests ? <Link href={requestHref(r.id)} className="font-mono font-medium underline">{r.code}</Link> : <span className="font-mono font-medium">{r.code}</span>}: {stillOutText(r)}</li>
        ))}
      </ul>
      <p className="mt-1">Completing a project does not return equipment: it stays outstanding until the warehouse records its return.</p>
    </Alert>
  );
}

/** The release of unused reservations failed when the project finished: say so, when, and who puts it right. */
export function ReleaseFailedNotice({ failed, requests }: { failed: { at: string; detail: string | null }; requests: readonly Pick<RequestReadiness, "id" | "code">[] }) {
  return (
    <Alert variant="destructive" role="alert" data-testid="equipment-release-failed">
      <p className="font-semibold">Releasing unused reservations failed when the project finished.</p>
      <p>It failed on {formatDateTime(failed.at)}.{failed.detail ? ` ${failed.detail}` : ""}</p>
      <p className="mt-1">Ask the warehouse to release the unused lines on the request.{" "}
        {requests.map((r, i) => <span key={r.id}>{i > 0 ? ", " : ""}<Link href={requestHref(r.id)} className="font-medium underline">Open request {r.code}</Link></span>)}
      </p>
    </Alert>
  );
}
