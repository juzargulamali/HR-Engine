import Link from "next/link";
import { FileText } from "lucide-react";
import { OsBadge, type OsTone } from "@/components/os/pills";
import { ClickableCard } from "@/components/workspace/clickable-card";
import { ClickableRow } from "@/components/workspace/clickable-row";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { LoadError } from "@/components/workspace/states";
import { DueText } from "@/components/sales/badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadProposals, PROPOSALS_LIMIT } from "@/lib/crm/data";
import { cn } from "@/lib/utils";
import type { CrmProposalRow } from "@/types/crm";
import { estimateNoteText } from "@/lib/crm/quotations/wording";
import { OpenFileButton } from "./proposal-file-link";

export const metadata = { title: "Proposals & quotes" };

/** The enquiry's tab that holds its proposal versions and files (the tab id in opportunities/[id]/page.tsx). A row opens the enquiry there, not on its overview. */
const PROPOSALS_TAB = "proposals";
/** An estimate row opens the enquiry's Estimates tab, where estimates are finalised and recorded as sent. */
const ESTIMATES_TAB = "quotations";
const enquiryHref = (opportunityId: string, estimate?: unknown) => `/sales/opportunities/${opportunityId}?tab=${estimate ? ESTIMATES_TAB : PROPOSALS_TAB}`;

type Status = CrmProposalRow["status"];
const STATUSES: { id: Status; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "sent", label: "Sent" },
  { id: "accepted", label: "Accepted" },
  { id: "superseded", label: "Superseded" },
];
const STATUS_HELP: Record<Status, string> = {
  draft: "Being prepared; not sent to the client",
  sent: "Sent to the client; this is not an approval",
  accepted: "The client accepted this version",
  superseded: "Replaced by a newer version",
};

const STATUS_TONE: Record<Status, OsTone> = { draft: "neutral", sent: "blue", accepted: "green", superseded: "quiet" };
function StatusBadge({ status, estimate }: { status: Status; estimate?: { finalised: boolean } | null }) {
  // An estimate is a budgetary document, not an official quotation sent to the client: it is labelled as an estimate, never as Draft / Sent proposal.
  if (estimate && status === "draft") return <OsBadge tone={estimate.finalised ? "green" : "neutral"} dot className="whitespace-nowrap">{estimate.finalised ? "Estimate, finalised" : "Estimate, draft"}</OsBadge>;
  return <OsBadge tone={STATUS_TONE[status]} dot={status !== "superseded"} className="whitespace-nowrap">{STATUSES.find((s) => s.id === status)?.label ?? status}</OsBadge>;
}

type Row = Awaited<ReturnType<typeof loadProposals>>[number];

function FileCell({ row }: { row: Row }) {
  const f = row.file;
  if (!f) return <span className="text-muted-foreground">No file or link attached</span>;
  const label = f.label || f.original_name || (f.kind === "link" ? "Link" : "File");
  if (f.kind === "link" && f.url && /^https?:\/\//i.test(f.url)) {
    return <a href={f.url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2 hover:no-underline">{label}<span className="sr-only"> (opens in a new tab)</span></a>;
  }
  if (f.kind === "file") return <OpenFileButton fileId={f.id} name={label} />;
  return <span className="break-words">{label}</span>;
}

/**
 * What happens next for a version, beside its status: the enquiry's own next follow-up when one is planned (who is doing what, by when), otherwise a
 * plain statement that nothing is planned. A closed enquiry needs no next action. Nothing here is inferred from the status.
 */
function NextAction({ row }: { row: Row }) {
  const opp = row.opportunity;
  if (!opp) return <span className="text-muted-foreground">Enquiry not available</span>;
  if (opp.opp.stage === "won" || opp.opp.stage === "lost") return <span className="text-muted-foreground">None: the enquiry is {opp.opp.stage}</span>;
  if (row.proposal.status === "superseded") return <span className="text-muted-foreground">None: replaced by a newer version</span>;
  const f = opp.nextFollowUp;
  // On hold is the one open stage that may have no follow-up: it carries a review date on the enquiry instead.
  if (!f) return opp.opp.stage === "on_hold" ? <span className="text-muted-foreground">None: the enquiry is on hold</span> : <span className="font-medium text-[hsl(var(--os-amber))]">No follow-up planned on the enquiry</span>;
  return <span className="break-words"><span className="font-medium">{f.title}</span> <span className="text-muted-foreground">·</span> <DueText dueAt={f.due_at} className="whitespace-normal" /></span>;
}

const sentText = (p: CrmProposalRow, estimate?: { finalised: boolean } | null) => (estimate && p.status === "draft" ? "Recorded on the enquiry's Estimates tab" : p.sent_on ? formatDate(p.sent_on) : p.status === "draft" ? "Not sent yet" : "Date not recorded");

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  const active = STATUSES.find((s) => s.id === sp.status)?.id ?? null;

  const title = (
    <h1 className="text-2xl font-semibold">
      Proposals &amp; quotes
      <InfoHint label="Proposals & quotes" className="ml-1.5">
        Every proposal version and estimate across the enquiries you can see, newest first. <strong className="font-medium">Sent</strong> means someone recorded that it went to the client: nothing is sent from here, and it does not mean anyone approved it. Versions are added on the enquiry itself, on its Proposals &amp; files tab, which is where each row opens.
      </InfoHint>
    </h1>
  );
  let all: Row[];
  try {
    all = await loadProposals(ctx);
  } catch (e) {
    console.error("[crm] proposals load failed", e);
    return <div className="space-y-6">{title}<LoadError what="proposals and quotes" retryHref="/sales/proposals" /></div>;
  }
  // The read is bounded to the newest PROPOSALS_LIMIT versions: when it comes back full, older ones exist that are not listed or counted here.
  const full = all.length >= PROPOSALS_LIMIT;
  const counts = new Map<Status, number>();
  for (const r of all) counts.set(r.proposal.status, (counts.get(r.proposal.status) ?? 0) + 1);
  const rows = active ? all.filter((r) => r.proposal.status === active) : all;
  const showCompany = ctx.companies.length > 1;

  const filters: { href: string; label: string; count: number; on: boolean }[] = [
    { href: "/sales/proposals", label: "All", count: all.length, on: active === null },
    ...STATUSES.map((s) => ({ href: `/sales/proposals?status=${s.id}`, label: s.label, count: counts.get(s.id) ?? 0, on: active === s.id })),
  ];

  return (
    <div className="space-y-6">
      <div>
        {title}
        <p className="text-sm text-muted-foreground">Each version with its status and what happens next. A row opens the enquiry at its proposals.</p>
      </div>
      {full ? (
        <Alert variant="warning" role="alert" data-testid="proposals-limit">
          Showing the latest {PROPOSALS_LIMIT} versions. Older ones are not listed or counted here: open the enquiry to see all of its versions.
        </Alert>
      ) : null}

      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f.label}
            href={f.href}
            aria-current={f.on ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm", f.on ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {f.label} <span className="tabular-nums">({f.count})</span>
          </Link>
        ))}
      </nav>
      {active ? <p className="text-sm text-muted-foreground">{STATUS_HELP[active]}.</p> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={all.length === 0 ? "No proposals yet" : `No ${active} proposals${full ? " in the latest versions" : ""}`}
          description={all.length === 0 ? "A proposal version appears here once it is recorded on an enquiry: open the enquiry, then its Proposals & files tab." : "Choose another status, or show all proposals."}
          action={all.length === 0 ? <Link href="/sales/opportunities" className="text-sm font-medium underline underline-offset-2">Open Enquiries</Link> : undefined}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table stack>
              <caption className="sr-only">Proposal versions</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Enquiry</TableHead>
                  <TableHead scope="col">Version and status</TableHead>
                  <TableHead scope="col">Next action</TableHead>
                  <TableHead scope="col">Sent</TableHead>
                  <TableHead scope="col">File or link</TableHead>
                  <TableHead scope="col">Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <ClickableRow key={r.proposal.id} href={r.opportunity ? enquiryHref(r.opportunity.opp.id, r.estimate) : "/sales/proposals"} className="align-top">
                    <TableCell className="min-w-0 max-w-xs">
                      {r.opportunity ? (
                        <>
                          <Link href={enquiryHref(r.opportunity.opp.id, r.estimate)} title={r.opportunity.opp.title} className="break-words font-medium underline-offset-2 hover:underline">{r.opportunity.opp.title}</Link>
                          <p className="text-sm text-muted-foreground">{r.opportunity.opp.reference}{showCompany ? ` · ${r.opportunity.companyName}` : ""}</p>
                        </>
                      ) : <span className="text-muted-foreground">Enquiry not available</span>}
                      {r.proposal.note ? <p className="mt-1 break-words text-sm text-muted-foreground">{r.estimate ? estimateNoteText(r.proposal.note) : r.proposal.note}</p> : null}
                    </TableCell>
                    <TableCell><span className="flex flex-wrap items-center gap-1.5"><span className="whitespace-nowrap font-medium tabular-nums">v{r.proposal.version}</span><StatusBadge status={r.proposal.status} estimate={r.estimate} /></span></TableCell>
                    <TableCell className="min-w-[10rem] max-w-xs"><NextAction row={r} /></TableCell>
                    <TableCell className="whitespace-nowrap">{sentText(r.proposal, r.estimate)}</TableCell>
                    <TableCell className="max-w-xs"><FileCell row={r} /></TableCell>
                    <TableCell>{r.opportunity?.ownerName ?? "—"}</TableCell>
                  </ClickableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="divide-y divide-border rounded-xl border border-border md:hidden">
            {rows.map((r) => (
              <ClickableCard as="li" key={r.proposal.id} href={r.opportunity ? enquiryHref(r.opportunity.opp.id, r.estimate) : "/sales/proposals"} className="space-y-1.5 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  {r.opportunity ? (
                    <Link href={enquiryHref(r.opportunity.opp.id, r.estimate)} className="min-w-0 break-words font-medium underline-offset-2 hover:underline">{r.opportunity.opp.title}</Link>
                  ) : <span className="text-muted-foreground">Enquiry not available</span>}
                  <span className="flex shrink-0 items-center gap-1.5"><span className="font-medium tabular-nums">v{r.proposal.version}</span><StatusBadge status={r.proposal.status} estimate={r.estimate} /></span>
                </div>
                <p className="text-sm"><span className="text-muted-foreground">Next action: </span><NextAction row={r} /></p>
                <p className="text-sm text-muted-foreground">
                  {r.opportunity ? `${r.opportunity.opp.reference} · ` : ""}Sent: {sentText(r.proposal, r.estimate)}{r.opportunity ? ` · Owner ${r.opportunity.ownerName}` : ""}
                </p>
                {r.proposal.note ? <p className="break-words text-sm text-muted-foreground">{r.estimate ? estimateNoteText(r.proposal.note) : r.proposal.note}</p> : null}
                <div className="text-sm"><FileCell row={r} /></div>
              </ClickableCard>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
