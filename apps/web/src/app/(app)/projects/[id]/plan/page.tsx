import { notFound, redirect } from "next/navigation";
import { hasProjCapability, isFinishedProject } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarShell } from "@/components/projects/calendar/calendar-views";
import { fetchRange, filterKinds, mapProjectRows, parseCalendarParams } from "@/components/projects/calendar/helpers";
import { Muted, Panel } from "@/components/projects/parts";
import { LoadError } from "@/components/workspace/states";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { todayIso } from "@/lib/projects/format";
import { PLAN_CALENDAR_KINDS, PLAN_KIND_LABELS, PLAN_KINDS, PLAN_MODE_LABELS, PLAN_MODES, parsePlanParams, planHref } from "@/lib/projects/plan-view";
import { createClient } from "@/lib/supabase/server";
import type { ProjExternalDependencyRow, ProjSiteBookingRow } from "@/types/projects";
import { BookingForm } from "../timeline/_components/booking-form";
import { DependencyForm } from "../timeline/_components/dependency-form";
import { DialogButton } from "../timeline/_components/dialog";
import { bookablePeople, canBookPerson, sortPlanItems } from "../timeline/timeline-helpers";
import { PlanSwitch } from "./_controls";
import { BookingCard, ConflictList, DependencyRow, PlanSection } from "./_sections";

export const metadata = { title: "Plan" };

type SP = Record<string, string | string[] | undefined>;
const CALENDAR_PARAMS = ["view", "date", "tz", "kind"] as const;

/**
 * One Plan section for a project: Delivery (the build) or Site (what happens on site), as a List, a Calendar or a Timeline. It
 * replaces the separate Timelines & site and Calendar pages. Every switch is a link, so changing the view never writes anything:
 * dates are never shifted and nothing is duplicated. The list is the accessible primary form; the calendar and the bars are views of the same dates.
 */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details" || !view.details) redirect(`/projects/${id}`);
  const { project, details } = view;
  const { plan, mode } = parsePlanParams(sp);
  const siteTz = details.site_timezone;
  const finished = isFinishedProject(project.status);
  const canEditPlan = view.canManage && !finished;
  const checkRaw = Array.isArray(sp.check) ? sp.check[0] : sp.check;

  const switches = (
    <div className="flex flex-wrap items-center gap-3">
      <PlanSwitch label="Which plan" options={PLAN_KINDS.map((k) => ({ key: k, label: PLAN_KIND_LABELS[k], current: plan === k, href: planHref(id, sp, { plan: k }, ["check", "kind"]) }))} />
      <PlanSwitch label="How to show it" options={PLAN_MODES.map((m) => ({ key: m, label: PLAN_MODE_LABELS[m], current: mode === m, href: planHref(id, sp, { mode: m }, ["check"]) }))} />
    </div>
  );
  const intro = (
    <Muted>
      Plans, not commitments: nothing reaches the client unless an item is marked client-facing and a client timeline is issued from Files &amp; client plan. Changing a date never moves another date.
    </Muted>
  );

  // ------------------------------------------------------------------------------------------------ Calendar
  if (mode === "calendar") {
    const planKinds = PLAN_CALENDAR_KINDS[plan];
    const today = todayIso();
    const cal = parseCalendarParams(sp, today, planKinds.map((k) => k.id));
    const range = fetchRange(cal.view, cal.date);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("proj_project_calendar", { p_project_id: id, p_from: range.from, p_to: range.to, p_view_tz: cal.tz });
    const inPlan = mapProjectRows(data ?? [], id, project.reference, project.name).filter((e) => planKinds.some((k) => k.id === e.kind));
    const entries = filterKinds(inPlan, cal.kinds);
    return (
      <div className="space-y-4">
        {switches}
        {error ? (
          <LoadError what="the calendar" retryHref={planHref(id, sp, {})} />
        ) : (
          <CalendarShell
            basePath={`/projects/${id}/plan`} params={cal} keep={{ plan, mode: "calendar" }} today={today} entries={entries} kindOptions={planKinds} timeZoneSelect
            emptyText={plan === "site" ? "Nothing is dated on site in this period: no site timeline items, bookings or dependencies." : "Nothing is dated in this period: no milestones, deliverables, task deadlines or delivery timeline items."}
          />
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------------------------------------ List and Timeline
  const supabase = await createClient();
  const [planR, milestoneR, depR, bookingR] = await Promise.all([
    supabase.from("proj_plan_items").select("*").eq("project_id", id),
    supabase.from("proj_milestones").select("id, title").eq("project_id", id).order("sort_order"),
    plan === "site" ? supabase.from("proj_external_dependencies").select("*").eq("project_id", id).order("expected_date", { nullsFirst: false }) : Promise.resolve({ data: [], error: null }),
    plan === "site" ? supabase.from("proj_site_bookings").select("*").eq("project_id", id).order("starts_at") : Promise.resolve({ data: [], error: null }),
  ]);
  if (planR.error || milestoneR.error || depR.error || bookingR.error) {
    return (
      <div className="space-y-4">
        {switches}
        <LoadError what="the plan" retryHref={planHref(id, sp, {})} />
      </div>
    );
  }
  const milestones = milestoneR.data ?? [];
  const milestoneTitle = (mid: string | null) => milestones.find((m) => m.id === mid)?.title ?? null;
  const items = planR.data ?? [];
  const deps = (depR.data ?? []) as ProjExternalDependencyRow[];
  const bookings = (bookingR.data ?? []) as ProjSiteBookingRow[];
  const checked = checkRaw ? bookings.find((b) => b.id === checkRaw) : undefined;
  const conflicts = checked ? ((await supabase.rpc("proj_booking_conflicts", { p_booking_id: checked.id })).data ?? []) : [];

  const actors = { canManage: view.canManage, headOfTeamIds: view.headOfTeamIds };
  const people = bookablePeople(actors, view.people).map((p) => ({ id: p.user_id, name: p.full_name ?? "Unnamed" }));
  const canBookAny = !finished && people.length > 0;
  const canOverride = hasProjCapability(ctx.grants, project.company_id, "override_site_conflict");
  const siteItems = items.filter((i) => i.plan === "site" && i.status !== "cancelled").map((i) => ({ id: i.id, title: i.title }));
  const checkHref = (bookingId: string) => `${planHref(id, sp, { plan: "site", mode: "list", check: bookingId }, ["view", "date", "tz", "kind"])}#bookings`;

  return (
    <div className="space-y-5">
      {switches}
      {intro}
      <PlanSection
        plan={plan} items={sortPlanItems(items.filter((i) => i.plan === plan))} canEdit={canEditPlan} projectId={id} siteTz={siteTz} milestones={milestones}
        milestoneTitle={milestoneTitle} defaultBase={plan === "delivery" ? (project.start_date ?? "") : (details.install_start ?? details.event_start ?? "")} bars={mode === "timeline"}
      />

      {plan === "site" ? (
        <>
          <Panel
            title="Dependencies on others"
            description="Things outside the team that have to happen first: structure ready, power and network, access, the standbuilder's work."
            actions={canEditPlan ? <DialogButton label="Add dependency" title="Add a dependency" variant="default"><DependencyForm projectId={id} siteTimezone={siteTz} milestones={milestones} /></DialogButton> : null}
          >
            <Muted className="mb-3">Recorded for the team only; nothing is sent to anyone. Times are site time ({siteTz.replace(/_/g, " ")}).</Muted>
            {deps.length === 0 ? (
              <EmptyState dense title="No dependencies recorded" description={canEditPlan ? "Add what you are waiting for, who is responsible and when it is expected." : "The Project Manager records what the project is waiting for."} />
            ) : (
              <Table className="min-w-[36rem]">
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
            description="A person reserved at a site, in the site's own time, with preparation and travel allowances."
            actions={canBookAny ? <DialogButton label="Add booking" title="Book someone on site" variant="default"><BookingForm projectId={id} siteTimezone={siteTz} people={people} siteItems={siteItems} /></DialogButton> : null}
          >
            <Muted className="mb-3">
              Several assignments in one day are never a conflict. Only physical site bookings are compared, across every project, including each booking&apos;s preparation and travel time. A booking is tentative until confirmed, and confirming one that overlaps another needs authority and a reason.
              {!view.canManage && view.headOfTeamIds.length > 0 ? " As a department head you can book the people of your own team." : ""}
            </Muted>
            {bookings.length === 0 ? (
              <EmptyState dense title="No site bookings" description={canBookAny ? "Book the people who have to be on site, then confirm each booking." : "The Project Manager, or the head of a person's department team, books people on site."} />
            ) : (
              <div className="space-y-3">
                {bookings.map((b) => {
                  const person = view.people.find((p) => p.user_id === b.user_id);
                  const mayBook = !finished && (person ? canBookPerson(actors, person) : view.canManage);
                  return <BookingCard key={b.id} b={b} projectId={id} name={view.nameOf(b.user_id)} checkHref={checkHref(b.id)} mayBook={mayBook} canOverride={canOverride} people={people} siteItems={siteItems} siteTz={siteTz} />;
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
        </>
      ) : null}
      {finished ? <Alert role="status">This project is {project.status === "archived" ? "archived" : "completed"}, so its plan is read-only.</Alert> : null}
    </div>
  );
}
