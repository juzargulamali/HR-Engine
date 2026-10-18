import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { CalendarShell } from "@/components/projects/calendar/calendar-views";
import { fetchRange, filterKinds, mapProjectRows, parseCalendarParams } from "@/components/projects/calendar/helpers";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { todayIso } from "@/lib/projects/format";
import { Alert } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Project calendar" };

const KINDS = [
  { id: "milestone", label: "Milestones" }, { id: "deliverable", label: "Deliverables" }, { id: "task", label: "Task deadlines" },
  { id: "plan_delivery", label: "Delivery timeline" }, { id: "plan_site", label: "Site timeline" }, { id: "booking", label: "Site bookings" }, { id: "dependency", label: "Dependencies" },
];

export default async function ProjectCalendarPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details") redirect(`/projects/${id}`);
  const today = todayIso();
  const cal = parseCalendarParams(sp, today, KINDS.map((k) => k.id));
  const range = fetchRange(cal.view, cal.date);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_project_calendar", { p_project_id: id, p_from: range.from, p_to: range.to, p_view_tz: cal.tz });
  const entries = filterKinds(mapProjectRows(data ?? [], id, view.project.reference, view.project.name), cal.kinds);
  return (
    <div className="space-y-4">
      {error ? <Alert variant="destructive" role="alert">The calendar could not be loaded: {error.message}</Alert> : null}
      <CalendarShell
        basePath={`/projects/${id}/calendar`} params={cal} today={today} entries={entries} kindOptions={KINDS} timeZoneSelect
        emptyText="Nothing is dated in this period: no milestones, deliverables, task deadlines, timeline items, bookings or dependencies."
      />
    </div>
  );
}
