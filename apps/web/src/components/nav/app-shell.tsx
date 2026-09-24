import { BellRing } from "lucide-react";
import Link from "next/link";
import { canViewHrAlerts, ROLE_LABELS } from "@enginious-hr/domain";
import type { CurrentSession } from "@/lib/auth/session";
import { signOut } from "@/lib/actions/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";
import { SidebarNav } from "./sidebar-nav";
import { CommandPalette } from "./command-palette";
import { buildNavGroups } from "./nav-groups";

export function AppShell({ session, children }: { session: CurrentSession; children: React.ReactNode }) {
  const roleLabels = [...new Set(session.grants.map((g) => ROLE_LABELS[g.role]))];
  const showAlertsLink = canViewHrAlerts(session.grants);
  const groups = buildNavGroups(session.grants);

  const signOutSlot = (
    <form action={signOut}>
      <Button variant="ghost" size="sm" type="submit" className="justify-start text-muted-foreground hover:text-destructive">
        Sign out
      </Button>
    </form>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Skip to main content
      </a>

      <SidebarNav groups={groups} fullName={session.fullName ?? session.email ?? "Signed in"} email={session.email} roleLabels={roleLabels} signOutSlot={signOutSlot} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 hidden items-center gap-4 border-b border-border bg-card/95 px-6 py-2.5 backdrop-blur md:flex">
          <CommandPalette groups={groups} />
          <div className="ml-auto flex items-center gap-1.5">
            {showAlertsLink ? (
              <Link href="/alerts" aria-label="Alerts" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9 w-9 px-0")}>
                <BellRing className="h-4 w-4" aria-hidden />
              </Link>
            ) : null}
            <ThemeToggle />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-8 outline-none md:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
