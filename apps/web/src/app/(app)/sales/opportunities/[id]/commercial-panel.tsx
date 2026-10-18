import { ApprovalBadge, AvailabilityBadge } from "@/components/sales/badges";
import { formatDate, formatDateTime, formatMoney } from "@/components/sales/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConfirmAvailabilityButton, DecideApprovalButton, ZohoForm } from "./commercial-forms";
import { dateRangeText } from "./helpers";
import { Fact, Muted, Panel } from "./parts";
import { RequestApprovalButton, RequestAvailabilityButton } from "./quick-actions";
import type { OppView } from "./view";

const AVAILABILITY_RESULT = { confirmed: "Available for the dates and quantities it covered", unavailable: "Not available", awaiting: "", unverified: "" } as const;
const APPROVAL_STATE = { pending: "Waiting for a founder's decision", approved: "Approved", changes_requested: "Changes requested" } as const;

/** Equipment availability, commercial approval and Zoho Books references: three separate things, never merged into one "confirmed". */
export function CommercialPanel({ view }: { view: OppView }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <AvailabilitySection view={view} />
      </div>
      <div className="space-y-6">
        <ApprovalSection view={view} />
        <ZohoSection view={view} />
      </div>
    </div>
  );
}

function AvailabilitySection({ view }: { view: OppView }) {
  const { opp, detail, ctx, isOpen, canEdit, canConfirm } = view;
  const display = detail.item.availability;
  const covers = opp.availability_covers;
  const stale = display === "needs_recheck";
  const checked = opp.availability_state === "confirmed" || opp.availability_state === "unavailable";
  return (
    <Panel title="Equipment availability" description="A dated check that the technology is free for these dates and quantities. It is not a stock reservation, and it is not the client's commercial confirmation.">
      <div className="space-y-4">
        <AvailabilityBadge state={display} />
        {display === "unverified" ? <Muted>Nobody has checked yet.</Muted> : null}
        {display === "awaiting" ? <p className="text-sm">Check requested by {ctx.personName(opp.availability_requested_by)} on {formatDateTime(opp.availability_requested_at)}. Waiting for someone allowed to record it.</p> : null}
        {stale ? <Alert variant="warning"><strong>Needs repeating.</strong> The dates, technologies or quantities changed after the last check, so it no longer applies to what is now being offered.</Alert> : null}
        {checked ? (
          <dl className="space-y-3 border-t border-border/70 pt-3">
            <Fact label={stale ? "The last check said" : "Result"}>{AVAILABILITY_RESULT[opp.availability_state]}</Fact>
            <Fact label="Checked by">{ctx.personName(opp.availability_by)}</Fact>
            <Fact label="Checked on">{formatDateTime(opp.availability_at)}</Fact>
            {opp.availability_notes ? <Fact label="Note"><span className="whitespace-pre-wrap">{opp.availability_notes}</span></Fact> : null}
            {covers ? (
              <Fact label="The check covered">
                Installation {covers.install_start ? formatDate(covers.install_start) : "not set"}; show {dateRangeText(covers.event_start, covers.event_end, formatDate) ?? "not set"};{" "}
                {covers.technologies.length ? covers.technologies.map((t) => `${t.name} × ${t.qty}`).join(", ") : "no technologies listed"}
              </Fact>
            ) : null}
          </dl>
        ) : null}
        {isOpen ? (
          <div className="flex flex-wrap items-start gap-2 border-t border-border/70 pt-3">
            {canEdit && opp.availability_state !== "awaiting" ? <RequestAvailabilityButton opportunityId={opp.id} recheck={checked} /> : null}
            {canEdit && opp.availability_state === "awaiting" ? <Muted>Already requested.</Muted> : null}
            {canConfirm ? <ConfirmAvailabilityButton opportunityId={opp.id} recheck={checked} /> : null}
          </div>
        ) : null}
        {isOpen && !canConfirm ? <p className="text-xs text-muted-foreground">Only a founder, or someone they gave the permission to, can record the result. The owner cannot on their own.</p> : null}
      </div>
    </Panel>
  );
}

function ApprovalSection({ view }: { view: OppView }) {
  const { detail, opp, ctx, policy, isOpen, canEdit, canDecide } = view;
  const latest = detail.approvals[0] ?? null;
  const pending = detail.approvals.find((a) => a.state === "pending") ?? null;
  const latestProposal = detail.proposals[0] ?? null;
  const versionOf = (proposalId: string | null) => detail.proposals.find((p) => p.id === proposalId)?.version;
  return (
    <Panel title="Commercial approval" description="An internal decision by a founder. Sending a proposal is a separate fact and never counts as approval.">
      <div className="space-y-4">
        <ApprovalBadge policy={policy} latest={latest ? { state: latest.state } : null} />
        {policy === "not_configured" ? <p className="text-sm text-muted-foreground">The founders have not set a commercial approval rule for this company yet, so nothing can be requested or approved. A founder sets it in Sales settings.</p> : null}
        {policy === "not_required" ? <p className="text-sm text-muted-foreground">The founders decided commercial approval is not required for this company. Nothing here counts as approved.</p> : null}
        {policy === "required" ? (
          <div className="space-y-3">
            {pending ? (
              <div className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">Waiting for a founder&apos;s decision</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Requested by {ctx.personName(pending.requested_by)} on {formatDateTime(pending.requested_at)}{versionOf(pending.proposal_id) ? ` for proposal version ${versionOf(pending.proposal_id)}` : ""}.</p>
                <div className="mt-2">
                  {canDecide ? <DecideApprovalButton approvalId={pending.id} opportunityId={opp.id} /> : <p className="text-xs text-muted-foreground">Only a founder can decide.</p>}
                </div>
              </div>
            ) : isOpen && canEdit ? (
              <RequestApprovalButton opportunityId={opp.id} proposalId={latestProposal?.id} again={!!latest} />
            ) : isOpen ? (
              <Muted>Only the owner ({view.ownerName}) or a founder can request approval.</Muted>
            ) : null}
          </div>
        ) : null}
        {policy === "required" && detail.approvals.length > 0 ? (
          <div className="border-t border-border/70 pt-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Requests so far</h3>
            <ul className="space-y-2">
              {detail.approvals.map((a) => (
                <li key={a.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={a.state === "approved" ? "success" : a.state === "changes_requested" ? "warning" : "outline"}>{APPROVAL_STATE[a.state]}</Badge>
                    {versionOf(a.proposal_id) ? <span className="text-xs text-muted-foreground">Proposal version {versionOf(a.proposal_id)}</span> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Requested by {ctx.personName(a.requested_by)}, {formatDateTime(a.requested_at)}
                    {a.decided_at ? ` · decided by ${ctx.personName(a.decided_by)}, ${formatDateTime(a.decided_at)}` : ""}
                  </p>
                  {a.instruction ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">“{a.instruction}”</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function ZohoSection({ view }: { view: OppView }) {
  const { detail, opp, canEdit, isLost } = view;
  const z = detail.zoho;
  const paid = z?.paid_amount == null ? null : Number(z.paid_amount);
  const values = {
    quoteRef: z?.quote_ref ?? null, quoteSentOn: z?.quote_sent_on ?? null, invoiceRef: z?.invoice_ref ?? null,
    invoiceIssuedOn: z?.invoice_issued_on ?? null, paymentReceivedOn: z?.payment_received_on ?? null, paidAmount: paid,
  };
  return (
    <Panel title="Zoho Books references" description="References entered by hand. Zoho Books remains the accounting record: this system does not read from it or write to it.">
      {canEdit && !isLost ? (
        <ZohoForm opportunityId={opp.id} values={values} currency={opp.currency} />
      ) : (
        <ol className="space-y-3 text-sm">
          <li><p className="font-medium">1. Quote sent</p><p className="text-xs text-muted-foreground">{values.quoteRef ? `${values.quoteRef} · ${formatDate(values.quoteSentOn)}` : "Not recorded"}</p></li>
          <li><p className="font-medium">2. Invoice issued</p><p className="text-xs text-muted-foreground">{values.invoiceRef ? `${values.invoiceRef} · ${formatDate(values.invoiceIssuedOn)}` : "Not recorded"}</p></li>
          <li><p className="font-medium">3. Payment received</p><p className="text-xs text-muted-foreground">{values.paymentReceivedOn ? `${formatDate(values.paymentReceivedOn)}${paid != null ? ` · ${formatMoney(paid, opp.currency)}` : ""}` : "Not recorded"}</p></li>
        </ol>
      )}
      {z ? <p className="mt-3 text-xs text-muted-foreground">Last updated {formatDateTime(z.updated_at)}{z.updated_by ? ` by ${view.ctx.personName(z.updated_by)}` : ""}.</p> : null}
      {!canEdit && !isLost ? <p className="mt-3 text-xs text-muted-foreground">Only the owner ({view.ownerName}) or a founder can change these.</p> : null}
    </Panel>
  );
}
