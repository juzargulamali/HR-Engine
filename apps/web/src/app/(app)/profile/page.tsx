import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
          <p>Employee records, contracts, and everything else land in Phase 1 — see docs/06-implementation-phases.md.</p>
        </CardContent>
      </Card>
    );
  }

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("first_name, last_name, job_title, hire_date, employment_status, company_id")
    .eq("id", session.employeeId)
    .single();

  const { data: company } = employee
    ? await supabase.from("companies").select("legal_name").eq("id", employee.company_id).single()
    : { data: null };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {employee?.first_name} {employee?.last_name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{employee?.employment_status}</Badge>
          {employee?.job_title ? <span className="text-muted-foreground">{employee.job_title}</span> : null}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
          <dt>Company</dt>
          <dd className="text-foreground">{company?.legal_name}</dd>
          <dt>Hire date</dt>
          <dd className="text-foreground">{employee?.hire_date}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
