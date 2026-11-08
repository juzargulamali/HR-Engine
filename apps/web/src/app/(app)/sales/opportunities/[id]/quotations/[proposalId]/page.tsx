import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { REVIEW_PRICING_LABEL, estimateFormatVersion, isSysAdmin } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { LoadError } from "@/components/workspace/states";
import { formatDate, todayInDubai } from "@/components/sales/format";
import { getCurrentSession } from "@/lib/auth/session";
import { getCrmContext } from "@/lib/crm/context";
import { loadOpportunityDetail } from "@/lib/crm/data";
import { loadQuotation, type QuotationBundle } from "@/lib/crm/quotations/data";
import { calculate, hasValidApproval, issueBlockers, pendingApprovalIsStale, prefillCurrency, quotationState, suggestRecipient, QUOTATION_STATE_LABEL } from "@/lib/crm/quotations/model";
import { approvalPolicyOf } from "../../helpers";
import { Panel } from "../../parts";
import { buildOppView } from "../../view";
import { ApprovalReview, EstimateBuilder, ReviseButton } from "./editor";
import { money } from "./money";
import { SnapshotView } from "./snapshot-view";

export const metadata = { title: "Estimate" };

export default async function EstimatePage({ params }: { params: Promise<{ id: string; proposalId: string }> }) {
  const { id, proposalId } = await params;
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const back = `/sales/opportunities/${id}?tab=quotations`;
  let bundle: QuotationBundle | null;
  let detail: Awaited<ReturnType<typeof loadOpportunityDetail>>;
  try {
    [bundle, detail] = await Promise.all([loadQuotation(proposalId), loadOpportunityDetail(ctx, id)]);
  } catch {
    return <LoadError what="this estimate" retryHref={`/sales/opportunities/${id}/quotations/${proposalId}`} />;
  }
  if (!bundle || !detail || bundle.header.opportunity_id !== id) notFound();
  const session = await getCurrentSession();

  const view = buildOppView(ctx, detail);
  const { header, proposal, sections, lines } = bundle;
  const policy = approvalPolicyOf(ctx.companies.find((c) => c.id === header.company_id)?.settings);
  const pending = bundle.approvals.some((a) => a.state === "pending");
  const state = quotationState(header, proposal.status, pending);
  const issued = !!header.issued_at;
  const editable = !issued && view.canEdit && view.isOpen;
  const calc = calculate(header, sections, lines);
  const ids = { opportunityId: id, proposalId };
  const blockers = issueBlockers(header, sections, lines, bundle.approvals, policy, todayInDubai(), bundle.contentHash);
  const { item } = detail;
  const parties = [
    ...(item.agency ? [{ id: item.agency.id, name: item.agency.name, role: "agency" as const }] : []),
    ...(item.client ? [{ id: item.client.id, name: item.client.name, role: "client" as const }] : []),
  ];
  const suggestion = suggestRecipient(item.agency ? { id: item.agency.id, name: item.agency.name } : null, item.client ? { id: item.client.id, name: item.client.name } : null);
  const imageNames = Object.fromEntries(bundle.files.map((f) => [f.id, f.original_name ?? f.label ?? "photo"]));
  const bt = bundle.billTo;
  const cur = header.currency ?? "";
  const legacy = issued && !!bundle.snapshot && estimateFormatVersion(bundle.snapshot.content.terms?.label) === null;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link href={back} className="text-sm text-muted-foreground underline-offset-2 hover:underline">← {item.opp.reference} · Estimates</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl font-semibold"><span className="text-muted-foreground">Estimate</span> {header.reference}</h1>
          <Badge variant="outline">Revision {header.revision}</Badge>
          <Badge variant={state === "issued" ? "success" : state === "superseded" ? "secondary" : "warning"}>{QUOTATION_STATE_LABEL[state]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{item.opp.title} · {item.companyName}</p>
        <div className="flex flex-wrap gap-2" aria-label="Downloads">
          <a href={`/api/sales/quotations/${proposalId}/pdf`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download className="h-4 w-4" aria-hidden /> Download PDF</a>
          <a href={`/api/sales/quotations/${proposalId}/xlsx`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download className="h-4 w-4" aria-hidden /> Download Excel (.xlsx)</a>
          {!issued ? <span className="self-center text-xs text-muted-foreground">Downloads of a draft are marked DRAFT. Nothing is sent to anyone.</span> : null}
        </div>
        {!issued ? <Alert role="status">This is a DRAFT estimate. It can be edited and saved incomplete. Nothing is sent to the client from here.</Alert> : null}
        {issued ? <Alert role="status">Finalised on {formatDate(header.issue_date)}. This estimate is frozen and read-only{state === "superseded" ? " and has been replaced by a later revision" : ""}. To change it, create a revision.</Alert> : null}
        {!issued && !editable ? <p className="text-sm text-muted-foreground">Only the enquiry owner ({view.ownerName}) or a founder can change or finalise this estimate.</p> : null}
      </div>

      {issued && bundle.snapshot ? (
        <Panel title="Finalised estimate" description={`Frozen at ${formatDate(bundle.snapshot.issued_at)}. Later changes to the account or the company profile do not change it.${legacy ? " This one was issued before the estimates-only change as a quotation; its files keep the wording it was issued with." : ""}`}>
          <SnapshotView s={bundle.snapshot.content} />
        </Panel>
      ) : issued ? <LoadError what="the finalised copy" retryHref={`/sales/opportunities/${id}/quotations/${proposalId}`} /> : null}

      {!issued ? (
        <>
          {view.canDecide && bundle.contentHash && bundle.approvals.some((a) => a.id && a.proposal_id === proposalId && a.state === "pending" && a.quote_content_hash === bundle.contentHash) ? (
            <Panel title="Review for approval" description="You are reviewing this exact version. If it changes after this page opened, approving from this page is refused and a fresh request is needed.">
              <ApprovalReview ids={ids} approvalId={bundle.approvals.find((a) => a.proposal_id === proposalId && a.state === "pending")!.id!} seenHash={bundle.contentHash} />
            </Panel>
          ) : null}
          {view.canDecide && pendingApprovalIsStale(header, bundle.approvals, bundle.contentHash) ? <Alert role="status">An approval request is waiting, but the estimate changed after it was requested. Ask the owner to request approval again.</Alert> : null}
          {editable ? (
            <EstimateBuilder
              ids={ids} header={header} sections={sections} lines={lines} vatChoices={bundle.vatChoices}
              issuer={{ legalName: bundle.issuer.legal_name, trn: bundle.issuer.trn, address: bundle.issuer.address, logoUrl: bundle.logoUrl }}
              canEditCompany={!!session && isSysAdmin(session.grants)}
              parties={parties} others={bundle.organisations.map((o) => ({ id: o.id, name: o.name }))} suggestion={suggestion} suggestedCurrency={prefillCurrency(item.opp.currency)}
              imageUrls={bundle.imageUrls} imageNames={imageNames} blockers={blockers}
              needsApproval={policy === "required" && !hasValidApproval(header, bundle.approvals, bundle.contentHash)}
              approvalPending={pending && !pendingApprovalIsStale(header, bundle.approvals, bundle.contentHash)}
            />
          ) : (
            <Panel title="Draft summary">
              <dl className="grid gap-2 text-sm sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Prepared for</dt><dd>{bt ? bt.name : "Not chosen"}</dd></div>
                <div><dt className="text-muted-foreground">Currency</dt><dd>{header.currency ?? "Not chosen"}</dd></div>
                <div><dt className="text-muted-foreground">VAT</dt><dd>{header.vat_label ?? "Not chosen"}</dd></div>
                <div><dt className="text-muted-foreground">{REVIEW_PRICING_LABEL}</dt><dd>{header.validity_date ?? "Not set"}</dd></div>
              </dl>
              <p className="mt-3 text-sm text-muted-foreground">{lines.length} item(s).</p>
              <Card className="mt-3"><CardContent className="space-y-1 p-4 text-right text-sm tabular-nums" aria-label="Totals">
                <p>Total excl. VAT <strong>{money(calc.net, cur)}</strong></p>
                <p>VAT {calc.vatChosen ? money(calc.vat, cur) : <span className="text-muted-foreground">no VAT chosen yet</span>}</p>
                <p className="text-base">Total incl. VAT <strong>{money(calc.gross, cur)}</strong></p>
              </CardContent></Card>
            </Panel>
          )}
        </>
      ) : null}

      {issued && view.canEdit && view.isOpen && !bundle.revisions.some((r) => !r.issued) ? (
        <Panel title="Revise" description="Makes a new draft copy (revision + 1, same reference). Finalising it replaces this revision; this one is never altered.">
          <ReviseButton ids={ids} />
        </Panel>
      ) : null}
      {bundle.revisions.length > 1 ? (
        <Panel title="Revisions of this reference">
          <ul className="space-y-1 text-sm">{bundle.revisions.map((r) => (
            <li key={r.proposal_id}>{r.proposal_id === proposalId ? <strong>Revision {r.revision} (this one)</strong> : <Link className="underline-offset-2 hover:underline" href={`/sales/opportunities/${id}/quotations/${r.proposal_id}`}>Revision {r.revision}</Link>} · {r.issued ? (r.status === "superseded" ? "superseded" : "finalised") : "draft"}</li>
          ))}</ul>
        </Panel>
      ) : null}
    </div>
  );
}
