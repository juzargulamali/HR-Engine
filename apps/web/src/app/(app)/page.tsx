import Link from "next/link";
import { canViewCompanyOverview, canViewHrAlerts, isSysAdmin } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { CompanyOverviewSection } from "./company-overview-section";

function Tile({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex flex-col justify-between gap-4 overflow-hidden rounded-lg border border-border bg-card p-5",
        "transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[0_0_0_1px_hsl(var(--brand-glow)/0.4),0_14px_32px_-16px_hsl(var(--brand-glow)/0.45)]",
      )}
    >
      <div>
        <h3 className="font-heading text-base font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
        Open
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="transition-transform group-hover:translate-x-0.5" aria-hidden>
          <path d="M2 6H10M10 6L6.5 2.5M10 6L6.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span
        className="pointer-events-none absolute right-3 top-3 h-2 w-2 rounded-full bg-accent opacity-0 shadow-[0_0_10px_2px_hsl(var(--brand-glow)/0.7)] transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    </Link>
  );
}

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) return null; // guarded by the layout above

  const firstName = session.fullName ? session.fullName.split(" ")[0] : null;

  const supabase = await createClient();

  const showAlerts = canViewHrAlerts(session.grants);
  let alertsCount = 0;
  if (showAlerts) {
    const horizonDate = new Date();
    horizonDate.setDate(horizonDate.getDate() + 30);
    const horizon = horizonDate.toISOString().slice(0, 10);
    const [{ count: contractCount }, { count: docCount }, { count: identityCount }] = await Promise.all([
      supabase
        .from("employment_contracts")
        .select("id", { count: "exact", head: true })
        .eq("is_current", true)
        .or(`end_date.lte.${horizon},probation_end_date.lte.${horizon}`),
      supabase.from("employee_documents").select("id", { count: "exact", head: true }).in("status", ["expiring_soon", "expired"]),
      supabase
        .from("identity_documents")
        .select("id", { count: "exact", head: true })
        .not("expiry_date", "is", null)
        .lte("expiry_date", horizon),
    ]);
    alertsCount = (contractCount ?? 0) + (docCount ?? 0) + (identityCount ?? 0);
  }

  const { data: companies } = await supabase.from("companies").select("id, legal_name, country_code");
  const overviewCompanies = (companies ?? []).filter((c) => canViewCompanyOverview(session.grants, c.id));

  return (
    <div className="space-y-8">
      <div className="brand-corner relative overflow-hidden rounded-xl border border-border bg-card p-6 sm:p-8">
        <div className="brand-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Driven by innovation</span>
          <h1 className="mt-2 font-heading text-2xl font-bold sm:text-3xl">
            Welcome{firstName ? <>, <span className="brand-gradient-text">{firstName}</span></> : null}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Employee records, leave, reimbursements, letters, payroll export, and policy management —
            everything below is scoped to what your role can see and do.
          </p>
        </div>
      </div>

      {overviewCompanies.length > 0 ? (
        <div className="space-y-6">
          {overviewCompanies.map((c) => (
            <CompanyOverviewSection key={c.id} companyId={c.id} companyName={c.legal_name} countryCode={c.country_code} />
          ))}
        </div>
      ) : null}

      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Quick links</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Tile
            href="/profile"
            title="My Profile"
            description={session.employeeId ? "View your employee record." : "No employee record yet — ask HR Admin to add you."}
          />
          <Tile href="/leave" title="Leave" description="Request time off and track your balance." />
          <Tile href="/reimbursements" title="Reimbursements" description="Submit a claim or check its approval status." />
          <Tile href="/approvals" title="Approvals" description="Decide what's waiting on you." />
          <Tile href="/employees" title="Employees" description="Look up people and their records." />
          {showAlerts ? (
            <Tile
              href="/alerts"
              title="Alerts"
              description={
                alertsCount > 0
                  ? `${alertsCount} item${alertsCount === 1 ? "" : "s"} need attention.`
                  : "Nothing needs attention right now."
              }
            />
          ) : null}
          {isSysAdmin(session.grants) ? (
            <>
              <Tile href="/admin/companies" title="Companies" description="Manage companies and countries." />
              <Tile href="/admin/users" title="Users & Roles" description="Invite people and grant access." />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
