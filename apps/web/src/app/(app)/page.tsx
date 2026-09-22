import Link from "next/link";
import { isSysAdmin } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) return null; // guarded by the layout above

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome{session.fullName ? `, ${session.fullName.split(" ")[0]}` : ""}</h1>
        <p className="text-muted-foreground">
          Phase 0 of Enginious HR — accounts, roles, and companies. Leave, payroll, and everything
          else land in later phases (see docs/06-implementation-phases.md).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>My Profile</CardTitle>
            <CardDescription>
              {session.employeeId
                ? "View your employee record."
                : "No employee record yet — HR sets this up in Phase 1."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/profile" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Open
            </Link>
          </CardContent>
        </Card>

        {isSysAdmin(session.grants) ? (
          <Card>
            <CardHeader>
              <CardTitle>System Administration</CardTitle>
              <CardDescription>Manage companies, countries, and who holds which role.</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Link href="/admin/companies" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Companies
              </Link>
              <Link href="/admin/users" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Users &amp; roles
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
