import { loadProjectUnread } from "@/lib/chat/data";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { listTable } from "@/components/workspace/list-table";
import { FolderKanban } from "lucide-react";
import { hasProjCapability, isProjFounder, projectStatusLabel, PROJECT_STATUSES } from "@enginious-hr/domain";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
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
import { loadDirectoryResult, loadProjectEditions } from "@/lib/projects/data";
import { buildActivityPreviews, noCommitmentText, pickNextCommitment, teamStanding, type ActivityPreview, type Commitment } from "@/lib/projects/list-extras";
import type { SiteActivityRead } from "@/lib/projects/phase2/model";
import { canChangeStatus, canSeeProjectDetails, DEFAULT_DIRECTORY_SORT, DIRECTORY_SORT_KEYS, editionChoices, filterByEdition, milestoneProjectIds, nextMilestones, sortDirectory, type ProjectEdition } from "@/lib/projects/directory";
import { dateRangeText, formatDate, todayIso } from "@/lib/projects/format";
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

  const [{ rows: directory, error }, attention, editionsRes] = await Promise.all([
    loadDirectoryResult(), loadProjectsAttention(ctx).catch((e) => { console.error("[projects] needs-you load failed", e); return null; }),
    // The event edition of each project (the copy taken at the handover). A failed read leaves the directory usable and says editions could not be loaded.
    loadProjectEditions().catch(() => ({ state: "error" as const })),
  ]);
  const editionBy = editionsRes.state === "ok" ? editionsRes.byProject : new Map<string, ProjectEdition>();
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
  const editions = editionChoices(editionBy, directory);
  const edition = editions.some((e) => e.value === firstParam(sp, "edition")) ? firstParam(sp, "edition") : "";
  const filtered = filterByEdition(filterDirectory(directory, { q, company, kind, status, view: finished ? "finished" : "live" }), editionBy, edition);
  const liveCount = directory.filter((d) => d.status !== "completed" && d.status !== "archived").length;
  const finishedCount = directory.length - liveCount;
  const anyFilter = !!(q || company || kind || status || edition);

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

  // ---- next commitment, team standing and a combined recent-activity preview: each read once for the whole page (never per project), only for projects the person may see in detail.
  // A failed or not-yet-installed read leaves the list usable and says what is missing.
  const today = todayIso();
  const detailIds = rows.filter((r) => canSeeProjectDetails(r, ctx.grants)).map((r) => r.id);
  const wantsExtras = !finished && detailIds.length > 0;
  const siteActivities: SiteActivityRead[] = [];
  let siteError = false;
  const teamCounts = new Map<string, { leads: number; members: number }>();
  let teamError = false;
  let previews = new Map<string, ActivityPreview>();
  let activityError = false;
  // Milestones are asked for in the table only; the board and the commitment column use the same read, so the board asks too.
  if (wantsExtras && view === "board") {
    const { data, error: mErr } = await supabase.from("proj_milestones").select("project_id, title, due_date, status").in("project_id", detailIds).in("status", ["planned", "in_progress", "ready_for_acceptance"]).not("due_date", "is", null);
    if (mErr) milestoneError = true;
    else nextBy = nextMilestones(data ?? []);
  }
  if (wantsExtras) {
    const companyIdsInList = [...new Set(rows.filter((r) => detailIds.includes(r.id)).map((r) => r.company_id))];
    const [siteReads, teamsRes, membersRes, logRes] = await Promise.all([
      Promise.all(companyIdsInList.map((cid) => supabase.rpc("proj_site_activities_read", { p_company_id: cid, p_limit: 300 }))),
      supabase.from("proj_teams").select("project_id, head_user_id").in("project_id", detailIds).is("removed_at", null),
      supabase.from("proj_project_members").select("project_id").in("project_id", detailIds).is("removed_at", null),
      supabase.from("proj_change_log").select("id, project_id, entity_type, entity_id, field, from_value, to_value, note, actor_id").in("project_id", detailIds).order("id", { ascending: false }).limit(60),
    ]);
    for (const r of siteReads) {
      if (r.error) { if (!/does not exist|schema cache|42883|PGRST202/i.test(`${r.error.code} ${r.error.message}`)) siteError = true; continue; }
      if (Array.isArray(r.data)) siteActivities.push(...(r.data as unknown as SiteActivityRead[]));
    }
    if (teamsRes.error || membersRes.error) teamError = true;
    else {
      for (const id of detailIds) teamCounts.set(id, { leads: 0, members: 0 });
      for (const t of teamsRes.data ?? []) if (t.head_user_id) teamCounts.get(t.project_id)!.leads += 1;
      for (const m of membersRes.data ?? []) teamCounts.get(m.project_id)!.members += 1;
    }
    if (logRes.error) activityError = true;
    else previews = buildActivityPreviews(logRes.data ?? [], ctx.personName);
  }
  const commitmentOf = (p: { id: string; pm_name: string | null }): Commitment | null => pickNextCommitment(p.id, siteActivities, nextBy.get(p.id), today);

  // ---- unread project chat counts (members only: the server lists a project's group only for the people enrolled in it)
  const unreadBy = new Map<string, number>();
  let unreadError = false;
  if (!salesOnly || directory.some((d) => d.is_member)) {
    const unreadRead = await loadProjectUnread();
    if (unreadRead === null) unreadError = true;
    for (const [k, v] of unreadRead ?? []) unreadBy.set(k, v);
  }

  // ---- who may add an internal project
  const addCompanies: QuickProjectCompany[] = ctx.companies
    .filter((c) => hasProjCapability(ctx.grants, c.id, "assign_pm"))
    .map((c) => ({ id: c.id, name: c.name, referenceCode: c.referenceCode, isFounder: isProjFounder(ctx.grants, c.id), people: ctx.people.filter((p) => p.companyIds.includes(c.id)).map((p) => ({ id: p.id, name: p.name })) }));

  const needs = !attention ? [] : [
    attention.handoversWaiting > 0 ? { label: `${attention.handoversWaiting} handover${attention.handoversWaiting === 1 ? "" : "s"} waiting on you`, href: "/projects/handovers" } : null,
    attention.reviewsWaiting > 0 ? { label: `${attention.reviewsWaiting} waiting for your review`, href: "/projects/work?show=review" } : null,
    attention.overdueTasks > 0 ? { label: `${attention.overdueTasks} overdue task${attention.overdueTasks === 1 ? "" : "s"} of yours`, href: "/projects/work?show=overdue" } : null,
    attention.unreadMessages > 0 ? { label: `${attention.unreadMessages} unread message${attention.unreadMessages === 1 ? "" : "s"} in ${attention.unreadProjects} project${attention.unreadProjects === 1 ? "" : "s"}`, href: "/projects" } : null,
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
    const c = details ? commitmentOf(p) : null;
    const none = noCommitmentText(p.pm_name);
    const tc = teamCounts.get(p.id);
    const team = details && tc ? teamStanding(tc.leads, tc.members) : null;
    return {
      id: p.id, name: p.name, reference: p.reference, kind: p.kind, isOngoing: p.is_ongoing, status: p.status, pmName: p.pm_name ?? "—", dates: dateRangeText(p.start_date, p.end_date),
      href: detailsHref(p.id, details), panel: !details, canMove: canChangeStatus(p, ctx.userId, ctx.grants), unread: unreadBy.get(p.id) ?? 0,
      next: !details ? null : { text: c?.text ?? none.text, detail: c?.detail ?? (siteError || milestoneError ? "Not available just now" : none.detail), href: c?.href ?? null, needsAction: c?.needsAction ?? false },
      team: team && team.label ? { label: team.label, manageHref: `/projects/${p.id}/people` } : null,
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

      {!attention ? <LoadError what="what needs you" retryHref="/projects" /> : null}
      {!salesOnly && needs.length > 0 ? (
        <section aria-label="Needs you" className="os-card os-warm flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-3 text-sm">
          <span className="font-semibold">Needs you</span>
          {needs.map((n) => <Link key={n.label} href={n.href} className="font-medium underline underline-offset-2 hover:text-foreground">{n.label}</Link>)}
        </section>
      ) : null}

      <div className="os-card p-3 sm:p-4">
      <ListToolbar
        search={{ value: q, placeholder: "Search by name, reference or Project Manager", label: "Search projects" }}
        clearHref={href({}, ["q", "company", "kind", "status", "edition"])}
        filters={[
          { name: "show", label: "Show", value: finished ? "finished" : "", options: [{ value: "", label: `Ongoing (${liveCount})` }, { value: "finished", label: `Completed and archived (${finishedCount})` }] },
          { name: "kind", label: "Kind", value: kind, options: [{ value: "", label: "Client and internal" }, { value: "client", label: "Client projects" }, { value: "internal", label: "Internal projects" }] },
          { name: "status", label: "Status", value: status, options: [{ value: "", label: "Any status" }, ...PROJECT_STATUSES.filter((s) => finished === (s === "completed" || s === "archived")).map((s) => ({ value: s, label: projectStatusLabel(s) }))] },
          ...(companies.length > 1 ? [{ name: "company", label: "Company", value: company, options: [{ value: "", label: "All companies" }, ...companies.map(([id, name]) => ({ value: id, label: name }))] }] : []),
          ...(editions.length > 0 ? [{ name: "edition", label: "Event edition", value: edition, options: [{ value: "", label: "All editions" }, ...editions]}] : []),
        ]}
      >
        {!finished && !salesOnly ? <span data-testid="project-view-switch"><ViewSwitch current={view} tableHref={href({ view: null })} boardHref={href({ view: "board" })} boardLabel="Board" /></span> : null}
      </ListToolbar>
      </div>
      {editionsRes.state === "error" ? <Muted>Event editions could not be loaded just now, so no project shows its edition and the edition filter is not offered. Everything else is shown.</Muted> : null}

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
        <>
          <div data-testid="project-view-board"><ProjectBoard projects={boardProjects} /></div>
          {siteError || milestoneError ? <Muted>Some next commitments could not be loaded just now; the cards say so.</Muted> : null}
        </>
      ) : (
        <>
          <Table className={cn("min-w-[44rem]", listTable)} data-testid="project-view-table">
            <caption className="sr-only">Projects</caption>
            <TableHeader>
              <TableRow>
                <SortHead label="Project" href={sortHref("name")} active={sort.key === "name"} dir={sort.dir} />
                {companies.length > 1 ? <TableHead scope="col">Company</TableHead> : null}
                <SortHead label="Project Manager" href={sortHref("pm")} active={sort.key === "pm"} dir={sort.dir} />
                <SortHead label="Status" href={sortHref("status")} active={sort.key === "status"} dir={sort.dir} />
                <SortHead label="Key dates" href={sortHref("dates")} active={sort.key === "dates"} dir={sort.dir} />
                {showMilestone ? <SortHead label="Next milestone" href={sortHref("milestone")} active={sort.key === "milestone"} dir={sort.dir} /> : null}
                {wantsExtras ? <TableHead scope="col">Next commitment</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const details = canSeeProjectDetails(p, ctx.grants);
                const next = nextBy.get(p.id);
                const Name = details ? Link : PanelLink;
                return (
                  <ClickableRow key={p.id} href={detailsHref(p.id, details)} panel={!details} selected={openRow?.id === p.id} className="align-top">
                    <TableCell className="min-w-[12rem]">
                      <Name href={detailsHref(p.id, details)} className="break-words font-medium underline-offset-2 hover:underline">{p.name}</Name>
                      {unreadBy.get(p.id) ? <span className="ml-2 rounded-full bg-accent px-1.5 text-[13px] font-semibold text-accent-foreground">{unreadBy.get(p.id)} unread</span> : null}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"><span>{p.reference}</span><KindBadge kind={p.kind} ongoing={p.is_ongoing} /></div>
                      {editionBy.get(p.id) ? <div className="mt-0.5 break-words text-sm text-muted-foreground" data-testid="project-edition">Event edition: {editionBy.get(p.id)!.label}</div> : null}
                      {details && teamCounts.get(p.id) && teamStanding(teamCounts.get(p.id)!.leads, teamCounts.get(p.id)!.members).label ? (
                        <div className="mt-0.5 text-sm" data-testid={`project-team-${p.id}`}>
                          <span className="text-[hsl(var(--os-amber))]">⚠ {teamStanding(teamCounts.get(p.id)!.leads, teamCounts.get(p.id)!.members).label}</span>{" "}
                          <Link href={`/projects/${p.id}/people`} className="whitespace-nowrap font-medium underline underline-offset-2" data-testid={`project-manage-team-${p.id}`}>Manage team</Link>
                        </div>
                      ) : details ? <div className="mt-0.5 text-sm"><Link href={`/projects/${p.id}/people`} className="text-muted-foreground underline underline-offset-2 hover:text-foreground" data-testid={`project-manage-team-${p.id}`}>Manage team</Link></div> : null}
                      {details && previews.get(p.id) ? (
                        <div className="mt-1 space-y-0.5 text-[13px] text-muted-foreground" data-testid={`project-activity-${p.id}`}>
                          {previews.get(p.id)!.lines.map((l) => <p key={l.key} className="break-words">{l.text}</p>)}
                          <p><Link href={`/projects/${p.id}/history`} className="font-medium underline underline-offset-2">History{previews.get(p.id)!.more > 0 ? ` (${previews.get(p.id)!.more} more)` : ""}</Link></p>
                        </div>
                      ) : null}
                    </TableCell>
                    {companies.length > 1 ? <TableCell data-label="Company" className="text-sm">{ctx.companyName(p.company_id)}</TableCell> : null}
                    <TableCell data-label="Project Manager" className="text-sm">{p.pm_name ? <span className="inline-flex items-center gap-2"><OsAvatar name={p.pm_name} size="sm" />{p.pm_name}</span> : "—"}</TableCell>
                    <TableCell data-label="Status"><ProjectStatusBadge status={p.status} /></TableCell>
                    <TableCell data-label="Key dates" className="min-w-[7rem] text-sm">{dateRangeText(p.start_date, p.end_date)}</TableCell>
                    {showMilestone ? (
                      <TableCell data-label="Next milestone" className="min-w-[8rem] text-sm">
                        {!details ? <span className="text-muted-foreground">Members only</span> : milestoneError ? <span className="text-muted-foreground">Not available</span> : next ? <>{next.title}<span className="block text-muted-foreground">{formatDate(next.due)}</span></> : <span className="text-muted-foreground">None dated</span>}
                      </TableCell>
                    ) : null}
                    {wantsExtras ? (
                      <TableCell data-label="Next commitment" className="min-w-[11rem] text-sm" data-testid={`project-next-${p.id}`}>
                        {!details ? <span className="text-muted-foreground">Members only</span> : (() => {
                          const c = commitmentOf(p);
                          const none = noCommitmentText(p.pm_name);
                          return c ? (
                            <>
                              <Link href={c.href} className={cn("break-words underline-offset-2 hover:underline", c.needsAction && "font-medium")}>{c.needsAction ? "⚠ " : ""}{c.text}</Link>
                              {c.detail ? <span className="block break-words text-[13px] text-muted-foreground">{c.detail}</span> : null}
                            </>
                          ) : (
                            <><span className="text-muted-foreground">{siteError || milestoneError ? "Not available just now" : none.text}</span>{siteError || milestoneError ? null : <span className="block break-words text-[13px] text-muted-foreground">{none.detail}</span>}</>
                          );
                        })()}
                      </TableCell>
                    ) : null}
                  </ClickableRow>
                );
              })}
            </TableBody>
          </Table>
          {milestoneError ? <Muted>Next milestones could not be loaded just now; everything else is shown.</Muted> : null}
          {siteError ? <Muted>Site dates could not be loaded just now, so the next commitment shows milestones only. Everything else is shown.</Muted> : null}
          {teamError ? <Muted>Team standing could not be loaded just now, so no project shows a team warning. Manage team is still on every row.</Muted> : null}
          {activityError ? <Muted>Recent activity could not be loaded just now. History on each project has the full record.</Muted> : null}
          {unreadError ? <Muted>Unread chat counts could not be loaded just now, so no project shows one. The Chat button still lists your groups.</Muted> : null}
        </>
      )}

      {!salesOnly && rows.some((r) => !canSeeProjectDetails(r, ctx.grants)) ? (
        <p className="flex items-center gap-1 text-sm text-muted-foreground">Some projects show a summary only
          <InfoHint label="summary-only projects">Projects you are not part of show their summary only. Their plans, chat and files are for their members and founders.</InfoHint>
        </p>
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
