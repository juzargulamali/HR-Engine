import { notFound, redirect } from "next/navigation";
import { CONFIRMATION_LABELS, DEPENDENCY_KIND_LABELS, PLAN_LABELS, describeTimedEvent, hasProjCapability, isFinishedProject, planTemplate } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookingStateBadge } from "@/components/projects/badges";
import { Muted, Panel } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { dateText, formatDate, todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import type { ProjExternalDependencyRow, ProjPlanItemRow, ProjSiteBookingRow } from "@/types/projects";
import { BookingForm } from "./_components/booking-form";
import { DependencyForm } from "./_components/dependency-form";
import { DialogButton } from "./_components/dialog";
import { PlanBars } from "./_components/plan-bars";
import { PlanItemForm } from "./_components/plan-item-form";
import { CancelBookingButton, ConfirmBookingForms, DeleteDependencyButton, DeletePlanItemButton, TemplateForm } from "./_components/small-forms";
import { bookablePeople, bookingAllowanceText, canBookPerson, hiddenConflictText, itemMode, localDefault, planBarItems, planItemWhen, sortPlanItems, splitConflicts } from "./timeline-helpers";

export const metadata = { title: "Timelines & site" };

const VIEW_TZ = "Asia/Dubai";

export default async function TimelinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details" || !view.details) redirect(`/projects/${id}`);
  const { project, details } = view;
  const siteTz = details.site_timezone;
  const finished = isFinishedProject(project.status);
  const canEditPlan = view.canManage && !finished;
  const checkRaw = Array.isArray(sp.check) ? sp.check[0] : sp.check;

  const supabase = await createClient();
  const [{ data: planRows }, { data: milestoneRows }, { data: depRows }, { data: bookingRows }] = await Promise.all([
    supabase.from("proj_plan_items").select("*").eq("project_id", id),
    supabase.from("proj_milestones").select("id, title").eq("project_id", id).order("sort_order"),
    supabase.from("proj_external_dependencies").select("*").eq("project_id", id).order("expected_date", { nullsFirst: false }),
    supabase.from("proj_site_bookings").select("*").eq("project_id", id).order("starts_at"),
  ]);
  const milestones = milestoneRows ?? [];
  const milestoneTitle = (mid: string | null) => milestones.find((m) => m.id === mid)?.title ?? null;
  const items = planRows ?? [];
  const deps = depRows ?? [];
  const bookings = bookingRows ?? [];
  const checked = checkRaw ? bookings.find((b) => b.id === checkRaw) : undefined;
  const conflicts = checked ? ((await supabase.rpc("proj_booking_conflicts", { p_booking_id: checked.id })).data ?? []) : [];

  const actors = { canManage: view.canManage, headOfTeamIds: view.headOfTeamIds };
  const people = bookablePeople(actors, view.people).map((p) => ({ id: p.user_id, name: p.full_name ?? "Unnamed" }));
  const canBookAny = !finished && people.length > 0;
  const canOverride = hasProjCapability(ctx.grants, project.company_id, "override_site_conflict");
  const siteItems = items.filter((i) => i.plan === "site" && i.status !== "cancelled").map((i) => ({ id: i.id, title: i.title }));

  return (
    <div className="space-y-6">
      <Alert role="status">
        Timelines are editable plans, not commitments. Nothing here reaches the client unless you tick <strong>client-facing</strong> on an item and then issue a client timeline from Documents.
        Changing a date never moves any other date.
      </Alert>
      {(["delivery", "site"] as const).map((plan) => (
        <PlanSection key={plan} plan={plan} items={sortPlanItems(items.filter((i) => i.plan === plan))} canEdit={canEditPlan} projectId={id} siteTz={siteTz} milestones={milestones}
          milestoneTitle={milestoneTitle} defaultBase={plan === "delivery" ? (project.start_date ?? "") : (details.install_start ?? details.event_start ?? "")} />
      ))}

      <Panel
        title="Dependencies on others"
        description="Things outside the team that have to happen first: structure ready, power and network, access, the standbuilder's work."
        actions={canEditPlan ? <DialogButton label="Add dependency" title="Add a dependency" variant="default"><DependencyForm projectId={id} siteTimezone={siteTz} milestones={milestones} /></DialogButton> : null}
      >
        <Muted className="mb-3">Recorded here for the team only. No account, portal or message is involved, and nothing is sent to anyone. Times are site time ({siteTz.replace(/_/g, " ")}).</Muted>
        {deps.length === 0 ? (
          <EmptyState dense title="No dependencies recorded" description={canEditPlan ? "Add what you are waiting for, who is responsible and when it is expected." : "The Project Manager records what the project is waiting for."} />
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>What</TableHead><TableHead>Expected</TableHead><TableHead>Organisation</TableHead><TableHead>Confirmation</TableHead>{canEditPlan ? <TableHead><span className="sr-only">Actions</span></TableHead> : null}</TableRow></TableHeader>
            <TableBody>
              {deps.map((d) => <DependencyRow key={d.id} d={d} projectId={id} siteTz={siteTz} milestones={milestones} milestoneTitle={milestoneTitle(d.milestone_id)} canEdit={canEditPlan} />)}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel
        id="bookings"
        title="Site bookings"
        description="Physical reservations of a person at a site, in the site's own time, with preparation and travel allowances."
        actions={canBookAny ? <DialogButton label="Add booking" title="Book someone on site" variant="default"><BookingForm projectId={id} siteTimezone={siteTz} people={people} siteItems={siteItems} /></DialogButton> : null}
      >
        <Muted className="mb-3">
          Several assignments in one day are never a conflict. Only physical site bookings are compared, across every project, including each booking&apos;s preparation and travel allowance. A booking is tentative until it is confirmed, and confirming one that overlaps another needs authority and a reason.
          {!view.canManage && view.headOfTeamIds.length > 0 ? " As a department head you can book the people of your own team." : ""}
        </Muted>
        {bookings.length === 0 ? (
          <EmptyState dense title="No site bookings" description={canBookAny ? "Book the people who have to be on site, then confirm each booking." : "The Project Manager, or the head of a person's department team, books people on site."} />
        ) : (
          <div className="space-y-3">
            {bookings.map((b) => {
              const person = view.people.find((p) => p.user_id === b.user_id);
              const mayBook = !finished && (person ? canBookPerson(actors, person) : view.canManage);
              return <BookingCard key={b.id} b={b} projectId={id} name={view.nameOf(b.user_id)} mayBook={mayBook} canOverride={canOverride} people={people} siteItems={siteItems} siteTz={siteTz} />;
            })}
          </div>
        )}
        {checked ? (
          <div className="mt-4 rounded-lg border border-border p-3" role="status" aria-label="Conflict check">
            <h3 className="text-sm font-semibold">Overlaps for {view.nameOf(checked.user_id)} at {checked.location}</h3>
            <ConflictList rows={conflicts} />
          </div>
        ) : null}
      </Panel>
      <p className="sr-only">Today is {formatDate(todayIso())}.</p>
    </div>
  );
}

function ConflictList({ rows }: { rows: { is_visible: boolean; project_reference: string | null; project_name: string | null; starts_at: string | null; ends_at: string | null; tz: string | null; state: string | null }[] }) {
  const { visible, hidden } = splitConflicts(rows);
  if (rows.length === 0) return <p className="mt-1 text-sm">No overlap with any other booking of this person, including preparation and travel time.</p>;
  return (
    <div className="mt-1 space-y-2 text-sm">
      {visible.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5">
          {visible.map((c, i) => (
            <li key={i}>
              {c.project_reference} {c.project_name}: {c.state === "confirmed" ? "confirmed" : "tentative"}
              {c.starts_at && c.ends_at && c.tz ? `, ${describeTimedEvent(c.starts_at, c.ends_at, c.tz, VIEW_TZ).source}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? (
        <p>{hiddenConflictText(hidden)}. Details are not shown to you. To resolve it, ask a founder or the Project Manager of the other project.</p>
      ) : null}
      <p className="text-muted-foreground">Only confirmed overlaps stop a confirmation; tentative ones are a warning.</p>
    </div>
  );
}

function BookingCard({ b, projectId, name, mayBook, canOverride, people, siteItems, siteTz }: { b: ProjSiteBookingRow; projectId: string; name: string; mayBook: boolean; canOverride: boolean; people: { id: string; name: string }[]; siteItems: { id: string; title: string }[]; siteTz: string }) {
  const when = describeTimedEvent(b.starts_at, b.ends_at, b.tz, VIEW_TZ);
  const cancelled = b.state === "cancelled";
  return (
    <article className={`rounded-lg border border-border p-3 ${cancelled ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{name}</h3>
        <BookingStateBadge state={b.state} />
        <span className="text-sm text-muted-foreground">{b.location}</span>
      </div>
      <p className="mt-1 text-sm">{when.source}</p>
      {when.viewer ? <p className="text-sm text-muted-foreground">{when.viewer}</p> : null}
      <p className="text-sm text-muted-foreground">{bookingAllowanceText(b)}</p>
      {b.notes ? <p className="mt-1 text-sm">{b.notes}</p> : null}
      {b.override_reason ? <p className="mt-1 text-sm"><span className="font-medium">Confirmed despite an overlap.</span> Reason recorded: {b.override_reason}</p> : null}
      {cancelled && b.cancel_reason ? <p className="mt-1 text-sm text-muted-foreground">Cancelled: {b.cancel_reason}</p> : null}
      {mayBook && !cancelled ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`?check=${b.id}#bookings`} className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-secondary/70">Check conflicts</a>
            <DialogButton label="Edit" title="Edit booking" variant="ghost">
              <BookingForm projectId={projectId} siteTimezone={siteTz} people={people} siteItems={siteItems}
                booking={{ id: b.id, userId: b.user_id, location: b.location, startsLocal: localDefault(b.starts_at, b.tz), endsLocal: localDefault(b.ends_at, b.tz), tz: b.tz, lead: b.lead_minutes, trail: b.trail_minutes, planItemId: b.plan_item_id ?? "", notes: b.notes ?? "", confirmed: b.state === "confirmed", version: b.version }} />
            </DialogButton>
            <CancelBookingButton projectId={projectId} bookingId={b.id} />
          </div>
          {b.state === "tentative" ? <ConfirmBookingForms projectId={projectId} bookingId={b.id} canOverride={canOverride} /> : null}
        </div>
      ) : null}
    </article>
  );
}

function DependencyRow({ d, projectId, siteTz, milestones, milestoneTitle, canEdit }: { d: ProjExternalDependencyRow; projectId: string; siteTz: string; milestones: { id: string; title: string }[]; milestoneTitle: string | null; canEdit: boolean }) {
  return (
    <TableRow>
      <TableCell className="min-w-48">
        <p className="font-medium">{d.label}</p>
        <p className="text-sm text-muted-foreground">{DEPENDENCY_KIND_LABELS[d.kind] ?? d.kind}{milestoneTitle ? ` · for milestone “${milestoneTitle}”` : ""}</p>
        {d.client_facing ? <Badge variant="outline" className="mt-1">On the client timeline when issued</Badge> : null}
      </TableCell>
      <TableCell className="whitespace-nowrap">{d.expected_date ? `${dateText(d.expected_date)}${d.expected_time ? `, ${d.expected_time.slice(0, 5)} site time` : ""}` : "Date to be confirmed"}</TableCell>
      <TableCell>{d.organisation ?? "—"}{d.contact ? <span className="block text-sm text-muted-foreground">{d.contact}</span> : null}</TableCell>
      <TableCell className="whitespace-nowrap">{CONFIRMATION_LABELS[d.confirmation] ?? d.confirmation}</TableCell>
      {canEdit ? (
        <TableCell>
          <div className="flex flex-wrap gap-1">
            <DialogButton label="Edit" title="Edit dependency" variant="ghost">
              <DependencyForm projectId={projectId} siteTimezone={siteTz} milestones={milestones}
                dependency={{ id: d.id, kind: d.kind, label: d.label, expectedDate: d.expected_date ?? "", expectedTime: d.expected_time?.slice(0, 5) ?? "", organisation: d.organisation ?? "", contact: d.contact ?? "", confirmation: d.confirmation, milestoneId: d.milestone_id ?? "", clientFacing: d.client_facing, notes: d.notes ?? "", version: d.version }} />
            </DialogButton>
            <DeleteDependencyButton projectId={projectId} dependencyId={d.id} label={d.label} />
          </div>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function PlanSection({ plan, items, canEdit, projectId, siteTz, milestones, milestoneTitle, defaultBase }: {
  plan: "delivery" | "site"; items: ProjPlanItemRow[]; canEdit: boolean; projectId: string; siteTz: string; milestones: { id: string; title: string }[]; milestoneTitle: (id: string | null) => string | null; defaultBase: string;
}) {
  const bars = planBarItems(items);
  const suggestion = planTemplate(plan).map((t) => t.title).join(", ");
  return (
    <Panel
      title={PLAN_LABELS[plan]}
      description={plan === "delivery" ? "The creative and technical build, from moodboard to full test." : "What happens on site, from access to dismantling."}
      actions={canEdit ? <DialogButton label="Add item" title={`Add to the ${PLAN_LABELS[plan].toLowerCase()}`} variant="default"><PlanItemForm projectId={projectId} plan={plan} siteTimezone={siteTz} milestones={milestones} /></DialogButton> : null}
    >
      {items.length === 0 ? (
        <div className="space-y-4">
          <EmptyState dense title={`No ${PLAN_LABELS[plan].toLowerCase()} yet`} description={canEdit ? "Start from the suggested stages or add your own. The suggestion is only a starting point: edit or delete anything." : "The Project Manager plans this."} />
          {canEdit ? (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium">Use the suggested timeline</p>
              <Muted className="mb-3">Suggested stages (editable, never mandatory, nothing client-visible): {suggestion}.</Muted>
              <TemplateForm projectId={projectId} plan={plan} defaultBase={defaultBase} label="Create suggested stages" />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>When</TableHead><TableHead>Status</TableHead>{canEdit ? <TableHead><span className="sr-only">Actions</span></TableHead> : null}</TableRow></TableHeader>
            <TableBody>
              {items.map((i) => {
                const w = planItemWhen(i, VIEW_TZ);
                const m = milestoneTitle(i.milestone_id);
                return (
                  <TableRow key={i.id}>
                    <TableCell className="min-w-44">
                      <p className="font-medium">{i.title}</p>
                      <p className="text-sm text-muted-foreground">{i.client_facing ? "Offered on the client timeline" : "Internal only"}{m ? ` · milestone “${m}”` : ""}</p>
                      {i.notes ? <p className="text-sm">{i.notes}</p> : null}
                    </TableCell>
                    <TableCell className="min-w-44 text-sm">{w.source}{w.viewer ? <span className="block text-muted-foreground">{w.viewer}</span> : null}</TableCell>
                    <TableCell className="whitespace-nowrap">{({ planned: "Planned", in_progress: "In progress", done: "Done", cancelled: "Cancelled" } as Record<string, string>)[i.status] ?? i.status}</TableCell>
                    {canEdit ? (
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <DialogButton label="Edit" title={`Edit “${i.title}”`} variant="ghost">
                            <PlanItemForm projectId={projectId} plan={plan} siteTimezone={siteTz} milestones={milestones}
                              item={{ id: i.id, title: i.title, mode: itemMode(i), startDate: i.start_date ?? "", endDate: i.end_date ?? "", startsLocal: localDefault(i.starts_at, i.tz), endsLocal: localDefault(i.ends_at, i.tz), tz: i.tz ?? siteTz, status: i.status, clientFacing: i.client_facing, milestoneId: i.milestone_id ?? "", notes: i.notes ?? "", version: i.version }} />
                          </DialogButton>
                          <DeletePlanItemButton projectId={projectId} itemId={i.id} title={i.title} />
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {bars.length > 0 ? <PlanBars items={bars} label={`${PLAN_LABELS[plan]} as bars`} /> : <Muted>No item has a date yet, so there is nothing to draw.</Muted>}
        </div>
      )}
    </Panel>
  );
}
