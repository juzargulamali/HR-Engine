import type { ReactNode } from "react";
import Link from "next/link";
import { BUDGETARY_NOTICE, isEstimateFormat, type TermsReview } from "@enginious-hr/domain";

/**
 * Where the terms of a DRAFT estimate come from, said on screen (no hooks: used by the builder and by the read-only draft summary).
 *
 *   - INHERITED: the draft still carries clauses (or a terms label) that are not the current estimate format. A revision of a quotation issued before the
 *     estimates-only change copies that quotation's standard terms; they are shown here with where they came from, what replacing them does, and the button
 *     (`action`, owner or founder only). Until a person confirms, the draft cannot be finalised or sent for approval.
 *   - SELECTED: the draft is in the current estimate format. One line says so, and whether that replaced the terms of an earlier quotation.
 *
 * The issued revision the draft was copied from is never changed by anything here.
 */
export interface RevisedFrom { proposal_id: string; revision: number; termsLabel: string | null; termClauses: number }

export function TermsPanel({ review, revisedFrom, opportunityId, action }: { review: TermsReview; revisedFrom: RevisedFrom | null; opportunityId: string; action?: ReactNode }) {
  const fromQuotation = !!revisedFrom && !isEstimateFormat(revisedFrom.termsLabel);
  const earlier = revisedFrom ? <Link className="underline underline-offset-2" href={`/sales/opportunities/${opportunityId}/quotations/${revisedFrom.proposal_id}`}>revision {revisedFrom.revision}</Link> : null;
  if (!review.needed) {
    return (
      <p className="rounded-md border border-border p-3 text-sm" data-testid="terms-origin" data-terms="selected">
        <span className="font-semibold">Terms: current estimate format (selected).</span>{" "}
        {fromQuotation ? <>It was chosen in place of the terms of {earlier}, which was issued as a quotation and keeps its own terms exactly as issued. </>
          : revisedFrom ? <>The same format as {earlier}, which this draft was copied from. </> : null}
        The client file prints the budgetary estimate notice and no standard terms.
      </p>
    );
  }
  const n = review.inherited.length;
  return (
    <section className="space-y-3 rounded-md border border-[hsl(var(--os-amber))] p-4 text-sm" aria-labelledby="terms-review-title" data-testid="terms-review" data-terms="inherited">
      <h2 id="terms-review-title" className="text-base font-semibold">Terms carried over: review them before this draft can go out</h2>
      <p>
        <span className="font-semibold">Inherited.</span>{" "}
        {fromQuotation ? <>These terms were copied from {earlier}, which was issued as a quotation before estimates replaced quotations. That revision keeps them exactly as issued. </>
          : <>These terms were copied into this draft when it was created. </>}
        They are not the current estimate format and nothing has replaced them yet.
      </p>
      {review.label ? <p className="text-muted-foreground">Label stored with them: {review.label}</p> : null}
      {n > 0 ? (
        <details>
          <summary className="cursor-pointer font-medium">{n === 1 ? "The carried-over clause" : `The ${n} carried-over clauses`}: {review.inherited.map((c) => c.title).join(", ")}</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">{review.inherited.map((c, i) => <li key={`${i}-${c.title}`}><strong>{c.title}.</strong> {c.body}</li>)}</ol>
        </details>
      ) : <p className="text-muted-foreground">No clause is stored with them, only the label.</p>}
      <div>
        <p className="font-medium">What replacing them does</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
          <li>Removed from this draft: {n > 0 ? (n === 1 ? "the clause above" : `the ${n} clauses above`) : "the label above"}{n > 0 && review.label ? " and their label" : ""}.</li>
          <li>Used instead: the current estimate format. The client file prints this notice and no standard terms: “{BUDGETARY_NOTICE}”</li>
          <li>Kept: the items, prices, recipient, VAT, payment details, exclusions, Assumptions and Next steps of this draft.</li>
          {revisedFrom ? <li>Not changed: revision {revisedFrom.revision} and its files.</li> : null}
        </ul>
      </div>
      <p>Until this is confirmed, the draft cannot be finalised or sent for approval. Saving the draft does not replace these terms. A download of the draft is marked DRAFT and already leaves these clauses out.</p>
      {action ?? <p className="text-muted-foreground">Only the enquiry owner or a founder can replace them.</p>}
    </section>
  );
}
