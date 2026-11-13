import Link from "next/link";
import { CalendarDays, ClipboardCheck, FolderKanban, Hourglass, Layers, PackageCheck, ReceiptText, ShoppingBag, UserPlus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  canCreateEmployee,
  canViewCompanyOverview,
  canViewHrAlerts,
  isBirthdayToday,
  getBusinessDateString,
  getBusinessHour,
  formatBusinessDateLong,
  formatBusinessTime,
  resolveCountryTimeZone,
  DASHBOARD_TIMEZONE,
} from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { loadMyPendingApprovalItems } from "@/lib/approvals/pending";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWeather } from "@/lib/weather";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { OsHero } from "@/components/os/hero";
import { OsScope } from "@/components/os/scope";
import { OsStatCard } from "@/components/os/stat-card";
import { AttentionLine } from "@/components/my-day/attention-line";
import { DecisionsCard } from "@/components/my-day/decisions-card";
import { DeliveryWeekCard } from "@/components/my-day/delivery-week";
import { HrAttention, HrStatCards, TeamDistribution } from "@/components/my-day/hr-section";
import { MyWorkToday } from "@/components/my-day/my-work-today";
import { SiteAssignmentsCard } from "@/components/my-day/site-assignments-card";
import { loadSiteAssignments } from "@/lib/my-day/site-assignments";
import { NextDispatch } from "@/components/my-day/next-dispatch";
import { PeopleToday } from "@/components/my-day/people-today";
import { ProjectHealth } from "@/components/my-day/project-health";
import { SalesPipeline } from "@/components/my-day/sales-pipeline";
import { approvalCandidates, budgetCandidates, buildAttention, commercialApprovalCandidates, failed, handoverCandidates, hrCandidates, noteCandidates, ok, projectDecisionCandidates, salesCandidates, taskCandidates, type AttentionSourceResult } from "@/lib/my-day/attention";
import { dateText } from "@/lib/projects/format";
import { loadEquipment, loadLiveClock } from "@/lib/my-day/loaders";
import { loadProjectsDay } from "@/lib/my-day/projects-day";
import { loadMyEquipmentReviews, loadOperationsDay } from "@/lib/my-day/operations-day";
import { equipmentReviewCandidates, opsAnswerCandidates, opsCandidatesFailed, opsDaySummary, opsReviewCandidates } from "@/lib/my-day/operations";
import { OperationsSummary } from "@/components/my-day/operations-summary";
import { loadMyWaitingRequests, waitingText } from "@/lib/my-day/waiting";
import type { LiveSummary } from "@/lib/my-day/live";
import { cn } from "@/lib/utils";
import { logServerError } from "@/lib/log";
import { BirthdaysSection } from "./birthdays-section";
import { getCompanySnapshot } from "./dashboard-data";
import { CompanyComparisonTable } from "./company-comparison-table";
import { attendanceSentence, CALENDAR_NOTE } from "./attendance-summary";
import { budgetWaitingDetail, handoverNotice, waitingOnOthersItems, type ActionItem } from "./action-centre";
import { AttendanceClockCard } from "./attendance-clock-card";
import { AttendanceCompletionBar } from "./attendance-completion-bar";
import { UpcomingSection } from "./upcoming-section";
import { DashboardHeader } from "./dashboard-header";
import { loadSalesToday } from "@/lib/crm/my-day";
import { loadBudgetDay } from "@/lib/budget/my-day-data";
import { loadWaitingNotes } from "@/lib/inventory/project-notes-data";

export const metadata = { title: "My Day" };

const HORIZON_DAYS = 30;
const ROUTE = "/";

// Presentation-only, specific to this one dashboard header — not business
// logic, so kept local rather than in packages/domain alongside
// COUNTRY_TIMEZONES.
const COUNTRY_LOCATION_LABELS: Record<string, string> = {
  AE: "Dubai, UAE",
  SA: "Riyadh, Saudi Arabia",
  PL: "Warsaw, Poland",
};
const COUNTRY_COORDINATES: Record<string, { lat: number; lon: number }> = {
  AE: { lat: 25.2048, lon: 55.2708 },
  SA: { lat: 24.7136, lon: 46.6753 },
  PL: { lat: 52.2297, lon: 21.0122 },
};
const DUBAI_LOCATION_LABEL = "Dubai, UAE";
const DUBAI_COORDINATES = COUNTRY_COORDINATES.AE!;

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) return null; // guarded by the layout above

  const firstName = session.fullName ? session.fullName.split(" ")[0] : null;
  const now = new Date();
  // The person's own site assignments (a scoped read that works for someone who is not on the project at all).
  const siteAssignments = await loadSiteAssignments();
  // Anchors every CROSS-COMPANY aggregate below (upcoming holidays, who's on
  // leave today, the 30-day lookahead horizon) to Dubai — Enginious's own
  // reference timezone for anything that isn't scoped to one specific
  // company/country. Each company's OWN attendance/holiday/Recovery-day
  // snapshot (getCompanySnapshot) derives its own business-local date
  // internally instead of using this one.
  const today = getBusinessDateString(DASHBOARD_TIMEZONE, now);
  const supabase = await createClient();

  const showHrView = canViewHrAlerts(session.grants);

  let allCompanies: { id: string; legal_name: string; country_code: string }[] = [];
  let companiesFailed = false;
  try {
    const { data: companies, error } = await supabase.from("companies").select("id, legal_name, country_code");
    if (error) throw error;
    allCompanies = companies ?? [];
  } catch (error) {
    logServerError({ route: ROUTE, operation: "list companies" }, error);
    companiesFailed = true;
  }
  const overviewCompanies = allCompanies.filter((c) => canViewCompanyOverview(session.grants, c.id));
  const canAddEmployee = allCompanies.some((c) => canCreateEmployee(session.grants, c.id));

  // Every source of "Needs me" and "Waiting on others" is read at the same time and settled on its own (Promise.allSettled): a source that fails
  // becomes its own error row and never hides, empties or delays the others. Approving isn't an HR/CEO-only capability (a line manager or
  // Finance approver needs it too), so the approvals count is read for anyone; the company-wide sections below stay gated to canViewHrAlerts.
  // The approvals count covers the steps routed to this person by name AND the Recovery Leave queue steps they may decide (the same rule as the Approvals page).
  const [approvalsRead, salesRead, projectsRead, equipmentRead, budgetRead, waitingRead, notesRead, opsRead, bookingReviewsRead] = await Promise.allSettled([
    loadMyPendingApprovalItems(supabase, session),
    loadSalesToday(),
    loadProjectsDay(today),
    loadEquipment(),
    loadBudgetDay(session.userId),
    session.employeeId ? loadMyWaitingRequests(supabase, session.employeeId) : Promise.resolve(null),
    loadWaitingNotes(),
    loadOperationsDay(),
    loadMyEquipmentReviews(),
  ]);
  const failedSource = (what: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === "rejected") logServerError({ route: ROUTE, operation: `load ${what}` }, r.reason);
  };
  failedSource("my pending approvals", approvalsRead);
  failedSource("sales follow-ups", salesRead);
  failedSource("projects", projectsRead);
  failedSource("equipment requests", equipmentRead);
  failedSource("project budget decisions", budgetRead);
  failedSource("my submitted requests", waitingRead);
  failedSource("dispatch and return notes", notesRead);
  failedSource("operations", opsRead);
  failedSource("equipment bookings to review", bookingReviewsRead);
  // Operations, for people with Operations access only (null otherwise: nothing is read, nothing is shown). A failed read is "error", never an empty summary.
  const opsDay = opsRead.status === "fulfilled" ? opsRead.value : "error";
  // A failed read is "error", never 0: the tile shows "—" and the greeting says the approvals could not be loaded.
  const myPendingApprovals: number | "error" = approvalsRead.status === "fulfilled" ? approvalsRead.value.length : "error";

  let isMyBirthdayToday = false;
  // Also drives the employee-only dashboard header's own timezone/location
  // below — a null country_code (no linked employee, or the lookup failed)
  // falls back to Dubai via resolveCountryTimeZone/COUNTRY_LOCATION_LABELS.
  let myCountryCode: string | null = null;
  if (session.employeeId) {
    try {
      const { data: me, error } = await supabase.from("employees").select("date_of_birth, country_code").eq("id", session.employeeId).maybeSingle();
      if (error) throw error;
      myCountryCode = me?.country_code ?? null;
      // The employee's OWN business-local date, not the Dubai-anchored
      // `today` above — a UAE employee's birthday should show as "Today"
      // exactly at their own local midnight, not Dubai's (which happens to
      // be the same for AE, but must not be assumed for SA/PL).
      const myToday = getBusinessDateString(resolveCountryTimeZone(myCountryCode), now);
      isMyBirthdayToday = !!me?.date_of_birth && isBirthdayToday(me.date_of_birth, myToday);
    } catch (error) {
      logServerError({ route: ROUTE, operation: "check own birthday" }, error);
    }
  }

  let snapshots: Awaited<ReturnType<typeof getCompanySnapshot>>[] = [];
  let contractsEndingCount = 0;
  let probationDueCount = 0;
  let docsExpiringCount = 0;
  let identityExpiringCount = 0;
  let upcomingHolidays: { name: string; holiday_date: string; countryCode: string }[] = [];
  let onLeaveToday: { id: string; name: string; companyName: string }[] = [];
  // Set only if the block below throws outright (a real connection/rate-limit
  // failure) — getCompanySnapshot() already protects itself per company, so
  // this only covers the OTHER company-wide queries in this section. Lets
  // the page render everything else (workforce snapshot, action centre for
  // the viewer's own approvals, etc.) instead of crashing the whole page.
  // A failed list of companies means the workforce numbers below cannot be trusted either: say so instead of showing 0 employees.
  let hrSectionError = showHrView && companiesFailed;

  if (showHrView) {
    try {
      // Anchored on the Dubai `today` string above (calendar-day arithmetic
      // on the business date, not a fresh `new Date()`) so this lookahead
      // window stays consistent with the same reference date the holidays/
      // onLeaveToday queries below use.
      const horizonDate = new Date(`${today}T00:00:00Z`);
      horizonDate.setUTCDate(horizonDate.getUTCDate() + HORIZON_DAYS);
      const horizon = horizonDate.toISOString().slice(0, 10);

      const [snapshotResults, contractResult, probationResult, docResult, identityResult] = await Promise.all([
        Promise.all(overviewCompanies.map((c) => getCompanySnapshot(supabase, c))),
        supabase.from("employment_contracts").select("id", { count: "exact", head: true }).eq("is_current", true).lte("end_date", horizon),
        supabase.from("employment_contracts").select("id", { count: "exact", head: true }).eq("is_current", true).lte("probation_end_date", horizon),
        supabase.from("employee_documents").select("id", { count: "exact", head: true }).in("status", ["expiring_soon", "expired"]),
        supabase.from("identity_documents").select("id", { count: "exact", head: true }).not("expiry_date", "is", null).lte("expiry_date", horizon),
      ]);
      if (contractResult.error) throw contractResult.error;
      if (probationResult.error) throw probationResult.error;
      if (docResult.error) throw docResult.error;
      if (identityResult.error) throw identityResult.error;

      snapshots = snapshotResults;
      contractsEndingCount = contractResult.count ?? 0;
      probationDueCount = probationResult.count ?? 0;
      docsExpiringCount = docResult.count ?? 0;
      identityExpiringCount = identityResult.count ?? 0;

      const countryCodes = [...new Set(overviewCompanies.map((c) => c.country_code))];
      const { data: holidays, error: holidaysError } =
        countryCodes.length > 0
          ? await supabase
              .from("public_holidays")
              .select("name, holiday_date, country_code")
              .in("country_code", countryCodes)
              .gte("holiday_date", today)
              .lte("holiday_date", horizon)
              .order("holiday_date", { ascending: true })
              .limit(6)
          : { data: [] as { name: string; holiday_date: string; country_code: string }[], error: null };
      if (holidaysError) throw holidaysError;
      upcomingHolidays = (holidays ?? []).map((h) => ({ name: h.name, holiday_date: h.holiday_date, countryCode: h.country_code }));

      const employeeNameById = new Map<string, { name: string; companyName: string }>();
      for (const s of snapshots) {
        for (const e of s.employees) {
          employeeNameById.set(e.id, { name: `${e.first_name} ${e.last_name}`, companyName: s.companyName });
        }
      }
      const allEmployeeIds = [...employeeNameById.keys()];
      const { data: leaveToday, error: leaveTodayError } =
        allEmployeeIds.length > 0
          ? await supabase.from("attendance_records").select("employee_id").eq("work_date", today).eq("status", "leave").in("employee_id", allEmployeeIds)
          : { data: [] as { employee_id: string }[], error: null };
      if (leaveTodayError) throw leaveTodayError;
      onLeaveToday = (leaveToday ?? [])
        .map((r) => {
          const info = employeeNameById.get(r.employee_id);
          return info ? { id: r.employee_id, name: info.name, companyName: info.companyName } : null;
        })
        .filter((v): v is { id: string; name: string; companyName: string } => v !== null);
    } catch (error) {
      logServerError({ route: ROUTE, operation: "load company-wide workforce data" }, error);
      hrSectionError = true;
      snapshots = [];
      contractsEndingCount = 0;
      probationDueCount = 0;
      docsExpiringCount = 0;
      identityExpiringCount = 0;
      upcomingHolidays = [];
      onLeaveToday = [];
    }
  }

  const totals = snapshots.reduce(
    (acc, s) => ({
      totalEmployees: acc.totalEmployees + s.totalEmployees,
      presentCount: acc.presentCount + s.presentCount,
      leaveCount: acc.leaveCount + s.leaveCount,
      absentCount: acc.absentCount + s.absentCount,
      notRecordedCount: acc.notRecordedCount + s.notRecordedCount,
      notRecordedScheduledCount: acc.notRecordedScheduledCount + s.notRecordedScheduledCount,
      notRecordedRestCount: acc.notRecordedRestCount + s.notRecordedRestCount,
      notRecordedUnknownCount: acc.notRecordedUnknownCount + s.notRecordedUnknownCount,
      leaveRequestsAwaitingDecision: acc.leaveRequestsAwaitingDecision + s.leaveRequestsAwaitingDecision,
    }),
    {
      totalEmployees: 0,
      presentCount: 0,
      leaveCount: 0,
      absentCount: 0,
      notRecordedCount: 0,
      notRecordedScheduledCount: 0,
      notRecordedRestCount: 0,
      notRecordedUnknownCount: 0,
      leaveRequestsAwaitingDecision: 0,
    },
  );

  // LIVE clock status (open sessions), for the people the overview covers. Separate from the recorded attendance in `totals`.
  let live: LiveSummary | "error" | null = null;
  if (showHrView && !hrSectionError) {
    try {
      live = await loadLiveClock(new Set(snapshots.flatMap((snap) => snap.employees.map((e) => e.id))));
    } catch (e) {
      logServerError({ route: ROUTE, operation: "load live clock status" }, e);
      live = "error";
    }
  }

  // Real, permission-scoped, and role-prioritized — never a decorative
  // default. "Approving" outranks everything else since it's blocking
  // someone else's work; HR's own creation flow comes next; a plain
  // employee's most common next step is requesting time off.
  const primaryAction: { href: string; label: string; icon: LucideIcon } =
    myPendingApprovals === "error"
      ? { href: "/approvals", label: "Review approvals", icon: ClipboardCheck }
      : myPendingApprovals > 0
      ? { href: "/approvals", label: `Review approvals (${myPendingApprovals})`, icon: ClipboardCheck }
      : canAddEmployee
        ? { href: "/employees/new", label: "Add employee", icon: UserPlus }
        : session.employeeId
          ? { href: "/leave/new", label: "Request leave", icon: CalendarDays }
          : { href: "/employees", label: "Browse employees", icon: Users };

  const secondaryActions: { href: string; label: string; icon: LucideIcon }[] = [
    session.employeeId ? { href: "/reimbursements", label: "Submit expense", icon: ReceiptText } : null,
    { href: "/employees", label: "View employees", icon: Users },
  ].filter((a): a is { href: string; label: string; icon: LucideIcon } => a !== null && a.href !== primaryAction.href);

  // Sales follow-ups for people with a Sales grant (same loaders and rules as the Sales overview; "none" for everyone else).
  const salesToday: Awaited<ReturnType<typeof loadSalesToday>> = salesRead.status === "fulfilled" ? salesRead.value : { status: "error" };

  // Projects & Tasks for people with Projects access (null for everyone else, and when it is not installed). Real counts only; the person's own
  // tasks by title ("My work today") and the ones they sent for review come from the same settled read.
  const projectsDay = projectsRead.status === "fulfilled" ? projectsRead.value : null;
  const projectRows = projectsRead.status === "rejected" ? "error" : (projectsDay?.rows ?? null);
  const projectsCtx = projectsDay?.ctx ?? null;
  const hasProjects = projectRows !== null && !!projectsCtx?.installed && (projectsCtx.grants.length > 0 || !!projectsCtx.loadFailed);
  const portfolio = projectsRead.status === "rejected" ? "error" : (projectsDay?.portfolio ?? null);
  const myWork = projectsRead.status === "rejected" ? "error" : (projectsDay?.work ?? null);
  const tasksInReviewCount = projectsRead.status === "rejected" ? "error" : (projectsDay?.inReview ?? null);
  // Equipment requests for people with Inventory access (null otherwise, and when Inventory is not installed).
  const equipment = equipmentRead.status === "fulfilled" ? equipmentRead.value : "error";
  const quietProjectItems: ActionItem[] = Array.isArray(projectRows)
    ? projectRows.filter((r) => !r.needsYou).map((r) => ({ key: r.key, icon: FolderKanban, label: r.label, count: r.count, href: r.href }))
    : [];

  // Project budgets and final expenses waiting for this person's decision, from the Finance inbox (pbx_inbox: scoped by the database, no Projects access needed).
  // What they submitted themselves waits under "Waiting on others", never as a decision for them. A failed read is an error row, never 0.
  let budgetWaitingItems: ActionItem[] = [];
  let budgetQuietItems: ActionItem[] = [];
  if (budgetRead.status === "fulfilled" && budgetRead.value.status === "ok") {
    const { waitingOnOthers, waitingOnOthersWith, waitingOnOthersHref, decidedRecently } = budgetRead.value.day;
    budgetWaitingItems = [{ key: "budget-waiting", icon: ReceiptText, label: "Project budgets you submitted, waiting on others", count: waitingOnOthers, href: waitingOnOthersHref, detail: budgetWaitingDetail(waitingOnOthersWith, now) }];
    budgetQuietItems = [{ key: "budget-decided", icon: ReceiptText, label: "Budget decisions on your projects in the last 14 days", count: decidedRecently.count, href: decidedRecently.href }];
  }

  // "Waiting on others": what this person submitted themselves (budgets, leave, claims, Recovery Leave, tasks sent for review). Never a decision for them.
  const waitingItems: ActionItem[] = [
    ...budgetWaitingItems,
    ...waitingOnOthersItems(waitingRead.status === "rejected" ? "error" : waitingRead.value, typeof tasksInReviewCount === "number" ? tasksInReviewCount : 0, now),
    ...(tasksInReviewCount === "error" ? [{ key: "waiting-review", icon: Hourglass, label: "Your tasks sent for review could not be loaded", count: 0, href: "/projects/work", error: true }] : []),
  ].filter((i) => i.count > 0 || i.error);

  // ONE list of what needs attention, built once from the authorised data of every source. The headline under the greeting and the "Needs me" list are both
  // read from this same value (the number is the list's length), so they cannot disagree. A source that failed is named in both and never read as "nothing".
  const sources: AttentionSourceResult[] = [
    approvalsRead.status === "fulfilled" ? ok("approvals", approvalCandidates(approvalsRead.value, today, now, dateText)) : failed("approvals"),
    ...(projectsRead.status === "rejected"
      ? [failed("project-tasks"), failed("project-decisions")]
      : [
          ...(!projectsDay || projectsDay.tasks === null ? [] : [projectsDay.tasks === "error" ? failed("project-tasks") : ok("project-tasks", taskCandidates(projectsDay.tasks, dateText))]),
          ...(!projectsDay || projectsDay.decisions === null ? [] : [projectsDay.decisions === "error" ? failed("project-decisions") : ok("project-decisions", projectDecisionCandidates(projectsDay.decisions, now))]),
        ]),
    ...(salesToday.status === "error"
      ? [failed("sales")]
      : salesToday.status === "ok"
        ? [
            ok("sales", salesCandidates(salesToday.data, dateText)),
            ...(salesToday.data.handover.status === "ok" ? [ok("sales-handover", handoverCandidates(salesToday.data.handover, now))] : salesToday.data.handover.status === "error" ? [failed("sales-handover")] : []),
            ...(salesToday.data.approvals.status === "ok" ? [ok("sales-approvals", commercialApprovalCandidates(salesToday.data.approvals, now))] : salesToday.data.approvals.status === "error" ? [failed("sales-approvals")] : []),
          ]
        : []),
    ...(budgetRead.status === "rejected" || budgetRead.value.status === "error"
      ? [failed("budgets")]
      : budgetRead.value.status === "ok"
        ? [ok("budgets", budgetCandidates(budgetRead.value.day, now)), ...(budgetRead.value.day.pmReadFailed ? [failed("budget-projects")] : [])]
        : []),
    ...(notesRead.status === "rejected" || notesRead.value.status === "error" ? [failed("notes")] : notesRead.value.status === "ok" ? [ok("notes", noteCandidates(notesRead.value, now))] : []),
    // Operations: only what the person can act on themselves. A handover to assign is already listed once by the Projects source above.
    ...(opsDay === "error" ? [failed("operations")] : opsDay ? [opsCandidatesFailed(opsDay) ? failed("operations") : ok("operations", [...opsAnswerCandidates(opsDay, now), ...opsReviewCandidates(opsDay, session.userId, now)])] : []),
    // "Review equipment booking" on the projects this person manages: the Project Manager's action.
    ...(bookingReviewsRead.status === "rejected" ? [failed("project-equipment")] : bookingReviewsRead.value ? [ok("project-equipment", equipmentReviewCandidates(bookingReviewsRead.value, now))] : []),
    ...(showHrView ? [hrSectionError ? failed("hr") : ok("hr", hrCandidates({ contracts: contractsEndingCount, probation: probationDueCount, docs: docsExpiringCount, identity: identityExpiringCount }))] : []),
  ];
  const attention = buildAttention(sources);
  const hrAlertRows: ActionItem[] = attention.items.filter((i) => i.sources.includes("hr")).map((i) => ({ key: i.key, icon: i.icon, label: i.title, count: i.records ?? 0, href: i.href }));

  // Cross-company CEO/HR view -> Dubai; an employee-only view -> that
  // employee's own company's country (myCountryCode, resolved above
  // alongside the birthday check). Weather is fetched once, server-side,
  // here — never in the client header component itself (see
  // lib/weather.ts and dashboard-header.tsx's own doc comments) — and a
  // failure resolves to `null` rather than throwing, so it can never delay
  // or break this page.
  const dashboardTimeZone = showHrView ? DASHBOARD_TIMEZONE : resolveCountryTimeZone(myCountryCode);
  const headerLocationLabel = showHrView
    ? DUBAI_LOCATION_LABEL
    : (myCountryCode && COUNTRY_LOCATION_LABELS[myCountryCode]) || DUBAI_LOCATION_LABEL;
  const headerCoordinates = showHrView ? DUBAI_COORDINATES : (myCountryCode && COUNTRY_COORDINATES[myCountryCode]) || DUBAI_COORDINATES;
  const headerWeather = await getCurrentWeather(headerCoordinates.lat, headerCoordinates.lon);
  const headerInitialDateLabel = formatBusinessDateLong(dashboardTimeZone, now);
  const headerInitialTimeLabel = formatBusinessTime(dashboardTimeZone, now);

  const stats: React.ReactNode[] = [];
  if (hasProjects) {
    stats.push(<OsStatCard key="projects" href="/projects" label="Active projects" value={portfolio && portfolio !== "error" ? portfolio.activeCount : "—"} icon={Layers} edge="blue" hint={portfolio === "error" ? "Could not be loaded" : undefined} />);
  }
  if (salesToday.status === "ok") {
    stats.push(<OsStatCard key="sales" href="/sales/opportunities" label="Open enquiries" value={salesToday.data.openCount} icon={ShoppingBag} edge="cyan" />);
  } else if (salesToday.status === "error") {
    stats.push(<OsStatCard key="sales" href="/sales/opportunities" label="Open enquiries" value="—" icon={ShoppingBag} edge="cyan" hint="Could not be loaded" />);
  }
  if (equipment && equipment !== "error") {
    stats.push(<OsStatCard key="equipment" href="/inventory/requests" label="Live equipment requests" value={equipment.summary.live} icon={PackageCheck} edge="cyan" hint={equipment.summary.withShortage > 0 ? `${equipment.summary.withShortage} with a shortage` : undefined} />);
  } else if (equipment === "error") {
    stats.push(<OsStatCard key="equipment" href="/inventory/requests" label="Live equipment requests" value="—" icon={PackageCheck} edge="cyan" hint="Could not be loaded" />);
  }
  const hasLeft = hasProjects || salesToday.status !== "none";
  const statCols = ({ 1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4" } as Record<number, string>)[Math.min(4, stats.length)];
  // What is open but not an action (and so not counted in the headline): unread discussion, recent budget decisions, a handover the PM accepted.
  const alsoOpen = [...quietProjectItems, ...budgetQuietItems.filter((i) => i.count > 0), ...(salesToday.status === "ok" ? handoverNotice(salesToday.data.handover) : [])];

  return (
    <OsScope className="space-y-4">
      {isMyBirthdayToday ? (
        <Alert variant="success">
          <span className="font-heading font-semibold">Enginious wishes you a very Happy Birthday{firstName ? `, ${firstName}` : ""}!</span>
        </Alert>
      ) : null}

      <OsHero
        title={`Good ${greetingPeriod(getBusinessHour(dashboardTimeZone, now))}${firstName ? `, ${firstName}` : ""}`}
        sub={<AttentionLine headline={attention.headline} />}
        meta={
          <DashboardHeader timeZone={dashboardTimeZone} locationLabel={headerLocationLabel} initialDateLabel={headerInitialDateLabel} initialTimeLabel={headerInitialTimeLabel} weather={headerWeather} />
        }
      >
        <Link href={primaryAction.href} className={cn(buttonVariants({ variant: "default" }))}>
          <primaryAction.icon className="h-4 w-4" aria-hidden />
          {primaryAction.label}
        </Link>
        {secondaryActions.map((action) => (
          <Link key={action.href} href={action.href} className={cn(buttonVariants({ variant: "outline" }))}>
            <action.icon className="h-4 w-4" aria-hidden />
            {action.label}
          </Link>
        ))}
      </OsHero>

      {hrSectionError ? (
        <Alert variant="warning">
          Some workforce data couldn&apos;t be loaded right now. This is usually temporary — refresh in a moment, and contact support if it
          keeps happening.
        </Alert>
      ) : null}

      {stats.length > 0 ? (
        <ul className={cn("grid grid-cols-2 gap-3", statCols)} aria-label="Today at a glance">
          {stats.map((card, n) => <li key={n} className={stats.length % 2 === 1 && n === stats.length - 1 ? "col-span-2 xl:col-span-1" : undefined}>{card}</li>)}
        </ul>
      ) : null}

      {opsDay ? <OperationsSummary summary={opsDay === "error" ? "error" : opsDaySummary(opsDay, today)} /> : null}

      {/* On a phone the order is what needs you first, then the clock; on a wide screen the left column is the week and the pipeline, the right one what waits on you. */}
      <div className={cn("flex flex-col gap-4 xl:items-start", hasLeft ? "xl:grid xl:grid-cols-[minmax(0,68fr)_minmax(0,32fr)]" : "xl:grid xl:grid-cols-1")}>
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
          {hasProjects ? <div className="order-5 min-w-0 xl:order-none"><DeliveryWeekCard week={portfolio === "error" || portfolio === null ? "error" : portfolio.delivery} /></div> : null}
          {hasProjects || salesToday.status !== "none" ? (
            <div className={cn("order-6 grid min-w-0 gap-4 xl:order-none", hasProjects && salesToday.status !== "none" && "md:grid-cols-2")}>
              {salesToday.status !== "none" ? <SalesPipeline result={salesToday} /> : null}
              {hasProjects ? <ProjectHealth portfolio={portfolio ?? "error"} /> : null}
            </div>
          ) : null}
        </div>
        <div className={cn("contents xl:min-w-0", hasLeft ? "xl:flex xl:flex-col xl:gap-4" : "xl:grid xl:grid-cols-3 xl:items-start xl:gap-4")}>
          <div className="order-1 min-w-0 xl:order-none"><DecisionsCard attention={attention} other={alsoOpen} waiting={waitingItems} /></div>
          {hasProjects && myWork !== null ? <div className="order-2 min-w-0 xl:order-none"><MyWorkToday work={myWork} /></div> : null}
          <div className="order-2 min-w-0 empty:hidden xl:order-none"><SiteAssignmentsCard rows={siteAssignments} /></div>
          {session.employeeId ? <div className="order-3 min-w-0 xl:order-none"><AttendanceClockCard employeeId={session.employeeId} /></div> : null}
          {showHrView && live !== null ? <div className="order-4 min-w-0 xl:order-none"><PeopleToday live={live} /></div> : null}
          {equipment !== null ? <div className="order-7 min-w-0 xl:order-none"><NextDispatch equipment={equipment} /></div> : null}
        </div>
      </div>

      {showHrView ? (
        <section aria-labelledby="hr-today" className="space-y-4 pt-2">
          <div>
            <h2 id="hr-today" className="font-heading text-xl font-semibold">
              People &amp; HR today
            </h2>
            <p className="text-sm text-muted-foreground">{CALENDAR_NOTE}</p>
          </div>
          <HrStatCards employees={totals.totalEmployees} present={totals.presentCount} onLeave={totals.leaveCount} leaveInReview={totals.leaveRequestsAwaitingDecision} />
          <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,68fr)_minmax(0,32fr)] xl:items-start">
            <div className="min-w-0 space-y-4">
              <AttendanceCompletionBar
                sentence={hrSectionError ? null : attendanceSentence(totals)}
                present={totals.presentCount}
                leave={totals.leaveCount}
                absent={totals.absentCount}
                notRecorded={totals.notRecordedScheduledCount}
                rest={totals.notRecordedRestCount}
                unknown={totals.notRecordedUnknownCount}
              />
              <CompanyComparisonTable
                snapshots={snapshots}
                canAssignByCompany={Object.fromEntries(overviewCompanies.map((c) => [c.id, canCreateEmployee(session.grants, c.id)]))}
              />
              <UpcomingSection holidays={upcomingHolidays} onLeaveToday={onLeaveToday} />
              <BirthdaysSection />
            </div>
            <div className="min-w-0 space-y-4">
              <TeamDistribution byCountry={snapshots.filter((snap) => !snap.error).map((snap) => ({ countryCode: snap.countryCode, employees: snap.totalEmployees }))} />
              <HrAttention items={hrAlertRows} />
            </div>
          </div>
        </section>
      ) : null}
    </OsScope>
  );
}

// Takes the dashboard's own resolved business-local hour (dashboardTimeZone
// above — Dubai for the cross-company CEO/HR view, the viewer's own
// company's country for an employee-only view), never the server's UTC
// clock or the visiting browser's device time, so the greeting always
// matches the clock the dashboard header displays right next to it.
export function greetingPeriod(hour: number): string {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
