import Link from "next/link";
import { isSysAdmin, ROLE_LABELS } from "@enginious-hr/domain";
import type { CurrentSession } from "@/lib/auth/session";
import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function AppShell({ session, children }: { session: CurrentSession; children: React.ReactNode }) {
  const roleLabels = [...new Set(session.grants.map((g) => ROLE_LABELS[g.role]))];
  const showAdminLink = isSysAdmin(session.grants);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold">
              Enginious HR
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground">
                Dashboard
              </Link>
              <Link href="/profile" className="hover:text-foreground">
                My Profile
              </Link>
              <Link href="/employees" className="hover:text-foreground">
                Employees
              </Link>
              {showAdminLink ? (
                <Link href="/admin/companies" className="hover:text-foreground">
                  Admin
                </Link>
              ) : null}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium">{session.fullName ?? session.email}</div>
              <div className="flex justify-end gap-1">
                {roleLabels.length > 0 ? (
                  roleLabels.map((label) => (
                    <Badge key={label} variant="secondary" className="text-[10px]">
                      {label}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    No role assigned yet
                  </Badge>
                )}
              </div>
            </div>
            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
