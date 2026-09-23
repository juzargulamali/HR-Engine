import Link from "next/link";
import { CalendarDays, ClipboardCheck, ReceiptText, UserPlus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { canCreateEmployee, canViewCompanyOverview, canViewHrAlerts, isBirthdayToday } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BirthdaysSection } from "./birthdays-section";
import { getCompanySnapshot } from "./dashboard-data";
import { WorkforceSnapshot } from "./workforce-snapshot";
import { CompanyComparisonTable } from "./company-comparison-table";
import { ActionCentre } from "./action-centre";
import { AttendanceCompletionBar } from "./attendance-completion-bar";
import { UpcomingSection } from "./upcoming-section";

const HORIZON_DAYS = 30;

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) return null; // guarded by the layout above

  const firstName = session.fullName ? session.fullName.split(" ")[0] : null;
  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();

  const showHrView = canViewHrAlerts(session.grants);

  const { data: companies } = await supabase.from("companies").select("id, legal_name, country_code");
  const allCompanies = companies ?? [];
  const overviewCompanies = allCompanies.filter((c) => canViewCompanyOverview(session.grants, c.id));
  const canAddEmployee = allCompanies.some((c) => canCreateEmployee(session.grants, c.id));

  // Always computed, for anyone — approving isn't an HR/CEO-only capability
  // (a line manager or Finance approver needs this too), unlike the
  // company-wide sections below which stay gated to canViewHrAlerts.
  const { count: myPendingApprovalsCount } = await supabase
    .from("approvals")
    .select("id", { count: "exact", head: true })
    .eq("approver_id", session.userId)
    .eq("decision", "pending");
  const myPendingApprovals = myPendingApprovalsCount ?? 0;

  let isMyBirthdayToday = false;
  if (session.employeeId) {
    const { data: me } = await supabase.from("employees").select("date_of_birth").eq("id", session.employeeId).maybeSingle();
    isMyBirthdayToday = !!me?.date_of_birth && isBirthdayToday(me.date_of_birth, today);
  }

  let snapshots: Awaited<ReturnType<typeof getCompanySnapshot>>[] = [];
  let contractsEndingCount = 0;
  let probationDueCount = 0;
  let docsExpiringCount = 0;
  let identityExpiringCount = 0;
  let upcomingHolidays: { name: string; holiday_date: string; countryCode: string }[] = [];
  let onLeaveToday: { id: string; name: string; companyName: string }[] = [];

  if (showHrView) {
    const horizonDate = new Date();
    horizonDate.setDate(horizonDate.getDate() + HORIZON_DAYS);
    const horizon = horizonDate.toISOString().slice(0, 10);

    const [snapshotResults, { count: contractCount }, { count: probationCount }, { count: docCount }, { count: identityCount }] = await Promise.all([
      Promise.all(overviewCompanies.map((c) => getCompanySnapshot(supabase, c, today))),
      supabase.from("employment_contracts").select("id", { count: "exact", head: true }).eq("is_current", true).lte("end_date", horizon),
      supabase.from("employment_contracts").select("id", { count: "exact", head: true }).eq("is_current", true).lte("probation_end_date", horizon),
      supabase.from("employee_documents").select("id", { count: "exact", head: true }).in("status", ["expiring_soon", "expired"]),
      supabase.from("identity_documents").select("id", { count: "exact", head: true }).not("expiry_date", "is", null).lte("expiry_date", horizon),
    ]);
    snapshots = snapshotResults;
    contractsEndingCount = contractCount ?? 0;
    probationDueCount = probationCount ?? 0;
    docsExpiringCount = docCount ?? 0;
    identityExpiringCount = identityCount ?? 0;

    const countryCodes = [...new Set(overviewCompanies.map((c) => c.country_code))];
    const { data: holidays } =
      countryCodes.length > 0
        ? await supabase
            .from("public_holidays")
            .select("name, holiday_date, country_code")
            .in("country_code", countryCodes)
            .gte("holiday_date", today)
            .lte("holiday_date", horizon)
            .order("holiday_date", { ascending: true })
            .limit(6)
        : { data: [] as { name: string; holiday_date: string; country_code: string }[] };
    upcomingHolidays = (holidays ?? []).map((h) => ({ name: h.name, holiday_date: h.holiday_date, countryCode: h.country_code }));

    const employeeNameById = new Map<string, { name: string; companyName: string }>();
    for (const s of snapshots) {
      for (const e of s.employees) {
        employeeNameById.set(e.id, { name: `${e.first_name} ${e.last_name}`, companyName: s.companyName });
      }
    }
    const allEmployeeIds = [...employeeNameById.keys()];
    const { data: leaveToday } =
      allEmployeeIds.length > 0
        ? await supabase.from("attendance_records").select("employee_id").eq("work_date", today).eq("status", "leave").in("employee_id", allEmployeeIds)
        : { data: [] as { employee_id: string }[] };
    onLeaveToday = (leaveToday ?? [])
      .map((r) => {
        const info = employeeNameById.get(r.employee_id);
        return info ? { id: r.employee_id, name: info.name, companyName: info.companyName } : null;
      })
      .filter((v): v is { id: string; name: string; companyName: string } => v !== null);
  }

  const totals = snapshots.reduce(
    (acc, s) => ({
      totalEmployees: acc.totalEmployees + s.totalEmployees,
      presentCount: acc.presentCount + s.presentCount,
      leaveCount: acc.leaveCount + s.leaveCount,
      absentCount: acc.absentCount + s.absentCount,
      notRecordedCount: acc.notRecordedCount + s.notRecordedCount,
      pendingLeaveApprovals: acc.pendingLeaveApprovals + s.pendingLeaveApprovals,
    }),
    { totalEmployees: 0, presentCount: 0, leaveCount: 0, absentCount: 0, notRecordedCount: 0, pendingLeaveApprovals: 0 },
  );

  // Real, permission-scoped, and role-prioritized — never a decorative
  // default. "Approving" outranks everything else since it's blocking
  // someone else's work; HR's own creation flow comes next; a plain
  // employee's most common next step is requesting time off.
  const primaryAction: { href: string; label: string; icon: LucideIcon } =
    myPendingApprovals > 0
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

  const recordedToday = totals.totalEmployees - totals.notRecordedCount;
  const totalActionItems = myPendingApprovals + contractsEndingCount + probationDueCount + docsExpiringCount + identityExpiringCount;

  const summarySentence = showHrView
    ? `${recordedToday} of ${totals.totalEmployees} employee${totals.totalEmployees === 1 ? "" : "s"} have recorded attendance today.` +
      (totalActionItems > 0 ? ` ${totalActionItems} item${totalActionItems === 1 ? "" : "s"} need attention.` : " Nothing urgent is waiting.")
    : myPendingApprovals > 0
      ? `${myPendingApprovals} approval${myPendingApprovals === 1 ? "" : "s"} ${myPendingApprovals === 1 ? "is" : "are"} waiting on your decision.`
      : "Nothing is waiting on you right now.";

  return (
    <div className="space-y-8">
      {isMyBirthdayToday ? (
        <Alert variant="success">
          <span className="font-heading font-semibold">Enginious wishes you a very Happy Birthday{firstName ? `, ${firstName}` : ""}!</span>
        </Alert>
      ) : null}

      <div className="brand-corner relative overflow-hidden rounded-xl border border-border bg-card p-6 sm:p-8">
        <div className="brand-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Driven by innovation</span>
            <h1 className="mt-2 font-heading text-2xl font-bold sm:text-3xl">
              Good {greetingPeriod()}{firstName ? <>, <span className="brand-gradient-text">{firstName}</span></> : null}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">{summarySentence}</p>
          </div>
          <div className="flex flex-wrap gap-2">
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
          </div>
        </div>
      </div>

      {showHrView ? (
        <>
          <WorkforceSnapshot
            totalEmployees={totals.totalEmployees}
            presentCount={totals.presentCount}
            leaveCount={totals.leaveCount}
            notRecordedCount={totals.notRecordedCount}
            pendingLeaveApprovals={totals.pendingLeaveApprovals}
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <CompanyComparisonTable
                snapshots={snapshots}
                canAssignByCompany={Object.fromEntries(overviewCompanies.map((c) => [c.id, canCreateEmployee(session.grants, c.id)]))}
              />
            </div>
            <ActionCentre
              myPendingApprovals={myPendingApprovals}
              contractsEndingCount={contractsEndingCount}
              probationDueCount={probationDueCount}
              docsExpiringCount={docsExpiringCount}
              identityExpiringCount={identityExpiringCount}
            />
          </div>

          <AttendanceCompletionBar present={totals.presentCount} leave={totals.leaveCount} absent={totals.absentCount} notRecorded={totals.notRecordedCount} />

          <UpcomingSection holidays={upcomingHolidays} onLeaveToday={onLeaveToday} />

          <BirthdaysSection />
        </>
      ) : (
        <ActionCentre myPendingApprovals={myPendingApprovals} />
      )}
    </div>
  );
}

function greetingPeriod(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
