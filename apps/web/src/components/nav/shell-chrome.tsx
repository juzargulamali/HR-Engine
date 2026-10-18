"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellRing, Briefcase, Clock, LayoutDashboard, Menu, MoreHorizontal, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { ClockChip } from "./clock-chip";
import { UserMenu } from "./user-menu";
import { BrandMark, ModuleNavigation } from "./sidebar-nav";
import { activeModuleId, breadcrumbFor, navGroupsFromModules, type NavModuleData } from "./nav-groups";

interface ShellChromeProps {
  modules: NavModuleData[];
  showAlertsLink: boolean;
  /** Only people linked to an employee record have a clock. */
  isEmployee: boolean;
  /** Start of the employee's open attendance session, or null. */
  clockOpenSince: string | null;
  serverNowIso: string;
  fullName: string;
  email: string | null;
  roleLabels: string[];
  signOutSlot: React.ReactNode;
}

function Crumbs({ modules }: { modules: NavModuleData[] }) {
  const pathname = usePathname();
  const { module, page } = breadcrumbFor(pathname, modules);
  if (!module) return <span className="truncate text-sm text-muted-foreground">ENGINIOUS OS</span>;
  return (
    <p className="truncate text-sm text-muted-foreground">
      <span className={page ? "" : "font-medium text-foreground"}>{module}</span>
      {page ? (
        <>
          {" "}
          <span aria-hidden>/</span> <span className="font-medium text-foreground">{page}</span>
        </>
      ) : null}
    </p>
  );
}

/**
 * Header (breadcrumb, search, attendance status, alerts, theme), the mobile menu drawer and the mobile bottom bar. The
 * bottom bar offers only places this person can actually go: Sales only with a Sales grant, Clock only for an employee.
 */
export function ShellChrome({ modules, showAlertsLink, isEmployee, clockOpenSince, serverNowIso, fullName, email, roleLabels, signOutSlot }: ShellChromeProps) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  const groups = navGroupsFromModules(modules);
  const active = activeModuleId(pathname, modules);
  const hasSales = modules.some((m) => m.id === "sales");
  const onClockPage = pathname === "/attendance-clock" || pathname.startsWith("/attendance-clock/");

  const tab = "flex min-h-[3.5rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-center text-[13px] leading-tight";
  const tabClass = (on: boolean) => cn(tab, on ? "font-semibold text-accent" : "font-medium text-muted-foreground hover:text-foreground");

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-border bg-chrome px-3 py-2 sm:px-5 lg:gap-4 lg:px-6">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setDrawer(true)}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-md border border-input hover:bg-secondary lg:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 lg:flex-none lg:basis-52">
          <Crumbs modules={modules} />
        </div>
        <div className="flex min-w-0 flex-none lg:flex-1">
          <CommandPalette groups={groups} />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {isEmployee ? <ClockChip openSince={clockOpenSince} serverNowIso={serverNowIso} /> : null}
          {showAlertsLink ? (
            <Link href="/alerts" aria-label="Alerts" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden h-9 w-9 px-0 lg:inline-flex")}>
              <BellRing className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="ENGINIOUS OS menu">
        <div className="flex h-full flex-col">
          <BrandMark />
          <ModuleNavigation modules={modules} onNavigate={() => setDrawer(false)} />
          <div className="border-t border-border p-2">
            <UserMenu fullName={fullName} email={email} roleLabels={roleLabels} signOutSlot={signOutSlot} side="top" />
          </div>
        </div>
      </Drawer>

      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-chrome pb-[env(safe-area-inset-bottom)] lg:hidden">
        <Link href="/" aria-current={active === "my-day" ? "page" : undefined} className={tabClass(active === "my-day")}>
          <LayoutDashboard className="h-5 w-5" aria-hidden />
          <span>My Day</span>
        </Link>
        {hasSales ? (
          <Link href="/sales" aria-current={active === "sales" ? "page" : undefined} className={tabClass(active === "sales")}>
            <Briefcase className="h-5 w-5" aria-hidden />
            <span>Sales</span>
          </Link>
        ) : null}
        {isEmployee ? (
          <Link href="/attendance-clock" aria-current={onClockPage ? "page" : undefined} className={tabClass(onClockPage)}>
            <Clock className="h-5 w-5" aria-hidden />
            <span>{clockOpenSince ? "Clocked in" : "Clock"}</span>
          </Link>
        ) : null}
        <Link href="/employees" aria-current={active === "people" && !onClockPage ? "page" : undefined} className={tabClass(active === "people" && !onClockPage)}>
          <Users className="h-5 w-5" aria-hidden />
          <span>People</span>
        </Link>
        <button type="button" onClick={() => setDrawer(true)} className={tabClass(false)}>
          <MoreHorizontal className="h-5 w-5" aria-hidden />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
