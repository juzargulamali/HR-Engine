import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ProfilePage() {
  const session = await getCurrentSession();
  if (!session) return null;

  if (!session.employeeId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            You&apos;re signed in as <span className="text-foreground">{session.email}</span>, but HR
            hasn&apos;t created your employee record yet.
          </p>
          <p>Once HR creates it, this page will take you straight to it.</p>
        </CardContent>
      </Card>
    );
  }

  // "My Profile" is just a stable link to the employee's own record —
  // /employees/[id] already renders everything they're allowed to see
  // (self-service contact edit, contracts, compensation, identity
  // documents if visible to them) and there's no reason to duplicate that
  // rendering here.
  redirect(`/employees/${session.employeeId}`);
}
