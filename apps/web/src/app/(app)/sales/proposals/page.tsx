import Link from "next/link";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadProposals } from "@/lib/crm/data";
import { cn } from "@/lib/utils";
import type { CrmProposalRow } from "@/types/crm";
import { OpenFileButton } from "./proposal-file-link";

export const metadata = { title: "Proposals" };

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

function StatusBadge({ status }: { status: Status }) {
  const tone = status === "accepted" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : status === "sent" ? "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300" : "text-muted-foreground";
  return <Badge variant="outline" className={cn("whitespace-nowrap", tone)}>{STATUSES.find((s) => s.id === status)?.label ?? status}</Badge>;
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

const sentText = (p: CrmProposalRow) => (p.sent_on ? formatDate(p.sent_on) : p.status === "draft" ? "Not sent yet" : "Date not recorded");

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  const active = STATUSES.find((s) => s.id === sp.status)?.id ?? null;

  const all = await loadProposals(ctx);
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
        <h1 className="text-2xl font-semibold">Proposals</h1>
        <p className="text-muted-foreground">Every proposal version across the opportunities you can see. <strong className="font-medium text-foreground">Sent</strong> means it went to the client; it does not mean anyone approved it. Versions are added on the opportunity itself.</p>
      </div>

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
          title={all.length === 0 ? "No proposals yet" : `No ${active} proposals`}
          description={all.length === 0 ? "A proposal version appears here once it is recorded on an opportunity." : "Choose another status, or show all proposals."}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <caption className="sr-only">Proposal versions</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Opportunity</TableHead>
                  <TableHead scope="col">Version</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Sent</TableHead>
                  <TableHead scope="col">File or link</TableHead>
                  <TableHead scope="col">Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.proposal.id} className="align-top">
                    <TableCell className="min-w-0 max-w-xs">
                      {r.opportunity ? (
                        <>
                          <Link href={`/sales/opportunities/${r.opportunity.opp.id}`} className="break-words font-medium underline-offset-2 hover:underline">{r.opportunity.opp.title}</Link>
                          <p className="text-xs text-muted-foreground">{r.opportunity.opp.reference}{showCompany ? ` · ${r.opportunity.companyName}` : ""}</p>
                        </>
                      ) : <span className="text-muted-foreground">Opportunity not available</span>}
                      {r.proposal.note ? <p className="mt-1 break-words text-xs text-muted-foreground">{r.proposal.note}</p> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">v{r.proposal.version}</TableCell>
                    <TableCell><StatusBadge status={r.proposal.status} /></TableCell>
                    <TableCell className="whitespace-nowrap">{sentText(r.proposal)}</TableCell>
                    <TableCell className="max-w-xs"><FileCell row={r} /></TableCell>
                    <TableCell>{r.opportunity?.ownerName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="divide-y divide-border rounded-md border border-border md:hidden">
            {rows.map((r) => (
              <li key={r.proposal.id} className="space-y-1.5 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  {r.opportunity ? (
                    <Link href={`/sales/opportunities/${r.opportunity.opp.id}`} className="min-w-0 break-words font-medium underline-offset-2 hover:underline">{r.opportunity.opp.title}</Link>
                  ) : <span className="text-muted-foreground">Opportunity not available</span>}
                  <StatusBadge status={r.proposal.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.opportunity ? `${r.opportunity.opp.reference} · ` : ""}v{r.proposal.version} · Sent: {sentText(r.proposal)}{r.opportunity ? ` · Owner ${r.opportunity.ownerName}` : ""}
                </p>
                {r.proposal.note ? <p className="break-words text-xs text-muted-foreground">{r.proposal.note}</p> : null}
                <div className="text-sm"><FileCell row={r} /></div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
