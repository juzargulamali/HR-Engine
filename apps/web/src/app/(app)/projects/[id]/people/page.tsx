import { notFound, redirect } from "next/navigation";
import { canManageProject, hasProjCapability, isProjFounder } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Fact, Muted, Panel } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { formatDate, todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { ActingPmForm, AddMemberForm, EndActingButton, MemberActions, ReassignPmButton, RemoveSalesLinkButton, SalesLinkForm, TeamButton } from "./people-forms";
import { HR_INDEPENDENCE_NOTE, ROLE_EXPLANATIONS, isActingCurrent, roleLabels, teamNameOf } from "./role-labels";

export const metadata = { title: "Project people" };

export default async function ProjectPeoplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details") redirect(`/projects/${id}`);
  const { project, people, teams } = view;
  const today = todayIso();
  const supabase = await createClient();
  const manager = canManageProject(view.standing);
  const live = project.status !== "completed" && project.status !== "archived";
  const canEdit = manager && live;
  const isRealPm = project.pm_user_id === ctx.userId || isProjFounder(ctx.grants, project.company_id);
  const canAssignPm = hasProjCapability(ctx.grants, project.company_id, "assign_pm");
  const showSales = manager && project.kind === "client";

  const [tasksR, linksR, staffR] = await Promise.all([
    supabase.from("proj_tasks").select("assignee_id").eq("project_id", id).in("status", ["todo", "in_progress", "ready_for_review"]),
    showSales ? supabase.from("proj_sales_links").select("id, user_id, source, added_at").eq("project_id", id).is("removed_at", null) : Promise.resolve({ data: [] as { id: string; user_id: string; source: string; added_at: string }[] }),
    // Names of active staff, for people who can assign PMs / manage access; empty for everyone else.
    showSales || canAssignPm ? supabase.rpc("proj_staff_directory") : Promise.resolve({ data: [] as { user_id: string; full_name: string | null; email: string | null }[] }),
  ]);
  const openBy = new Map<string, number>();
  for (const t of tasksR.data ?? []) openBy.set(t.assignee_id, (openBy.get(t.assignee_id) ?? 0) + 1);
  const staff = new Map((staffR.data ?? []).map((s) => [s.user_id, s.full_name?.trim() || s.email?.split("@")[0] || "Unnamed"]));
  const links = linksR.data ?? [];
  const memberIds = new Set(people.map((p) => p.user_id));
  const nameFor = (uid: string) => view.nameOf(uid) !== "Former colleague" && view.nameOf(uid) !== "Unknown" ? view.nameOf(uid) : (staff.get(uid) ?? "Sales colleague (name not shown to you)");

  const memberOptions = people.map((p) => ({ id: p.user_id, name: p.full_name ?? "Unnamed" }));
  const teamOptions = teams.map((t) => ({ id: t.id, name: t.name }));
  const companyPeople = ctx.people.filter((p) => p.companyIds.includes(project.company_id));
  const candidates = [
    ...companyPeople.filter((p) => !memberIds.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
    ...links.filter((l) => !memberIds.has(l.user_id) && !companyPeople.some((p) => p.id === l.user_id)).map((l) => ({ id: l.user_id, name: nameFor(l.user_id), note: "Sales link" })),
  ];
  const pmCandidates = companyPeople.map((p) => ({ id: p.id, name: p.name }));
  const salesCandidates = [...staff.entries()].filter(([uid]) => !links.some((l) => l.user_id === uid)).map(([uid, name]) => ({ id: uid, name }));
  const actingNow = people.filter((p) => p.role === "acting_pm");

  return (
    <div className="space-y-5">
      <Panel
        title="Members"
        description="Everyone here can read the project's workspace and discussion. Access ends the moment someone is removed."
        actions={canAssignPm && live ? <ReassignPmButton projectId={id} candidates={pmCandidates} currentId={project.pm_user_id} /> : undefined}
      >
        {people.length === 0 ? (
          <EmptyState dense title="No members" description="The Project Manager is always a member. Add the people who work on this project." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Department</TableHead><TableHead>Open tasks</TableHead>{canEdit ? <TableHead>Actions</TableHead> : null}</TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => {
                const open = openBy.get(p.user_id) ?? 0;
                const isPm = p.user_id === project.pm_user_id;
                const heads = teams.some((t) => t.head_user_id === p.user_id);
                return (
                  <TableRow key={p.user_id}>
                    <TableCell className="font-medium">{p.full_name ?? "Unnamed"}{p.user_id === ctx.userId ? <span className="font-normal text-muted-foreground"> (you)</span> : null}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {roleLabels(p, teams, today).map((l) => <Badge key={l} variant="outline" className="whitespace-nowrap">{l}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell>{teamNameOf(p.team_id, teams) ?? <span className="text-muted-foreground">None</span>}</TableCell>
                    <TableCell>{open}</TableCell>
                    {canEdit ? (
                      <TableCell>
                        <MemberActions
                          projectId={id}
                          person={{ id: p.user_id, name: p.full_name ?? "Unnamed", teamId: p.team_id }}
                          teams={teamOptions}
                          openTasks={open}
                          others={memberOptions.filter((o) => o.id !== p.user_id)}
                          canRemove={!isPm && !heads}
                        />
                        {isPm || heads ? <Muted className="mt-1">{isPm ? "Change the Project Manager first to remove them." : "Choose another head first to remove them."}</Muted> : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {canEdit ? (
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-3 text-sm font-semibold">Add a person</h3>
            <AddMemberForm projectId={id} candidates={candidates} teams={teamOptions} />
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Department teams"
        description="Each team has a head who manages the team's deliverables and tasks. They are teams inside this project, not HR departments."
        actions={canEdit ? <TeamButton projectId={id} members={memberOptions} /> : undefined}
      >
        {teams.length === 0 ? (
          <EmptyState dense title="No department teams yet" description={canEdit ? "Add one for each department that delivers part of this project, such as Programming or Content." : "The Project Manager adds department teams when departments deliver part of the project."} />
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Team</TableHead><TableHead>Head</TableHead><TableHead>People</TableHead>{canEdit ? <TableHead>Actions</TableHead> : null}</TableRow></TableHeader>
            <TableBody>
              {teams.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{view.nameOf(t.head_user_id)}</TableCell>
                  <TableCell>{people.filter((p) => p.team_id === t.id).length}</TableCell>
                  {canEdit ? <TableCell><div className="flex flex-wrap gap-2"><TeamButton projectId={id} team={{ id: t.id, name: t.name, headUserId: t.head_user_id }} members={memberOptions} /></div></TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {isRealPm && live ? (
        <Panel title="Temporary project leadership" description="Hand the Project Manager's project powers to a member while the PM is away. It carries project powers only: nothing in HR changes.">
          {actingNow.length > 0 ? (
            <ul className="mb-4 divide-y divide-border">
              {actingNow.map((p) => (
                <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span><span className="font-medium">{p.full_name ?? "Unnamed"}</span> · {isActingCurrent(p, today) ? `leads until ${formatDate(p.acting_until)}` : "leadership ended"}</span>
                  <EndActingButton projectId={id} userId={p.user_id} name={p.full_name ?? "This person"} />
                </li>
              ))}
            </ul>
          ) : null}
          <ActingPmForm projectId={id} members={memberOptions.filter((m) => m.id !== project.pm_user_id && !actingNow.some((a) => a.user_id === m.id && isActingCurrent(a, today)))} />
          <Muted className="mt-3">A temporary leader cannot change who the Project Manager is or appoint other leaders.</Muted>
        </Panel>
      ) : null}

      {showSales ? (
        <Panel title="Sales relationship" description="The Sales people linked to this project. A link alone gives them the project summary and handover status, nothing else.">
          {links.length === 0 ? (
            <EmptyState dense title="No Sales people are linked" description="The Sales owner and the person who prepared the handover are linked when the Project Manager accepts the handover." />
          ) : (
            <ul className="divide-y divide-border">
              {links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium">{nameFor(l.user_id)}</span>
                    <span className="text-muted-foreground"> · {l.source === "handover_owner" ? "Sales owner at handover" : l.source === "handover_preparer" ? "Prepared the handover" : "Added later"}</span>
                  </span>
                  {canAssignPm || isProjFounder(ctx.grants, project.company_id) ? <RemoveSalesLinkButton projectId={id} userId={l.user_id} name={nameFor(l.user_id)} /> : null}
                </li>
              ))}
            </ul>
          )}
          <Muted className="mt-3">These links are recorded once, at handover. A later change of owner in Sales &amp; CRM does not alter them. To let a Sales person take part, add them as a member above.</Muted>
          {(canAssignPm || isProjFounder(ctx.grants, project.company_id)) && live ? (
            <div className="mt-4 border-t border-border pt-4">
              <h3 className="mb-3 text-sm font-semibold">Link another Sales person</h3>
              <SalesLinkForm projectId={id} candidates={salesCandidates} />
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="What each role can do">
        <dl className="grid gap-4 sm:grid-cols-2">
          {ROLE_EXPLANATIONS.map((r) => <Fact key={r.role} label={r.role}>{r.can}</Fact>)}
        </dl>
        <p className="mt-4 text-sm text-muted-foreground">{HR_INDEPENDENCE_NOTE}</p>
      </Panel>
    </div>
  );
}
