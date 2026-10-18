import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { hasProjCapability, projectStatusLabel, PROJECT_STATUSES } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KindBadge, ProjectStatusBadge } from "@/components/projects/badges";
import { Muted, PageHeader } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { loadDirectory } from "@/lib/projects/data";
import { dateRangeText } from "@/lib/projects/format";
import { loadProjectsAttention } from "@/lib/projects/my-work";
import { filterDirectory } from "@/lib/projects/work-logic";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Projects" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProjectsOverviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getProjectsContext();
  if (!ctx) return null;

  const [directory, attention] = await Promise.all([loadDirectory(), loadProjectsAttention(ctx)]);
  const unreadBy = new Map<string, number>();
  if (ctx.grants.length > 0 || directory.some((d) => d.is_member)) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("proj_unread_counts");
    for (const r of data ?? []) if (r.unread > 0) unreadBy.set(r.project_id, r.unread);
  }

  const companies = [...new Map(directory.map((d) => [d.company_id, ctx.companyName(d.company_id)])).entries()];
  const q = first(sp.q).slice(0, 100);
  const company = companies.some(([id]) => id === first(sp.company)) ? first(sp.company) : "";
  const kind = first(sp.kind) === "client" || first(sp.kind) === "internal" ? first(sp.kind) : "";
  const status = (PROJECT_STATUSES as readonly string[]).includes(first(sp.status)) ? first(sp.status) : "";
  const view = first(sp.view) === "finished" ? "finished" : "live";
  const rows = filterDirectory(directory, { q, company, kind, status, view });
  const liveCount = directory.filter((d) => d.status !== "completed" && d.status !== "archived").length;
  const finishedCount = directory.length - liveCount;
  const filtered = !!(q || company || kind || status);

  const salesOnly = ctx.grants.length === 0;
  const canAssign = ctx.grants.some((g) => hasProjCapability([g], g.companyId, "assign_pm"));
  const needs = [
    attention.handoversWaiting > 0 ? { label: `${attention.handoversWaiting} handover${attention.handoversWaiting === 1 ? "" : "s"} waiting on you`, href: "/projects/handovers" } : null,
    attention.reviewsWaiting > 0 ? { label: `${attention.reviewsWaiting} task${attention.reviewsWaiting === 1 ? "" : "s"} waiting for your review`, href: "/projects/work#reviews" } : null,
    attention.overdueTasks > 0 ? { label: `${attention.overdueTasks} overdue task${attention.overdueTasks === 1 ? "" : "s"} of yours`, href: "/projects/work" } : null,
    attention.unreadMessages > 0 ? { label: `${attention.unreadMessages} unread discussion message${attention.unreadMessages === 1 ? "" : "s"} in ${attention.unreadProjects} project${attention.unreadProjects === 1 ? "" : "s"}`, href: "/projects/work" } : null,
  ].filter((n): n is { label: string; href: string } => n !== null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description={salesOnly ? "The projects linked to your Sales work, with their handover status." : "Ongoing projects in your companies. You see the summary of every project; the details are for the people working on it."}
        actions={
          <>
            {!salesOnly ? <Link href="/projects/work" className={buttonVariants({ variant: "outline" })}>My Work</Link> : null}
            {canAssign ? <Link href="/projects/new" className={buttonVariants()}>New internal project</Link> : null}
          </>
        }
      />

      {!salesOnly ? (
        needs.length > 0 ? (
          <Card>
            <CardContent className="pt-5">
              <h2 className="text-sm font-semibold">Needs you</h2>
              <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                {needs.map((n) => (
                  <li key={n.label}><Link href={n.href} className="font-medium underline underline-offset-2 hover:text-foreground">{n.label}</Link></li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : (
          <Muted>Nothing is waiting on you in Projects right now.</Muted>
        )
      ) : null}

      <form method="get" action="/projects" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="search" aria-label="Filter projects">
        <input type="hidden" name="view" value={view} />
        <label className="space-y-1.5 text-sm font-medium lg:col-span-2">
          Search
          <Input name="q" defaultValue={q} placeholder="Reference, name or Project Manager" />
        </label>
        {companies.length > 1 ? (
          <label className="space-y-1.5 text-sm font-medium">
            Company
            <Select name="company" defaultValue={company}>
              <option value="">All companies</option>
              {companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
          </label>
        ) : null}
        <label className="space-y-1.5 text-sm font-medium">
          Kind
          <Select name="kind" defaultValue={kind}>
            <option value="">Client and internal</option>
            <option value="client">Client projects</option>
            <option value="internal">Internal projects</option>
          </Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Status
          <Select name="status" defaultValue={status}>
            <option value="">Any status</option>
            {PROJECT_STATUSES.filter((s) => (view === "finished") === (s === "completed" || s === "archived")).map((s) => <option key={s} value={s}>{projectStatusLabel(s)}</option>)}
          </Select>
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="secondary">Apply</Button>
          {filtered ? <Link href={`/projects?view=${view}`} className={buttonVariants({ variant: "ghost" })}>Clear</Link> : null}
        </div>
      </form>

      <nav aria-label="Live or finished" className="flex gap-1 border-b border-border">
        {([["live", `Ongoing (${liveCount})`], ["finished", `Completed and archived (${finishedCount})`]] as const).map(([v, label]) => (
          <Link key={v} href={`/projects?view=${v}`} aria-current={view === v ? "page" : undefined}
            className={`rounded-t-md border-b-2 px-3 py-2 text-sm font-medium ${view === v ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={directory.length === 0 ? (salesOnly ? "No project is linked to your Sales work yet" : "No projects yet") : filtered ? "No project matches those filters" : view === "live" ? "No ongoing projects" : "No completed projects"}
          description={
            directory.length === 0
              ? salesOnly ? "When a Project Manager accepts a handover you prepared, the project appears here with its status." : canAssign ? "Projects start from an accepted Sales handover, or you can create an internal project." : "A project appears here when a Sales handover is accepted or an internal project is created."
              : filtered ? "Clear the filters to see everything you can see." : undefined
          }
          action={directory.length === 0 && canAssign ? <Link href="/projects/new" className={buttonVariants({ size: "sm" })}>New internal project</Link> : undefined}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Project</TableHead>
              {companies.length > 1 ? <TableHead>Company</TableHead> : null}
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Project Manager</TableHead>
              <TableHead>Dates</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap text-sm">{p.reference}</TableCell>
                <TableCell className="min-w-[12rem]">
                  <Link href={`/projects/${p.id}`} className="break-words font-medium underline-offset-2 hover:underline">{p.name}</Link>
                  {unreadBy.get(p.id) ? <span className="ml-2 rounded-full bg-accent px-1.5 text-[13px] font-semibold text-accent-foreground" title="Unread discussion messages">{unreadBy.get(p.id)} unread</span> : null}
                  {p.is_sales_linked && !p.is_member ? <span className="ml-2 text-sm text-muted-foreground">Linked to your Sales work</span> : null}
                </TableCell>
                {companies.length > 1 ? <TableCell className="text-sm">{ctx.companyName(p.company_id)}</TableCell> : null}
                <TableCell><KindBadge kind={p.kind} ongoing={p.is_ongoing} /></TableCell>
                <TableCell><ProjectStatusBadge status={p.status} /></TableCell>
                <TableCell className="text-sm">{p.pm_name ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">{dateRangeText(p.start_date, p.end_date)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!salesOnly && directory.some((d) => !d.is_member && d.kind) ? (
        <Alert role="status">Projects you are not part of show their summary only: reference, name, status, Project Manager and high-level dates. Their clients, plans, discussion and files are visible only to their members and to founders.</Alert>
      ) : null}
    </div>
  );
}
