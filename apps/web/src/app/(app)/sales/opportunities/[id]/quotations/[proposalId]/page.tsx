import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { LoadError } from "@/components/workspace/states";
import { formatDate, todayInDubai } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadOpportunityDetail } from "@/lib/crm/data";
import { loadQuotation, type QuotationBundle } from "@/lib/crm/quotations/data";
import { calculate, hasValidApproval, issueBlockers, quotationState, QUOTATION_STATE_LABEL } from "@/lib/crm/quotations/model";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import { approvalPolicyOf } from "../../helpers";
import { Panel } from "../../parts";
import { buildOppView } from "../../view";
import { DetailsForm, IssueBar, ReviseButton, SectionsEditor, TermsEditor, type OrgChoice } from "./editor";
import { money } from "./money";
import { SnapshotView } from "./snapshot-view";

export const metadata = { title: "Estimate" };

export default async function QuotationPage({ params }: { params: Promise<{ id: string; proposalId: string }> }) {
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

  const view = buildOppView(ctx, detail);
  const { header, proposal, sections, lines } = bundle;
  const policy = approvalPolicyOf(ctx.companies.find((c) => c.id === header.company_id)?.settings);
  const pending = bundle.approvals.some((a) => a.state === "pending");
  const state = quotationState(header, proposal.status, pending);
  const issued = !!header.issued_at;
  const editable = !issued && view.canEdit && view.isOpen;
  const calc = calculate(header, sections, lines);
  const ids = { opportunityId: id, proposalId };
  const blockers = issueBlockers(header, sections, lines, bundle.approvals, policy, todayInDubai());
  const { item } = detail;
  const enquiryParties: OrgChoice[] = [
    ...(item.agency ? [{ id: item.agency.id, name: item.agency.name, detail: "agency" }] : []),
    ...(item.client ? [{ id: item.client.id, name: item.client.name, detail: "end client" }] : []),
  ];
  const others: OrgChoice[] = bundle.organisations.map((o) => ({ id: o.id, name: o.name, detail: "" }));
  const imageNames = Object.fromEntries(bundle.files.map((f) => [f.id, f.original_name ?? f.label ?? "picture"]));
  const bt = bundle.billTo;
  const cur = header.currency ?? "";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link href={back} className="text-sm text-muted-foreground underline-offset-2 hover:underline">← {item.opp.reference} · Estimates &amp; Quotations</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl font-semibold">{header.reference}</h1>
          <Badge variant="outline">Revision {header.revision}</Badge>
          <Badge variant={state === "issued" ? "success" : state === "superseded" ? "secondary" : "warning"}>{QUOTATION_STATE_LABEL[state]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{item.opp.title} · {item.companyName}</p>
        {!issued ? <Alert role="status">This is a DRAFT estimate. It can be edited and saved incomplete. Nothing is sent to the client from here.</Alert> : null}
        {issued ? <Alert role="status">Issued on {formatDate(header.issue_date)}. This quotation is frozen and read-only{state === "superseded" ? " and has been replaced by a later revision" : ""}. To change it, create a revision.</Alert> : null}
        {!issued && !editable ? <p className="text-sm text-muted-foreground">Only the enquiry owner ({view.ownerName}) or a founder can change or issue this estimate.</p> : null}
      </div>

      {issued && bundle.snapshot ? (
        <Panel title="Issued quotation" description={`Frozen at ${formatDate(bundle.snapshot.issued_at)}. Later changes to the account, the company profile or the terms template do not change it.`}>
          <SnapshotView s={bundle.snapshot.content} />
        </Panel>
      ) : issued ? <LoadError what="the issued copy" retryHref={`/sales/opportunities/${id}/quotations/${proposalId}`} /> : null}

      {!issued ? (
        <>
          <Panel title="Issued by" description="Read from the company's own profile (Admin, Companies). Not editable here.">
            <p className="text-sm font-medium">{bundle.issuer.legal_name}</p>
            <p className="text-sm text-muted-foreground">{[bundle.issuer.trn ? `TRN ${bundle.issuer.trn}` : "No TRN recorded", bundle.issuer.address, bundle.issuer.phone, bundle.issuer.email, bundle.issuer.website].filter(Boolean).join(" · ")}</p>
          </Panel>
          <Panel title="Details">
            {editable ? <DetailsForm ids={ids} header={header} vatChoices={bundle.vatChoices} enquiryParties={enquiryParties} others={others} /> : (
              <dl className="grid gap-2 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">Currency</dt><dd>{header.currency ?? "Not chosen"}</dd></div><div><dt className="text-muted-foreground">VAT</dt><dd>{header.vat_label ?? "Not chosen"}</dd></div><div><dt className="text-muted-foreground">Valid until</dt><dd>{header.validity_date ?? "Not set"}</dd></div></dl>
            )}
            <div className="mt-3 rounded-md border border-border p-3 text-sm" aria-label="Bill to">
              <p className="font-medium">Billed to: {bt ? bt.name : <span className="text-muted-foreground">not chosen yet</span>}</p>
              {bt ? <p className="text-muted-foreground">{[bt.place, bt.country_code ? countryLabel(bt.country_code) : null, bt.vat_trn ? `VAT / TRN ${bt.vat_trn}` : "No VAT / TRN recorded", bt.trade_licence_no ? `Trade licence ${bt.trade_licence_no}` : "No trade licence recorded"].filter(Boolean).join(" · ")}<span className="block">Read live from the account record while this is a draft; frozen at issue.</span></p> : null}
            </div>
          </Panel>
          <Panel title="Sections and items" description="Sections and items can be added, renamed, deleted and reordered. Item numbers follow the order automatically.">
            {editable ? <SectionsEditor ids={ids} header={header} sections={sections} lines={lines} calc={calc} vatChoices={bundle.vatChoices} imageUrls={bundle.imageUrls} imageNames={imageNames} /> : <p className="text-sm text-muted-foreground">{sections.length} section(s), {lines.length} item(s).</p>}
          </Panel>
          <Card><CardContent className="space-y-1 p-4 text-right text-sm tabular-nums" aria-label="Totals">
            <p>Total excl. VAT <strong>{money(calc.net, cur)}</strong></p>
            <p>VAT {calc.vatChosen ? money(calc.vat, cur) : <span className="text-muted-foreground">no VAT chosen yet</span>}</p>
            <p className="text-base">Total incl. VAT <strong>{money(calc.gross, cur)}</strong></p>
            {!header.currency ? <p className="text-muted-foreground">Choose a currency to see the currency code.</p> : null}
          </CardContent></Card>
          <Panel title="Payment milestones and terms">
            {editable ? <TermsEditor ids={ids} header={header} /> : <p className="text-sm text-muted-foreground">{header.milestones.length} milestone(s), {header.terms.length} clause(s).</p>}
          </Panel>
          {editable ? (
            <Panel title="Issue" description={policy === "required" ? "This company requires a founder's approval before a quotation is issued." : "Issuing freezes a client-facing copy."}>
              <IssueBar ids={ids} blockers={blockers} needsApproval={policy === "required" && !hasValidApproval(header, bundle.approvals)} approvalPending={pending} canRequestApproval />
            </Panel>
          ) : null}
        </>
      ) : null}

      {issued && view.canEdit && view.isOpen && !bundle.revisions.some((r) => !r.issued) ? (
        <Panel title="Revise" description="Makes a new draft copy (revision + 1, same reference). Issuing it replaces this revision; this one is never altered.">
          <ReviseButton ids={ids} />
        </Panel>
      ) : null}
      {bundle.revisions.length > 1 ? (
        <Panel title="Revisions of this reference">
          <ul className="space-y-1 text-sm">{bundle.revisions.map((r) => (
            <li key={r.proposal_id}>{r.proposal_id === proposalId ? <strong>Revision {r.revision} (this one)</strong> : <Link className="underline-offset-2 hover:underline" href={`/sales/opportunities/${id}/quotations/${r.proposal_id}`}>Revision {r.revision}</Link>} · {r.issued ? (r.status === "superseded" ? "superseded" : "issued") : "draft"}</li>
          ))}</ul>
        </Panel>
      ) : null}
    </div>
  );
}
