"use client";

import { createContext, Suspense, useContext, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes, ChartColumn, ChevronDown, Clock, FolderKanban, Handshake, HelpCircle, Inbox, LayoutDashboard, Lock, Menu, Settings, Target, Truck, Users, FlaskConical, MoreHorizontal, LogIn, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { MODULES, ROLES, ROLE_IDS, type IconKey, type ModuleDef, type RoleId } from "../_lib/modules";
import { SAMPLE_NOW_LABEL } from "../_lib/data";
import { usePreview } from "./context";
import { Avatar } from "./ui";

const ICONS: Record<IconKey, React.ComponentType<{ className?: string }>> = {
  day: LayoutDashboard, sales: Handshake, projects: FolderKanban, people: Users, inventory: Boxes, vendors: Truck, performance: Target, approvals: Inbox, reports: ChartColumn, admin: Settings,
};

function isModuleActive(pathname: string, m: ModuleDef) {
  return pathname === m.href || pathname.startsWith(`${m.href}/`);
}
function isSubActive(pathname: string, m: ModuleDef, href: string) {
  if (href === m.href) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function StatusTag({ m }: { m: ModuleDef }) {
  if (m.status === "coming") return <span title="Coming soon" className="ml-auto flex-none rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground">Soon</span>;
  if (m.status === "existing") return <span title="Existing HR app" className="ml-auto flex-none rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground">Live</span>;
  return null;
}

function ModuleNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { roleDef, href } = usePreview();
  const mods = MODULES.filter((m) => roleDef.modules.includes(m.id));
  return (
    <nav aria-label="Modules" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-3">
      {mods.map((m) => {
        const active = isModuleActive(pathname, m);
        const Icon = ICONS[m.icon];
        return (
          <div key={m.id}>
            <Link
              href={href(m.href)} onClick={onNavigate} aria-current={active && !m.sub ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-accent/10 font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
              )}
            >
              {active ? <span className="absolute inset-y-1 left-0 w-[3px] rounded-full brand-gradient" aria-hidden /> : null}
              <Icon className="h-4 w-4 flex-none" aria-hidden />
              <span className="truncate">{m.label}</span>
              {m.sub ? <ChevronDown className={cn("ml-auto h-3.5 w-3.5 flex-none transition-transform", !active && "-rotate-90")} aria-hidden /> : <StatusTag m={m} />}
            </Link>
            {m.sub && active ? (
              <div className="ml-[1.35rem] mt-0.5 flex flex-col gap-px border-l border-border pl-2.5">
                {m.sub.map((s) => {
                  const subActive = isSubActive(pathname, m, s.href);
                  return (
                    <Link
                      key={s.href} href={href(s.href)} onClick={onNavigate} aria-current={subActive ? "page" : undefined}
                      className={cn(
                        "relative rounded-md px-2.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        subActive ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                      )}
                    >
                      {subActive ? <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent" aria-hidden /> : null}
                      {s.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  const { href } = usePreview();
  return (
    <Link href={href("/os-preview/my-day")} className="brand-grid-tight flex items-center gap-2.5 px-4 py-4">
      <Image src="/brand/enginious-icon.png" alt="" width={28} height={28} priority style={{ width: 28, height: 28 }} className="flex-none" />
      <div className="min-w-0 leading-tight">
        <div className="truncate font-heading text-sm font-bold tracking-tight">ENGINIOUS OS</div>
        <div className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Design preview</div>
      </div>
    </Link>
  );
}

/** Preview-only clock state, shared by the header chip and the mobile Clock tab. It never touches live attendance. */
const ClockCtx = createContext<{ clockedIn: boolean; setClockedIn: (v: boolean) => void; open: boolean; setOpen: (v: boolean) => void } | null>(null);
const useClock = () => useContext(ClockCtx)!;

function ClockProvider({ children }: { children: React.ReactNode }) {
  const [clockedIn, setClockedIn] = useState(true);
  const [open, setOpen] = useState(false);
  return <ClockCtx.Provider value={{ clockedIn, setClockedIn, open, setOpen }}>{children}</ClockCtx.Provider>;
}

/** Compact clock status: always one tap away, never hidden behind a menu. */
function ClockChip() {
  const { clockedIn, open, setOpen } = useClock();
  return (
    <button
      type="button" data-clock-trigger aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        clockedIn ? "border-success/50 bg-success/10 text-[hsl(var(--os-good))]" : "border-border bg-secondary/60 text-foreground",
      )}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden />
      <span>{clockedIn ? "Clocked in · 1h 28m" : "Not clocked in"}</span>
    </button>
  );
}

/** The preview clock. Rendered at the shell root (not inside the blurred header) so it is positioned against the screen. */
function ClockPanel() {
  const { clockedIn, setClockedIn, open, setOpen } = useClock();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!ref.current?.contains(el) && !el.closest("[data-clock-trigger]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-label="Attendance clock (preview)" className="fixed inset-x-3 bottom-20 z-[60] rounded-lg border border-border bg-card p-4 shadow-xl md:inset-x-auto md:bottom-auto md:right-6 md:top-[5.25rem] md:w-72">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Today · Mon 19 Oct · Dubai time</p>
      <p className="mt-1 font-heading text-lg font-semibold">{clockedIn ? "Clocked in since 8:02 am" : "Not clocked in"}</p>
      <p className="text-sm text-muted-foreground">{clockedIn ? "Office (sample). Worked 1h 28m so far." : "Clock in when you start work."}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant={clockedIn ? "outline" : "default"} className="flex-1" onClick={() => setClockedIn(!clockedIn)}>
          {clockedIn ? <LogOut className="h-3.5 w-3.5" aria-hidden /> : <LogIn className="h-3.5 w-3.5" aria-hidden />}
          {clockedIn ? "Clock out" : "Clock in"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </div>
      <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">Preview only. Nothing is recorded.</p>
    </div>
  );
}

function RoleSwitcher({ className }: { className?: string }) {
  const { role, href } = usePreview();
  const pathname = usePathname();
  const router = useRouter();
  return (
    <label className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <FlaskConical className="h-3.5 w-3.5 flex-none" aria-hidden />
      <span className="whitespace-nowrap">Preview as</span>
      <select
        value={role} onChange={(e) => router.push(href(pathname, { role: e.target.value as RoleId }))} aria-label="Preview as role (design preview only, no real sign-in)"
        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {ROLE_IDS.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
      </select>
    </label>
  );
}

function Crumbs() {
  const pathname = usePathname();
  const m = MODULES.find((x) => isModuleActive(pathname, x));
  if (!m) return <span className="text-sm text-muted-foreground">ENGINIOUS OS preview</span>;
  const sub = m.sub?.filter((s) => isSubActive(pathname, m, s.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <p className="truncate text-sm text-muted-foreground">
      <span className="text-foreground">{m.label}</span>
      {sub && sub.href !== m.href ? <> <span aria-hidden>/</span> {sub.label}</> : null}
    </p>
  );
}

/** Same five places for every role: My Day, Sales, Clock, People, More. An unavailable module stays in place and says so. */
function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const { roleDef, href } = usePreview();
  const clock = useClock();
  const day = MODULES.find((m) => m.id === "my-day")!;
  const sales = MODULES.find((m) => m.id === "sales")!;
  const people = MODULES.find((m) => m.id === "people")!;
  const base = "flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 px-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const link = (m: ModuleDef, label: string, locked = false) => {
    const Icon = ICONS[m.icon];
    const active = isModuleActive(pathname, m);
    return (
      <Link href={href(m.href)} aria-current={active ? "page" : undefined} className={cn(base, active ? "font-semibold text-[hsl(var(--os-link))]" : "font-medium text-muted-foreground", locked && "italic")}>
        <span className="relative"><Icon className="h-5 w-5" aria-hidden />{locked ? <Lock className="absolute -right-2 -top-1 h-3 w-3" aria-hidden /> : null}</span>
        <span>{label}</span>{locked ? <span className="sr-only"> (no access)</span> : null}
      </Link>
    );
  };
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
      {link(day, "My Day")}
      {link(sales, "Sales", !roleDef.salesAccess)}
      <button type="button" data-clock-trigger onClick={() => clock.setOpen(!clock.open)} aria-expanded={clock.open} aria-haspopup="dialog" className={cn(base, "font-medium", clock.clockedIn ? "text-[hsl(var(--os-good))]" : "text-muted-foreground")}>
        <Clock className="h-5 w-5" aria-hidden /><span>Clock</span>
      </button>
      {link(people, "People")}
      <button type="button" onClick={onMore} className={cn(base, "font-medium text-muted-foreground")}>
        <MoreHorizontal className="h-5 w-5" aria-hidden /><span>More</span>
      </button>
    </nav>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const { roleDef, href } = usePreview();
  return (
    <div className="os-root min-h-screen lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground">Skip to main content</a>

      <aside aria-label="ENGINIOUS OS modules" className="sticky top-0 hidden h-screen flex-col border-r border-border bg-card lg:flex">
        <Brand />
        <ModuleNav />
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={roleDef.personLabel.replace(/\(.*\)/, "").trim()} size={32} />
            <div className="min-w-0 text-xs leading-tight">
              <div className="truncate font-medium">{roleDef.personLabel}</div>
              <div className="truncate text-muted-foreground">Sample identity. No real sign-in.</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-40">
          <section aria-label="Design preview notice" className="border-b border-warning/50 bg-warning/20 px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground sm:text-xs">
            Design preview · Fictional sample data<span className="hidden md:inline"> · Nothing is saved or sent</span> · Sample time: {SAMPLE_NOW_LABEL}
          </section>
          <header className="flex items-center gap-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur sm:px-5">
            <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="flex h-9 w-9 flex-none items-center justify-center rounded-md hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden">
              <Menu className="h-5 w-5" aria-hidden />
            </button>
            <div className="min-w-0 flex-1"><Crumbs /></div>
            <RoleSwitcher className="hidden md:flex" />
            <Link href={href("/os-preview/guide")} className="hidden h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"><HelpCircle className="h-4 w-4" aria-hidden />Guide</Link>
            <ClockChip />
            <ThemeToggle />
          </header>
        </div>

        <main id="main-content" tabIndex={-1} className="flex-1 px-4 pb-28 pt-6 outline-none sm:px-6 lg:px-8 lg:pb-12">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="ENGINIOUS OS menu">
        <div className="flex h-full flex-col">
          <Brand />
          <div className="space-y-2 border-b border-border px-4 pb-3"><RoleSwitcher /><p className="text-xs text-muted-foreground">Sample time: {SAMPLE_NOW_LABEL}</p><Link href={href("/os-preview/guide")} onClick={() => setDrawer(false)} className="inline-flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--os-link))] hover:underline"><HelpCircle className="h-4 w-4" aria-hidden />Preview guide</Link></div>
          <ModuleNav onNavigate={() => setDrawer(false)} />
        </div>
      </Drawer>
      <ClockPanel />
      <MobileBottomNav onMore={() => setDrawer(true)} />
    </div>
  );
}

export function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading preview…</div>}>
      <ClockProvider><ShellInner>{children}</ShellInner></ClockProvider>
    </Suspense>
  );
}
