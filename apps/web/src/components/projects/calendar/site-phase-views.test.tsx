// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/projects/p1/plan", useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock("@/lib/actions/projectsSite", () => new Proxy({}, { get: () => vi.fn() }));

import { CalendarShell } from "./calendar-views";
import { BackToCalendar } from "./back-to-calendar";
import { mapProjectRows, mapSiteActivities, parseCalendarParams, withFrom, type CalendarView } from "./helpers";
import { siteActivityState, type SitePhaseInfo } from "@/lib/projects/site-state";
import type { ProjProjectCalendarRow } from "@/types/projects";

afterEach(() => { cleanup(); nav.search = ""; try { sessionStorage.clear(); } catch { /* not available */ } });

/**
 * One activity, four moments. The Calendar's Month, Week and Agenda views and the Site schedule / Work must say the same thing at each, because they all ask the one shared function
 * (siteActivityState, from the database phase): never the plan item's stored status, never the clock.
 */
const TODAY = "2099-02-10";
const ACT = "a1";
const phase = (over: Partial<SitePhaseInfo>): SitePhaseInfo => ({ phase: "scheduled", basis: "activity", first_day: TODAY, last_day: TODAY, started_at: null, kind: "setup", state: "confirmed", today: TODAY, ...over });
// The activity is timed 08:00 to 18:00 site time on the day; "now" is irrelevant to the wording, which is the point.
const calendarRow = (status: string): ProjProjectCalendarRow => ({ kind: "plan_site", item_id: ACT, title: "Installation", on_date: null, end_date: null, starts_at: `${TODAY}T04:00:00Z`, ends_at: `${TODAY}T14:00:00Z`, tz: "Asia/Dubai", status, who: null, detail: null }) as unknown as ProjProjectCalendarRow;

const MOMENTS: { name: string; phase: SitePhaseInfo | null; itemStatus: string; key: string; label: RegExp }[] = [
  { name: "before the start time", phase: phase({ phase: "scheduled", first_day: "2099-02-12", last_day: "2099-02-12" }), itemStatus: "planned", key: "scheduled", label: /^Confirmed Setup on 12 Feb$/ },
  { name: "after the start time, with no start record", phase: phase({ phase: "due_today" }), itemStatus: "planned", key: "due_today", label: /^Confirmed Setup today$/ },
  { name: "after the date, with no start record (even when the stored status says in progress)", phase: phase({ phase: "date_passed", first_day: "2099-02-08", last_day: "2099-02-08" }), itemStatus: "in_progress", key: "date_passed", label: /date passed · start unconfirmed/ },
  { name: "after an explicit start", phase: phase({ phase: "started", started_at: `${TODAY}T04:05:00Z`, started_by: "Mona Manager" }), itemStatus: "in_progress", key: "started", label: /^Installation started 10 Feb$/ },
  { name: "when finished", phase: null, itemStatus: "done", key: "finished", label: /^Finished$/ },
];

function statesIn(view: CalendarView, m: (typeof MOMENTS)[number]): { text: string; state: string | null }[] {
  const day = m.phase?.first_day ?? TODAY;
  const row = { ...calendarRow(m.itemStatus), starts_at: `${day}T04:00:00Z`, ends_at: `${day}T14:00:00Z` } as ProjProjectCalendarRow;
  const entries = mapProjectRows([row], "p1", "UAE-P-1", "Show", m.phase ? { [ACT]: m.phase } : {});
  const params = parseCalendarParams({ view, date: day, tz: "Asia/Dubai" }, TODAY);
  render(<CalendarShell basePath="/projects/p1/plan" params={params} keep={{ plan: "site", mode: "calendar" }} today={TODAY} entries={entries} timeZoneSelect emptyText="Nothing" />);
  const found = screen.getAllByTestId("calendar-entry-state").filter((e) => e.getAttribute("data-entry") === `plan_site:${ACT}`).map((e) => ({ text: e.textContent ?? "", state: e.getAttribute("data-state") }));
  cleanup();
  return found;
}

describe("a site activity says the same thing in Month, Week and Agenda, and on the Site schedule and Work", () => {
  for (const m of MOMENTS) {
    it(m.name, () => {
      const shared = siteActivityState(m.phase, m.itemStatus);             // what the Site schedule row and Work's "Next on site" show
      expect(shared.key).toBe(m.key);
      expect(shared.label).toMatch(m.label);
      const perView = (["month", "week", "agenda"] as const).map((v) => statesIn(v, m));
      for (const found of perView) {
        expect(found.length).toBeGreaterThan(0);
        for (const f of found) {
          expect(f.state).toBe(m.key);
          expect(f.text.startsWith(shared.label)).toBe(true);
        }
      }
      // the three views are word for word the same
      expect(new Set(perView.flat().map((f) => f.text)).size).toBe(1);
    });
  }

  it("is Started only for an explicit start record: a start time that has passed, a passed date and a stored 'in progress' never read Started", () => {
    for (const m of MOMENTS) {
      const s = siteActivityState(m.phase, m.itemStatus);
      expect(s.started, m.name).toBe(m.key === "started");
      if (m.key !== "started") expect(s.label, m.name).not.toMatch(/started/i);
    }
    // an activity whose whole window is in the past and that carries no start record
    const passed = siteActivityState(phase({ phase: "date_passed", first_day: "2099-01-01", last_day: "2099-01-02" }), "in_progress");
    expect(passed.started).toBe(false);
    expect(passed.detail).toMatch(/nobody has recorded that it started/);
  });

  it("the Projects calendar's site activities use the same function, so the same phase reads the same there", () => {
    const p = phase({ phase: "due_today" });
    const [mine] = mapSiteActivities([{ id: ACT, project_id: "p1", reference: "UAE-P-1", project_name: "Show", project_status: "in_progress", title: "Installation", kind: "setup", run_label: null, state: "confirmed",
      start_date: TODAY, end_date: TODAY, starts_at: null, ends_at: null, tz: "Asia/Dubai", effective: {}, owner_name: null, crew_total: 0, call_missing: 0, actual_started_at: null, phase: p } as never], TODAY, TODAY);
    const [own] = mapProjectRows([calendarRow("planned")], "p1", "UAE-P-1", "Show", { [ACT]: p });
    expect(mine!.statusLabel).toBe(own!.statusLabel);
    expect(mine!.status).toBe(own!.status);
  });

  it("when the phases could not be loaded, an open activity says its state is not available: it never falls back to the stored status or a guess", () => {
    const [e] = mapProjectRows([calendarRow("in_progress")], "p1", "UAE-P-1", "Show", null);
    expect(e).toMatchObject({ status: "unknown", statusLabel: "State not available" });
    // a finished activity still says Finished from its own status
    expect(mapProjectRows([calendarRow("done")], "p1", "UAE-P-1", "Show", null)[0]!.statusLabel).toBe("Finished");
    // rows that are not site activities keep their own words
    const [task] = mapProjectRows([{ ...calendarRow("in_progress"), kind: "task" } as ProjProjectCalendarRow], "p1", "UAE-P-1", "Show", null);
    expect(task!.statusLabel).toBe("In progress");
  });
});

describe("Back to Calendar", () => {
  it("every calendar entry says which calendar it was opened from, ahead of any anchor", () => {
    expect(withFrom("/projects/p1/work", "calendar")).toBe("/projects/p1/work?from=calendar");
    expect(withFrom("/projects/p1/plan?plan=site&mode=list#site-a1", "plan-calendar")).toBe("/projects/p1/plan?plan=site&mode=list&from=plan-calendar#site-a1");
    expect(mapProjectRows([calendarRow("planned")], "p1", "UAE-P-1", "Show", {})[0]!.href).toBe("/projects/p1/plan?plan=site&mode=list&from=plan-calendar#site-a1");
  });
  it("is offered only on a record opened from a calendar, and returns to the remembered date, view and filters", () => {
    render(<BackToCalendar projectId="p1" />);
    expect(screen.queryByText("Back to Calendar")).toBeNull();
    cleanup();
    sessionStorage.setItem("os-list:calendar:href", "/projects/calendar?scope=mine&view=week&date=2099-02-10&tz=Europe%2FLondon&kind=task%2Csite_activity");
    nav.search = "from=calendar";
    render(<BackToCalendar projectId="p1" />);
    expect(screen.getByText("Back to Calendar").closest("a")!.getAttribute("href")).toBe("/projects/calendar?scope=mine&view=week&date=2099-02-10&tz=Europe%2FLondon&kind=task%2Csite_activity");
    cleanup();
    sessionStorage.setItem("os-list:plan-calendar-p1:href", "/projects/p1/plan?plan=site&mode=calendar&view=agenda&date=2099-03-01&kind=plan_site");
    nav.search = "plan=site&mode=list&from=plan-calendar";
    render(<BackToCalendar projectId="p1" />);
    expect(screen.getByText("Back to Calendar").closest("a")!.getAttribute("href")).toBe("/projects/p1/plan?plan=site&mode=calendar&view=agenda&date=2099-03-01&kind=plan_site");
  });
  it("falls back to the plain calendar when nothing is remembered, and never to an address outside the calendar", () => {
    nav.search = "from=calendar";
    render(<BackToCalendar projectId="p1" />);
    expect(screen.getByText("Back to Calendar").closest("a")!.getAttribute("href")).toBe("/projects/calendar");
    cleanup();
    sessionStorage.setItem("os-list:plan-calendar-p1:href", "https://example.invalid/elsewhere");
    nav.search = "from=plan-calendar";
    render(<BackToCalendar projectId="p1" />);
    expect(screen.getByText("Back to Calendar").closest("a")!.getAttribute("href")).toBe("/projects/p1/plan?mode=calendar");
  });
});
