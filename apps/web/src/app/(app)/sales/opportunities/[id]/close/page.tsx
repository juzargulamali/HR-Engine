import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CRM_EVIDENCE_TYPES, CRM_LOST_REASONS } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { StageBadge } from "@/components/sales/badges";
import { formatDate, formatMoney, todayInDubai } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadOpportunityDetail } from "@/lib/crm/data";
import { buildOppView } from "../view";
import { CloseForm } from "./close-form";

export const metadata = { title: "Close opportunity" };

export default async function CloseOpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ outcome?: string }> }) {
  const [{ id }, { outcome }] = await Promise.all([params, searchParams]);
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const detail = await loadOpportunityDetail(ctx, id);
  if (!detail) notFound();
  const view = buildOppView(ctx, detail);
  const { opp } = view;
  const back = (
    <Link href={`/sales/opportunities/${opp.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to {opp.reference}
    </Link>
  );

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        {back}
        <div>
          <p className="text-sm text-muted-foreground">{opp.reference} · {detail.item.companyName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-2xl font-semibold">Close this opportunity</h1>
            <StageBadge stage={opp.stage} />
          </div>
          <p className="mt-1 break-words text-sm text-muted-foreground">{opp.title}</p>
        </div>
      </header>

      {view.isWon || view.isLost ? (
        <Alert role="status">
          <p><strong>Already closed as {view.isWon ? "won" : "lost"}</strong> on {formatDate(opp.closed_at)}. {view.isWon ? `Evidence: ${opp.evidence_type === "purchase_order" ? "purchase order" : "authorised email"} ${opp.evidence_reference ?? ""}, dated ${formatDate(opp.evidence_date)}.` : `Reason: ${opp.lost_reason}.`}</p>
          <p className="mt-1">{view.isWon ? <Link href={`/sales/opportunities/${opp.id}/handover`} className="font-medium underline">Open the handover package</Link> : "A lost opportunity is read-only."}</p>
        </Alert>
      ) : !view.canEdit ? (
        <Alert variant="destructive">Only the owner ({view.ownerName}) or a founder can close this opportunity.</Alert>
      ) : (
        <CloseForm
          key={opp.version}
          opportunityId={opp.id}
          version={opp.version}
          initialOutcome={outcome === "lost" ? "lost" : "won"}
          onHold={view.isHold}
          valueText={formatMoney(detail.item.value, opp.currency)}
          hasValue={detail.item.value != null}
          openFollowUps={view.openFollowUps.length}
          today={todayInDubai()}
          lostReasons={CRM_LOST_REASONS}
          evidenceTypes={CRM_EVIDENCE_TYPES}
        />
      )}
    </div>
  );
}
