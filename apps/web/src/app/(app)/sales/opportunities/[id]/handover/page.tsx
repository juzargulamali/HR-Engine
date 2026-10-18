import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AvailabilityBadge, StageBadge } from "@/components/sales/badges";
import { formatDate, formatDateTime, formatMoney } from "@/components/sales/format";
import { displayNameFor, getCrmContext } from "@/lib/crm/context";
import { loadOpportunityDetail } from "@/lib/crm/data";
import { createClient } from "@/lib/supabase/server";
import { HANDOVER_REOPENED_NOTICE } from "../closure-helpers";
import { ContactsPanel } from "../contacts-panel";
import { buildHandoverPackage, dateRangeText, fileDisplayName, HANDOVER_STATUS_LABELS } from "../helpers";
import { Fact, Muted, Panel } from "../parts";
import { buildOppView } from "../view";
import { HandoverForm } from "./handover-form";
import { loadProjectHandover, ProjectHandoverPanel } from "./project-handover";

export const metadata = { title: "Handover" };

export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const detail = await loadOpportunityDetail(ctx, id);
  if (!detail) notFound();
  const view = buildOppView(ctx, detail);
  const { opp, canEdit } = view;
  const back = (
    <Link href={`/sales/opportunities/${opp.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to {opp.reference}
    </Link>
  );

  if (!view.isWon) {
    // A handover that was prepared before the opportunity was reopened is kept exactly as it was: explain, show it read-only, never redo it.
    const kept = detail.handover;
    const keptPm = kept?.pm_user_id ? ctx.personName(kept.pm_user_id) : null;
    return (
      <div className="space-y-5">
        {back}
        <h1 className="text-2xl font-semibold">Handover package</h1>
        {kept ? (
          <>
            <Alert variant="warning" role="status">
              <p>{HANDOVER_REOPENED_NOTICE}</p>
              <p className="mt-1">{opp.reference} is currently <StageBadge stage={opp.stage} />. A handover package can only be prepared or changed while it is Won.</p>
            </Alert>
            <Panel
              title="Handover record, kept as it was"
              description={kept.prepared_at ? `Prepared ${formatDateTime(kept.prepared_at)}${kept.prepared_by ? ` by ${ctx.personName(kept.prepared_by)}` : ""}.${kept.handed_over_at ? ` Handed over ${formatDateTime(kept.handed_over_at)}.` : ""}` : "It was never marked ready."}
            >
              <dl className="grid gap-3 sm:grid-cols-3">
                <Fact label="Status when it was left">{HANDOVER_STATUS_LABELS[kept.status] ?? kept.status}</Fact>
                <Fact label="Project Manager">{kept.pm_user_id ? (keptPm && keptPm !== "Unknown" ? keptPm : "Chosen (name not available to you)") : "Not chosen"}</Fact>
                <Fact label="Notes">{kept.notes ?? "None"}</Fact>
              </dl>
              <p className="mt-3 text-sm text-muted-foreground">This is only the record of who and what was chosen. The rest of the package is built from the opportunity when it is Won again.</p>
            </Panel>
          </>
        ) : (
          <Alert role="status">
            A handover package can only be prepared once the opportunity is Won, with a purchase order or authorised email on record. {opp.reference} is currently <StageBadge stage={opp.stage} />.
          </Alert>
        )}
      </div>
    );
  }

  // Project Managers are any active staff (not only Sales users): read through the directory function, names only for non-founders.
  let staff: { id: string; name: string }[] = [];
  if (canEdit) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("crm_staff_directory");
    staff = (data ?? []).map((p) => ({ id: p.user_id, name: displayNameFor(p) }));
  }
  const handover = detail.handover;
  const pmId = handover?.pm_user_id ?? null;
  const pmName = pmId ? (staff.find((p) => p.id === pmId)?.name ?? ctx.personName(pmId)) : null;
  const status = handover?.status ?? "draft";
  // Keep the currently chosen Project Manager selectable even if the directory did not return them.
  const people = pmId && !staff.some((p) => p.id === pmId) ? [...staff, { id: pmId, name: pmName ?? "Former colleague" }] : staff;

  const projectHandover = await loadProjectHandover(opp.id);
  const pkg = buildHandoverPackage({ opp, proposals: detail.proposals, files: detail.files, contactCount: detail.contacts.length, availability: detail.item.availability });
  const latestSent = detail.proposals.find((p) => p.status === "sent");
  const show = dateRangeText(opp.event_start, opp.event_end, formatDate);
  const zoho = detail.zoho;
  const steps = [
    { label: "Commercially won", done: true, detail: `${pkg.evidenceLabel ?? "Evidence"} ${pkg.evidenceReference ?? ""}, dated ${formatDate(pkg.evidenceDate)}` },
    { label: "Handover package", done: status !== "draft", detail: HANDOVER_STATUS_LABELS[status] ?? status },
    projectHandover.status?.status === "accepted"
      ? { label: "Project created", done: true, detail: `${projectHandover.status.project_reference ?? "The project"} was created when the Project Manager accepted the project handover.` }
      : { label: "Project created", done: false, detail: "Created when the Project Manager accepts the project handover below." },
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        {back}
        <div>
          <p className="text-sm text-muted-foreground">{opp.reference} · {detail.item.companyName} · Handover package</p>
          <h1 className="mt-1 break-words text-2xl font-semibold">{opp.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Everything the Project Manager needs to start, taken from the opportunity as it stands. It is a summary of agreed facts, not a project.</p>
        </div>
        <Alert role="status"><strong>Two separate records.</strong> The package and Project Manager choice below are the Sales-side record and notify nobody. The delivery brief further down (Project handover) is what starts delivery: when you submit it, a founder names the Project Manager, who accepts it to create the project.</Alert>
      </header>

      <ol className="grid gap-3 sm:grid-cols-3" aria-label="Handover progress">
        {steps.map((s) => (
          <li key={s.label} className="flex gap-2.5 rounded-lg border border-border bg-card px-4 py-3">
            {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-success" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />}
            <div className="min-w-0">
              <p className="text-sm font-medium">{s.label} <span className="font-normal text-muted-foreground">· {s.done ? "Done" : "Not yet"}</span></p>
              <p className="break-words text-sm text-muted-foreground">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {pkg.gaps.length > 0 ? (
        <Alert variant="warning">
          <p className="font-medium">{pkg.gaps.length} {pkg.gaps.length === 1 ? "gap" : "gaps"} to resolve before this is complete</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{pkg.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
        </Alert>
      ) : null}

      <Panel
        title="Project Manager and status"
        description={handover?.prepared_at ? `Prepared ${formatDateTime(handover.prepared_at)}${handover.prepared_by ? ` by ${ctx.personName(handover.prepared_by)}` : ""}.${handover.handed_over_at ? ` Handed over ${formatDateTime(handover.handed_over_at)}.` : ""}` : "Not marked ready yet."}
      >
        {canEdit ? (
          <HandoverForm key={handover?.updated_at ?? "new"} opportunityId={opp.id} status={status} pmUserId={pmId} notes={handover?.notes ?? null} people={people} />
        ) : (
          <dl className="grid gap-3 sm:grid-cols-3">
            <Fact label="Project Manager">{pmName ?? "Not chosen yet"}</Fact>
            <Fact label="Status">{HANDOVER_STATUS_LABELS[status] ?? status}</Fact>
            <Fact label="Notes">{handover?.notes ?? "None"}</Fact>
          </dl>
        )}
        {!canEdit ? <p className="mt-3 text-sm text-muted-foreground">Only the owner ({view.ownerName}) or a founder can change this.</p> : null}
      </Panel>

      <ProjectHandoverPanel
        state={projectHandover}
        opportunityId={opp.id}
        canEdit={canEdit}
        personName={(id) => (id ? ctx.personName(id) : "Unknown")}
        defaults={{
          title: opp.title, clientName: "", location: opp.location ?? "", siteTimezone: "Asia/Dubai", installStart: opp.install_start ?? "", eventStart: opp.event_start ?? "",
          eventEnd: opp.event_end ?? "", scope: opp.scope ?? "", exclusions: opp.exclusions ?? "", notes: "", technologies: opp.technologies,
        }}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Accepted scope">
          {pkg.scope ? <p className="whitespace-pre-wrap break-words text-sm">{pkg.scope}</p> : <Muted>Not written down.</Muted>}
          <h3 className="mb-1 mt-4 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Exclusions</h3>
          {pkg.exclusions ? <p className="whitespace-pre-wrap break-words text-sm">{pkg.exclusions}</p> : <Muted>None recorded.</Muted>}
        </Panel>
        <Panel title="Accepted proposal">
          {pkg.acceptedProposal ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Version {pkg.acceptedProposal.version} <Badge variant="success">Accepted</Badge></p>
              {pkg.acceptedProposal.sent_on ? <p className="text-sm text-muted-foreground">Sent {formatDate(pkg.acceptedProposal.sent_on)}</p> : null}
              {pkg.acceptedProposal.note ? <p className="break-words">{pkg.acceptedProposal.note}</p> : null}
              <p className="break-words text-sm text-muted-foreground">{pkg.acceptedProposalFile ? `Document: ${fileDisplayName(pkg.acceptedProposalFile)}` : "No document linked to this version."}</p>
            </div>
          ) : (
            <Muted>No proposal is recorded as accepted.{latestSent ? ` The latest sent is version ${latestSent.version} (${formatDate(latestSent.sent_on)}); it was not recorded as accepted.` : ""}</Muted>
          )}
        </Panel>
        <Panel title="Confirmation of the win">
          <div className="space-y-1 text-sm">
            <p className="font-medium">{pkg.evidenceLabel ?? "Evidence"}: {pkg.evidenceReference}</p>
            <p className="text-sm text-muted-foreground">Dated {formatDate(pkg.evidenceDate)}</p>
            {pkg.evidenceFiles.length > 0 ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5">{pkg.evidenceFiles.map((f) => <li key={f.id} className="break-words">{fileDisplayName(f)}</li>)}</ul>
            ) : <p className="text-sm text-muted-foreground">No document attached under Files.</p>}
          </div>
        </Panel>
        <Panel title="Promised technologies">
          {opp.technologies.length === 0 ? <Muted>None listed.</Muted> : (
            <ul className="space-y-1 text-sm">{opp.technologies.map((t, i) => <li key={`${i}-${t.name}`} className="flex justify-between gap-3"><span className="min-w-0 break-words">{t.name}</span><span className="tabular-nums">× {t.qty}</span></li>)}</ul>
          )}
          <div className="mt-3 space-y-1 border-t border-border/70 pt-3">
            <AvailabilityBadge state={detail.item.availability} />
            {opp.availability_by ? <p className="text-sm text-muted-foreground">Checked by {ctx.personName(opp.availability_by)} on {formatDateTime(opp.availability_at)}. {opp.availability_notes ?? ""}</p> : <p className="text-sm text-muted-foreground">No availability check is recorded.</p>}
            <p className="text-sm text-muted-foreground">A dated check, not a reservation.</p>
          </div>
        </Panel>
        <Panel title="Dates and place">
          <dl className="space-y-3">
            <Fact label="Installation starts">{opp.install_start ? formatDate(opp.install_start) : "Not confirmed"}</Fact>
            <Fact label="Show">{show ?? "Not confirmed"}</Fact>
            <Fact label="Location">{opp.location ?? "Not recorded"}</Fact>
          </dl>
        </Panel>
        <Panel title="Money and payment">
          <dl className="space-y-3">
            <Fact label="Confirmed value">{formatMoney(detail.item.value, opp.currency)}</Fact>
            <Fact label="Payment terms">{opp.payment_terms ?? "Not recorded"}</Fact>
            <Fact label="Zoho Books references (entered by hand)">
              {zoho && (zoho.quote_ref || zoho.invoice_ref) ? [zoho.quote_ref ? `Quote ${zoho.quote_ref}` : null, zoho.invoice_ref ? `Invoice ${zoho.invoice_ref}` : null].filter(Boolean).join(" · ") : "None recorded"}
            </Fact>
          </dl>
        </Panel>
        <Panel title="Contacts" className="md:col-span-2"><ContactsPanel contacts={detail.contacts} /></Panel>
        <Panel title="Unresolved risks" className="md:col-span-2">
          {opp.risks.length === 0 ? <Muted>None recorded.</Muted> : <ul className="list-disc space-y-1 pl-5 text-sm">{opp.risks.map((r, i) => <li key={`${i}-${r}`} className="break-words">{r}</li>)}</ul>}
        </Panel>
      </div>
      <p className="text-sm text-muted-foreground">Won {formatDate(opp.closed_at)}. To correct something in this package, change it on the opportunity; this page always shows the current facts.</p>
    </div>
  );
}
