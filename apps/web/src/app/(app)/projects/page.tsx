import Link from "next/link";
import { cn } from "@/lib/utils";
import { listTable } from "@/components/workspace/list-table";
import { FolderKanban } from "lucide-react";
import { hasProjCapability, isProjFounder, projectStatusLabel, PROJECT_STATUSES } from "@enginious-hr/domain";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { KindBadge, ProjectStatusBadge } from "@/components/projects/badges";
import { PageHeader, Muted } from "@/components/projects/parts";
import { OsHero } from "@/components/os/hero";
import { OsAvatar } from "@/components/os/pills";
import { ProjectBoard, type BoardProject } from "@/components/projects/project-board";
import { QuickNewProject, type QuickProjectCompany } from "@/components/projects/quick-new-project";
import { SummaryPanel } from "@/components/projects/summary-panel";
import { ListToolbar } from "@/components/workspace/list-toolbar";
import { ClickableRow } from "@/components/workspace/clickable-row";
import { PanelLink } from "@/components/workspace/panel-link";
import { SidePanel } from "@/components/workspace/side-panel";
import { SortHead } from "@/components/workspace/sort-head";
import { LoadError } from "@/components/workspace/states";
import { firstParam, nextSort, parseRecordId, parseSort, parseView, sortToParam, withParams } from "@/components/workspace/url-state";
import { ViewSwitch } from "@/components/workspace/view-switch";
import { getProjectsContext } from "@/lib/projects/context";
import { loadDirectoryResult } from "@/lib/projects/data";
import { canChangeStatus, canSeeProjectDetails, DEFAULT_DIRECTORY_SORT, DIRECTORY_SORT_KEYS, milestoneProjectIds, nextMilestones, sortDirectory } from "@/lib/projects/directory";
import { dateRangeText, formatDate } from "@/lib/projects/format";
import { loadProjectsAttention } from "@/lib/projects/my-work";
import { filterDirectory } from "@/lib/projects/work-logic";
import { createClient } from "@/lib/supabase/server";
import { RememberList } from "@/components/workspace/list-memory";

export const metadata = { title: "Projects" };

type Params = Record<string, string | string[] | undefined>;

export default async function ProjectsDirectoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getProjectsContext();
  if (!ctx) return null;

  const [{ rows: directory, error }, attention] = await Promise.all([loadDirectoryResult(), loadProjectsAttention(ctx)]);
  if (error) return <div className="space-y-4"><PageHeader title="Projects" /><LoadError what="the projects" retryHref="/projects" /></div>;

  const salesOnly = ctx.grants.length === 0;
  const supabase = await createClient();

  // ---- state from the address (never trusted: unknown values fall back to a default)
  const companies = [...new Map(directory.map((d) => [d.company_id, ctx.companyName(d.company_id)])).entries()];
  const q = firstParam(sp, "q").slice(0, 100);
  const company = companies.some(([id]) => id === firstParam(sp, "company")) ? firstParam(sp, "company") : "";
  const kind = firstParam(sp, "kind") === "client" || firstParam(sp, "kind") === "internal" ? firstParam(sp, "kind") : "";
  // "view=finished" was the old way to ask for completed projects: still honoured for old bookmarks.
  const finished = firstParam(sp, "show") === "finished" || firstParam(sp, "view") === "finished";
  const view = finished ? "table" : parseView(firstParam(sp, "view"), "table");
  const status = (PROJECT_STATUSES as readonly string[]).includes(firstParam(sp, "status")) && (finished === (firstParam(sp, "status") === "completed" || firstParam(sp, "status") === "archived")) ? firstParam(sp, "status") : "";
  const sort = parseSort(firstParam(sp, "sort"), DIRECTORY_SORT_KEYS, DEFAULT_DIRECTORY_SORT);
  const filtered = filterDirectory(directory, { q, company, kind, status, view: finished ? "finished" : "live" });
  const liveCount = directory.filter((d) => d.status !== "completed" && d.status !== "archived").length;
  const finishedCount = directory.length - liveCount;
  const anyFilter = !!(q || company || kind || status);

  // ---- next milestone: asked for only where the person may see project details (members and founders), nothing for anyone else
  const visibleIds = milestoneProjectIds(filtered, ctx.grants);
  const showMilestone = view === "table" && !finished && visibleIds.length > 0;
  let milestoneError = false;
  let nextBy = new Map<string, { title: string; due: string }>();
  if (showMilestone) {
    const { data, error: mErr } = await supabase.from("proj_milestones").select("project_id, title, due_date, status").in("project_id", visibleIds).in("status", ["planned", "in_progress", "ready_for_acceptance"]).not("due_date", "is", null);
    if (mErr) milestoneError = true;
    else nextBy = nextMilestones(data ?? []);
  }
  const rows = sortDirectory(filtered, sort, new Map([...nextBy].map(([k, v]) => [k, v.due])));

  // ---- unread discussion counts (members only: the function returns nothing for projects you are not on)
  const unreadBy = new Map<string, number>();
  if (!salesOnly || directory.some((d) => d.is_member)) {
    const { data } = await supabase.rpc("proj_unread_counts");
    for (const r of data ?? []) if (r.unread > 0) unreadBy.set(r.project_id, r.unread);
  }

  // ---- who may add an internal project
  const addCompanies: QuickProjectCompany[] = ctx.companies
    .filter((c) => hasProjCapability(ctx.grants, c.id, "assign_pm"))
    .map((c) => ({ id: c.id, name: c.name, referenceCode: c.referenceCode, isFounder: isProjFounder(ctx.grants, c.id), people: ctx.people.filter((p) => p.companyIds.includes(c.id)).map((p) => ({ id: p.id, name: p.name })) }));

  const needs = [
    attention.handoversWaiting > 0 ? { label: `${attention.handoversWaiting} handover${attention.handoversWaiting === 1 ? "" : "s"} waiting on you`, href: "/projects/handovers" } : null,
    attention.reviewsWaiting > 0 ? { label: `${attention.reviewsWaiting} waiting for your review`, href: "/projects/work" } : null,
    attention.overdueTasks > 0 ? { label: `${attention.overdueTasks} overdue task${attention.overdueTasks === 1 ? "" : "s"} of yours`, href: "/projects/work" } : null,
    attention.unreadMessages > 0 ? { label: `${attention.unreadMessages} unread message${attention.unreadMessages === 1 ? "" : "s"} in ${attention.unreadProjects} project${attention.unreadProjects === 1 ? "" : "s"}`, href: "/projects/work" } : null,
  ].filter((n): n is { label: string; href: string } => n !== null);

  // ---- side panel: the authorised summary of one project (?open=ID)
  const openId = parseRecordId(firstParam(sp, "open"));
  const openRow = openId ? directory.find((d) => d.id === openId) : undefined;
  let openHandover: { status: string; crm_reference: string; accepted_at: string | null } | null = null;
  if (openRow && openRow.is_sales_linked && !canSeeProjectDetails(openRow, ctx.grants) && openRow.kind === "client") {
    const { data } = await supabase.from("proj_handovers").select("status, crm_reference, accepted_at").eq("project_id", openRow.id).maybeSingle();
    openHandover = data ?? null;
  }

  const href = (patch: Record<string, string | null>, drop: readonly string[] = []) => withParams("/projects", sp, patch, drop);
  const sortHref = (key: (typeof DIRECTORY_SORT_KEYS)[number]) => href({ sort: sortToParam(nextSort(sort, key)) });
  const detailsHref = (id: string, details: boolean) => (details ? `/projects/${id}` : href({ open: id }));

  const boardProjects: BoardProject[] = rows.map((p) => {
    const details = canSeeProjectDetails(p, ctx.grants);
    return {
      id: p.id, name: p.name, reference: p.reference, kind: p.kind, isOngoing: p.is_ongoing, status: p.status, pmName: p.pm_name ?? "—", dates: dateRangeText(p.start_date, p.end_date),
      href: detailsHref(p.id, details), panel: !details, canMove: canChangeStatus(p, ctx.userId, ctx.grants), unread: unreadBy.get(p.id) ?? 0,
    };
  });

  return (
    <div className="space-y-5">
      <RememberList section="projects" />
      <OsHero
        title="Projects"
        sub={salesOnly ? "The projects linked to your Sales work, with their handover status." : `${liveCount} ongoing · ${finishedCount} completed or archived${companies.length === 1 ? ` · ${companies[0]![1]}` : ""}`}
      >
        {!salesOnly && addCompanies.length > 0 ? <QuickNewProject companies={addCompanies} /> : null}
      </OsHero>

      {!salesOnly && needs.length > 0 ? (
        <section aria-label="Needs you" className="os-card os-warm flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-3 text-sm">
          <span className="font-semibold">Needs you</span>
          {needs.map((n) => <Link key={n.label} href={n.href} className="font-medium underline underline-offset-2 hover:text-foreground">{n.label}</Link>)}
        </section>
      ) : null}

      <div className="os-card p-3 sm:p-4">
      <ListToolbar
        search={{ value: q, placeholder: "Search by name, reference or Project Manager", label: "Search projects" }}
        clearHref={href({}, ["q", "company", "kind", "status"])}
        filters={[
          { name: "show", label: "Show", value: finished ? "finished" : "", options: [{ value: "", label: `Ongoing (${liveCount})` }, { value: "finished", label: `Completed and archived (${finishedCount})` }] },
          { name: "kind", label: "Kind", value: kind, options: [{ value: "", label: "Client and internal" }, { value: "client", label: "Client projects" }, { value: "internal", label: "Internal projects" }] },
          { name: "status", label: "Status", value: status, options: [{ value: "", label: "Any status" }, ...PROJECT_STATUSES.filter((s) => finished === (s === "completed" || s === "archived")).map((s) => ({ value: s, label: projectStatusLabel(s) }))] },
          ...(companies.length > 1 ? [{ name: "company", label: "Company", value: company, options: [{ value: "", label: "All companies" }, ...companies.map(([id, name]) => ({ value: id, label: name }))] }] : []),
        ]}
      >
        {!finished && !salesOnly ? <ViewSwitch current={view} tableHref={href({ view: null })} boardHref={href({ view: "board" })} boardLabel="Board" /> : null}
      </ListToolbar>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={directory.length === 0 ? (salesOnly ? "No project is linked to your Sales work yet" : "No projects yet") : anyFilter ? "No project matches those filters" : finished ? "No completed projects" : "No ongoing projects"}
          description={
            directory.length === 0
              ? salesOnly ? "When a Project Manager accepts a handover you prepared, the project appears here with its status." : addCompanies.length > 0 ? "Projects start from an accepted Sales handover, or you can add an internal project." : "A project appears here when a Sales handover is accepted or an internal project is created."
              : anyFilter ? "Clear the filters to see everything you can see." : undefined
          }
        />
      ) : view === "board" ? (
        <ProjectBoard projects={boardProjects} />
      ) : (
        <>
          <Table className={cn("min-w-[44rem]", listTable)}>
            <caption className="sr-only">Projects</caption>
            <TableHeader>
              <TableRow>
                <SortHead label="Project" href={sortHref("name")} active={sort.key === "name"} dir={sort.dir} />
                {companies.length > 1 ? <TableHead scope="col">Company</TableHead> : null}
                <SortHead label="Project Manager" href={sortHref("pm")} active={sort.key === "pm"} dir={sort.dir} />
                <SortHead label="Status" href={sortHref("status")} active={sort.key === "status"} dir={sort.dir} />
                <SortHead label="Key dates" href={sortHref("dates")} active={sort.key === "dates"} dir={sort.dir} />
                {showMilestone ? <SortHead label="Next milestone" href={sortHref("milestone")} active={sort.key === "milestone"} dir={sort.dir} /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const details = canSeeProjectDetails(p, ctx.grants);
                const next = nextBy.get(p.id);
                const Name = details ? Link : PanelLink;
                return (
                  <ClickableRow key={p.id} href={detailsHref(p.id, details)} panel={!details} selected={openRow?.id === p.id} className="align-top">
                    <TableCell className="min-w-[13rem]">
                      <Name href={detailsHref(p.id, details)} className="break-words font-medium underline-offset-2 hover:underline">{p.name}</Name>
                      {unreadBy.get(p.id) ? <span className="ml-2 rounded-full bg-accent px-1.5 text-[13px] font-semibold text-accent-foreground">{unreadBy.get(p.id)} unread</span> : null}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"><span>{p.reference}</span><KindBadge kind={p.kind} ongoing={p.is_ongoing} /></div>
                    </TableCell>
                    {companies.length > 1 ? <TableCell data-label="Company" className="text-sm">{ctx.companyName(p.company_id)}</TableCell> : null}
                    <TableCell data-label="Project Manager" className="text-sm">{p.pm_name ? <span className="inline-flex items-center gap-2"><OsAvatar name={p.pm_name} size="sm" />{p.pm_name}</span> : "—"}</TableCell>
                    <TableCell data-label="Status"><ProjectStatusBadge status={p.status} /></TableCell>
                    <TableCell data-label="Key dates" className="whitespace-nowrap text-sm">{dateRangeText(p.start_date, p.end_date)}</TableCell>
                    {showMilestone ? (
                      <TableCell data-label="Next milestone" className="min-w-[10rem] text-sm">
                        {!details ? <span className="text-muted-foreground">Members only</span> : milestoneError ? <span className="text-muted-foreground">Not available</span> : next ? <>{next.title}<span className="block text-muted-foreground">{formatDate(next.due)}</span></> : <span className="text-muted-foreground">None dated</span>}
                      </TableCell>
                    ) : null}
                  </ClickableRow>
                );
              })}
            </TableBody>
          </Table>
          {milestoneError ? <Muted>Next milestones could not be loaded just now; everything else is shown.</Muted> : null}
        </>
      )}

      {!salesOnly && rows.some((r) => !canSeeProjectDetails(r, ctx.grants)) ? (
        <Muted>Projects you are not part of show their summary only. Their plans, discussion and files are for their members and founders.</Muted>
      ) : null}

      {openRow ? (
        <SidePanel title={openRow.name} subtitle={openRow.reference} closeHref={href({ open: null })} fullPageHref={`/projects/${openRow.id}`}>
          <SummaryPanel
            facts={{ reference: openRow.reference, companyName: ctx.companyName(openRow.company_id), kind: openRow.kind, isOngoing: openRow.is_ongoing, status: openRow.status, pmName: openRow.pm_name ?? "—", startDate: openRow.start_date, endDate: openRow.end_date }}
            handover={openHandover}
          />
          {canSeeProjectDetails(openRow, ctx.grants) ? <Link href={`/projects/${openRow.id}`} className={`${buttonVariants()} mt-5`}>Open project</Link> : null}
        </SidePanel>
      ) : null}
    </div>
  );
}
