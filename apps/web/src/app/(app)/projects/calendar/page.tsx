import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Panel, PageHeader } from "@/components/projects/parts";
import { CalendarShell } from "@/components/projects/calendar/calendar-views";
import { SpanBars } from "@/components/projects/calendar/span-bars";
import { calendarHref, fetchRange, filterKinds, mapCompanyRows, mapMyRows, parseCalendarParams, visibleRange } from "@/components/projects/calendar/helpers";
import { COMPANY_NOT_SHOWN, getProjectsContext } from "@/lib/projects/context";
import { loadDirectory } from "@/lib/projects/data";
import { todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Project calendar" };

const MY_KINDS = [
  { id: "task", label: "Task deadlines" }, { id: "review", label: "Review requests" }, { id: "milestone", label: "Milestones" }, { id: "booking", label: "Site bookings" },
];

export default async function ProjectsCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const today = todayIso();
  const hasGrants = ctx.grants.length > 0;
  const directory = await loadDirectory();
  // Companies this person can look at: those they hold a Projects grant for, plus those of projects they are only linked to as Sales.
  const companyIds = [...new Set([...ctx.grants.map((g) => g.companyId), ...directory.map((d) => d.company_id)])];
  const scopeRaw = Array.isArray(sp.scope) ? sp.scope[0] : sp.scope;
  const scope: "mine" | "company" = hasGrants && scopeRaw !== "company" ? "mine" : "company";
  const params = parseCalendarParams(sp, today, scope === "mine" ? MY_KINDS.map((k) => k.id) : undefined);
  const companyRaw = Array.isArray(sp.company) ? sp.company[0] : sp.company;
  const companyId = companyIds.includes(companyRaw ?? "") ? (companyRaw as string) : companyIds[0];
  const keep: Record<string, string> = { scope, ...(scope === "company" && companyId ? { company: companyId } : {}) };

  const range = fetchRange(params.view, params.date);
  const supabase = await createClient();
  let error: string | null = null;
  let entries = [] as ReturnType<typeof mapMyRows>;
  if (scope === "mine") {
    const { data, error: e } = await supabase.rpc("proj_my_calendar", { p_from: range.from, p_to: range.to, p_view_tz: params.tz });
    if (e) error = e.message;
    entries = filterKinds(mapMyRows(data ?? []), params.kinds);
  } else if (companyId) {
    const { data, error: e } = await supabase.rpc("proj_company_calendar", { p_company_id: companyId, p_from: range.from, p_to: range.to });
    if (e) error = e.message;
    entries = mapCompanyRows(data ?? []);
  }
  const visible = visibleRange(params.view, params.date);
  const tabClass = (on: boolean) => `rounded-t-md border-b-2 px-3 py-2 text-sm font-medium ${on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;
  const base = { view: params.view, date: params.date, tz: params.tz === "Asia/Dubai" ? null : params.tz };

  return (
    <div className="space-y-5">
      <PageHeader title="Calendar" description="Deadlines, reviews, milestones and site bookings that are yours, and the company's project dates at summary level." />
      <nav aria-label="Calendar scope" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px">
        {hasGrants ? <Link href={calendarHref("/projects/calendar", { ...base, scope: "mine", kind: params.kinds })} aria-current={scope === "mine" ? "page" : undefined} className={tabClass(scope === "mine")}>My calendar</Link> : null}
        <Link href={calendarHref("/projects/calendar", { ...base, scope: "company", company: companyId })} aria-current={scope === "company" ? "page" : undefined} className={tabClass(scope === "company")}>Company calendar</Link>
      </nav>
      {scope === "company" && companyIds.length > 1 ? (
        <form method="get" action="/projects/calendar" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="scope" value="company" />
          <input type="hidden" name="view" value={params.view} />
          <input type="hidden" name="date" value={params.date} />
          <label className="space-y-1 text-sm"><span className="block font-medium">Company</span>
            <Select name="company" defaultValue={companyId} className="w-64">{companyIds.map((id) => <option key={id} value={id}>{ctx.companyName(id) === COMPANY_NOT_SHOWN ? "Company" : ctx.companyName(id)}</option>)}</Select>
          </label>
          <Button type="submit" variant="outline" size="sm">Show</Button>
        </form>
      ) : null}
      {scope === "company" ? (
        <Alert role="status">
          This calendar shows project summaries only: reference, name, status and the start and end dates. Milestones, tasks and bookings are not shown here.
          {hasGrants ? "" : " People who are only linked to a project as Sales see just their own projects."}
        </Alert>
      ) : null}
      {error ? <Alert variant="destructive" role="alert">The calendar could not be loaded: {error}</Alert> : null}
      {!companyId && scope === "company" ? (
        <Alert role="status">There is no company to show.</Alert>
      ) : (
        <>
          <CalendarShell
            basePath="/projects/calendar" params={params} keep={keep} today={today} entries={entries} showProject timeZoneSelect={scope === "mine"}
            kindOptions={scope === "mine" ? MY_KINDS : undefined}
            emptyText={scope === "mine" ? "You have no deadlines, reviews, milestones or site bookings in this period." : "No project in your view starts or runs in this period."}
          />
          {scope === "company" && entries.length > 0 ? (
            <Panel title="Project spans" description="A drawing of the same dates, for a quick overall picture. The agenda above has the dates in words.">
              <SpanBars entries={entries.filter((e) => (e.endDate ?? e.onDate ?? "") >= visible.from && (e.onDate ?? "") <= visible.to)} label="Project spans in the visible period" />
            </Panel>
          ) : null}
        </>
      )}
    </div>
  );
}
