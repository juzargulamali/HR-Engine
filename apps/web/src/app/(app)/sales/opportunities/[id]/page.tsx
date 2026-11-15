import Link from "next/link";
import { BackLink } from "@/components/workspace/list-memory";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { SalesCompanyMemory } from "@/components/sales/company-memory";
import { getCrmContext } from "@/lib/crm/context";
import { loadOpportunityDetailResult, loadOrganisations, type DetailSection } from "@/lib/crm/data";
import { ActivityPanel } from "./activity-panel";
import { HANDOVER_REOPENED_NOTICE } from "./closure-helpers";
import { buildContactPicker } from "./contact-helpers";
import { CommercialPanel } from "./commercial-panel";
import { DetailTabs, type DetailTab } from "./detail-tabs";
import { FilesPanel } from "./files-panel";
import { OverviewPanel } from "./overview-panel";
import { ProposalsPanel } from "./proposals-panel";
import { QuotationsPanel } from "./quotations-panel";
import { ScopePanel } from "./scope-panel";
import { buildOppView } from "./view";
import { EnquiryGuide } from "./enquiry-guide";
import { Suspense } from "react";
import { LoadError } from "@/components/workspace/states";

export const metadata = { title: "Opportunity" };

/**
 * Where "back" returns to: the list the person opened the enquiry from, as they left it (filters, search, sort and scroll are remembered per list by
 * RememberList). A link from Follow-ups carries `?from=follow-ups`; anything else is the Enquiries list. Only these two names are ever used.
 */
const BACK = {
  "follow-ups": { section: "follow-ups", fallback: "/sales/follow-ups", label: "Follow-ups" },
  enquiries: { section: "enquiries", fallback: "/sales/opportunities", label: "Enquiries" },
} as const;

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; event_link?: string; from?: string; saved?: string }> }) {
  const [{ id }, { tab, event_link: eventLink, from, saved }] = await Promise.all([params, searchParams]);
  const back = from === "follow-ups" ? BACK["follow-ups"] : BACK.enquiries;
  const backLink = <BackLink section={back.section} fallback={back.fallback}>{back.label}</BackLink>;
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const result = await loadOpportunityDetailResult(ctx, id);
  if (result.kind === "not_found") notFound();
  // A failed read is not "not found" and not "no access": it says it could not load, offers a retry, and shows no action (nothing here is known to be safe to offer).
  if (result.kind !== "ok") {
    return (
      <div className="space-y-5">
        {backLink}
        <h1 className="text-2xl font-semibold">Enquiry</h1>
        {result.kind === "denied"
          ? <Alert variant="destructive" role="alert">You do not have access to this enquiry. If you think you should, ask the owner or a Sales founder.</Alert>
          : <LoadError what="this enquiry" retryHref={`/sales/opportunities/${id}`} note="Nothing is shown or offered, because the enquiry could not be read. This is not a missing enquiry." />}
      </div>
    );
  }
  const { detail } = result;
  const failed = new Set<DetailSection>(result.failed);
  // Everyone who could be added as a contact is loaded only for people who may change contacts (saves the query for everyone else). A failed read is the contacts' own "could not load".
  let organisations: Awaited<ReturnType<typeof loadOrganisations>> | null = null;
  if (buildOppView(ctx, detail).canChangeContacts) {
    try { organisations = await loadOrganisations(); } catch (e) { console.error("[crm] organisations read failed", e); failed.add("contacts"); }
  }
  const view = buildOppView(ctx, detail, failed);
  const { item } = detail;
  const { opp } = view;

  const picker = organisations
    ? buildContactPicker(organisations.organisations, detail.contacts.map((c) => c.contact.id), item.agency?.id ?? item.client?.id ?? null, organisations.unassignedContacts)
    : null;
  const handoverKeptAfterReopen = !failed.has("handover") && !!detail.handover && opp.stage !== "won";

  const tabs: DetailTab[] = [
    { id: "overview", label: "Overview", content: <OverviewPanel view={view} picker={picker} /> },
    { id: "scope", label: "Scope & dates", content: <ScopePanel view={view} /> },
    { id: "activity", label: "Activity & history", content: <ActivityPanel view={view} /> },
    { id: "proposals", label: "Proposals & files", content: <div className="space-y-6"><ProposalsPanel view={view} /><FilesPanel view={view} /></div> },
    { id: "quotations", label: "Estimates", content: <QuotationsPanel view={view} /> },
    { id: "commercial", label: "Commercial", content: <CommercialPanel view={view} /> },
  ];

  return (
    <div className="space-y-5">
      {/* The next Sales page (and Add enquiry) opens in this enquiry's company. */}
      <SalesCompanyMemory companyId={opp.company_id} />
      <header className="space-y-3">
        {backLink}
        <div className="min-w-0">
          <p className="break-words text-sm text-muted-foreground">{opp.reference} · <span title="The company this enquiry belongs to">{item.companyName}</span> · {opp.currency}</p>
          <h1 className="mt-1 min-w-0 break-words text-2xl font-semibold">{opp.title}</h1>
        </div>

        {/* The New enquiry form was saved a second time (a retry after the answer to the first save was lost): the database returned this enquiry instead of making another. */}
        {saved === "earlier" ? (
          <Alert role="status" data-testid="enquiry-already-saved">This enquiry was already saved by your earlier attempt, so a second one was not created. This is that enquiry. Anything you changed in the form after the first save was not applied: check the details below and edit them here if needed.</Alert>
        ) : null}
        {eventLink === "failed" ? (
          <Alert variant="warning" role="status">The enquiry was created, but it could not be linked to the event edition you chose (only the enquiry owner or a founder can link it). Ask the owner, or use Edit details (under More) to link it.</Alert>
        ) : null}
        {handoverKeptAfterReopen ? (
          <Alert variant="warning" role="status">
            <p>{HANDOVER_REOPENED_NOTICE}</p>
            <p className="mt-1"><Link href={`/sales/opportunities/${opp.id}/handover`} className="font-medium underline">See the handover record as it was</Link></p>
          </Alert>
        ) : null}

        {/* The one summary: next action, main button, blockers, stage, owner, client, value and where it stands. Its own reads (estimates, handover) never hold up the title. */}
        <Suspense fallback={<div className="os-card min-h-[11rem] border-l-4 border-l-border p-4 text-sm text-muted-foreground sm:p-5" role="status">Loading the next action…</div>}>
          <EnquiryGuide view={view} />
        </Suspense>
      </header>

      <DetailTabs tabs={tabs} initial={tab ?? "overview"} syncAddress />
    </div>
  );
}
