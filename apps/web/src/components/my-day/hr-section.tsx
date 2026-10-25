import Link from "next/link";
import { ArrowRight, Building2, CalendarClock, CalendarDays, ClipboardCheck, Users, UserCheck } from "lucide-react";
import type { ActionItem } from "@/app/(app)/action-centre";
import { OsStatCard } from "@/components/os/stat-card";
import { OsDonut } from "@/components/os/donut";
import { cardLink, MyDayCard } from "./card-shell";

/** The four recorded-attendance figures of People & HR today. Recorded present is the daily record, not live clock status (that is People today above). */
export function HrStatCards({ employees, present, onLeave, leaveInReview }: { employees: number; present: number; onLeave: number; leaveInReview: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="People and HR figures">
      <li><OsStatCard href="/employees" label="Employees" value={employees} icon={Users} edge="blue" hint="Across the companies you can see" /></li>
      <li><OsStatCard href="/attendance" label="Recorded present" value={present} icon={UserCheck} edge="cyan" hint="Daily record, not live status" /></li>
      <li><OsStatCard href="/leave" label="On leave" value={onLeave} icon={CalendarDays} edge="amber" hint="Leave recorded for today" /></li>
      <li><OsStatCard href="/approvals" label="Leave requests in review" value={leaveInReview} icon={ClipboardCheck} edge="blue" hint="Company-wide, any approver" /></li>
    </ul>
  );
}

const COUNTRY_NAMES: Record<string, string> = { AE: "UAE", SA: "Saudi Arabia", PL: "Poland", GB: "United Kingdom", US: "United States", IN: "India", EG: "Egypt", QA: "Qatar", KW: "Kuwait", BH: "Bahrain", OM: "Oman" };
const RING = ["hsl(var(--fill-teal))", "hsl(var(--fill-blue))", "hsl(var(--fill-amber))", "hsl(var(--fill-green))", "hsl(var(--muted-foreground))"];

/** Employees by country of their company, from the same company snapshots as the table below. */
export function TeamDistribution({ byCountry }: { byCountry: { countryCode: string; employees: number }[] }) {
  const merged = [...byCountry.reduce((m, c) => m.set(c.countryCode, (m.get(c.countryCode) ?? 0) + c.employees), new Map<string, number>())];
  merged.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return (
    <MyDayCard title="Team distribution" label="Team distribution by country">
      {merged.length === 0 ? <p className="text-sm text-muted-foreground">No employees on record yet.</p> : (
        <OsDonut caption="Employees by country" size={140} segments={merged.map(([code, value], i) => ({ key: code, label: COUNTRY_NAMES[code] ?? code, value, color: RING[i % RING.length]! }))} center={<span className="px-2 text-[13px] leading-tight text-muted-foreground">by company country</span>} />
      )}
    </MyDayCard>
  );
}

/** HR alerts that need a person: contracts, probation, documents. Leave requests are in the figures above and are not repeated here. */
export function HrAttention({ items }: { items: readonly ActionItem[] }) {
  return (
    <MyDayCard title="HR attention" actions={<Link href="/alerts" className={cardLink}>All alerts</Link>}>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">No contract, probation or document alerts right now.</p> : (
        <ul className="-mx-2 divide-y divide-border/60">
          {items.map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-[hsl(var(--primary)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <i.icon className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 break-words">{i.label}</span>
                <span className="os-badge" data-tone="amber">{i.count}</span>
                <ArrowRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MyDayCard>
  );
}

const QUICK = [
  { href: "/employees", label: "Employees directory", icon: Building2 },
  { href: "/attendance", label: "Attendance register", icon: CalendarClock },
  { href: "/leave", label: "Leave requests", icon: ClipboardCheck },
];
export function QuickActions() {
  return (
    <MyDayCard title="Quick actions">
      <ul className="-mx-2 divide-y divide-border/60">
        {QUICK.map((q) => (
          <li key={q.href}>
            <Link href={q.href} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-[hsl(var(--primary)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <q.icon className="h-4 w-4 flex-none text-accent" aria-hidden /><span className="flex-1">{q.label}</span><ArrowRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </MyDayCard>
  );
}
