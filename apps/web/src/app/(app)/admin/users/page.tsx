import { ROLE_LABELS } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { InviteUserForm } from "./invite-user-form";
import { AssignRoleForm } from "./assign-role-form";
import { ResendInviteButton } from "./resend-invite-button";
import { DeleteUserButton } from "./delete-user-button";
import { RevokeRoleButton } from "./revoke-role-button";

export default async function UsersPage() {
  const session = await getCurrentSession();
  const supabase = await createClient();
  const [{ data: profiles }, { data: roleGrants }, { data: companies }, { data: employees }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name").order("email"),
    supabase
      .from("user_roles")
      .select("id, user_id, role, company_id, revoked_at")
      .is("revoked_at", null)
      .order("granted_at"),
    supabase.from("companies").select("id, legal_name").order("legal_name"),
    // profiles.full_name is only ever set from invite metadata (the
    // handle_new_auth_user trigger) — an account created directly in
    // Supabase (the original bootstrap admin) never gets one, even once
    // they've since linked and named an employee record of their own. Fall
    // back to that linked employee's name rather than showing "—" for
    // someone who very much does have a name on file.
    supabase.from("employees").select("user_id, first_name, last_name").not("user_id", "is", null),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.legal_name]));
  const grantsByUser = new Map<string, typeof roleGrants>();
  for (const grant of roleGrants ?? []) {
    grantsByUser.set(grant.user_id, [...(grantsByUser.get(grant.user_id) ?? []), grant]);
  }
  const employeeNameByUser = new Map((employees ?? []).map((e) => [e.user_id as string, `${e.first_name} ${e.last_name}`]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users &amp; roles</h1>
        <p className="text-muted-foreground">Provision logins and grant the roles from the permission matrix.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Invite a user</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteUserForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Grant a role</CardTitle>
          </CardHeader>
          <CardContent>
            <AssignRoleForm users={profiles ?? []} companies={companies ?? []} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All users</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(profiles ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.full_name ?? employeeNameByUser.get(p.id) ?? "—"}</TableCell>
                  <TableCell>{p.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {(grantsByUser.get(p.id) ?? []).map((grant) => (
                        <span key={grant.id} className="inline-flex items-center gap-1">
                          <Badge variant="secondary">
                            {ROLE_LABELS[grant.role]}
                            {grant.company_id ? ` · ${companyName.get(grant.company_id) ?? ""}` : ""}
                          </Badge>
                          <RevokeRoleButton roleGrantId={grant.id} />
                        </span>
                      ))}
                      {(grantsByUser.get(p.id) ?? []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">No role yet</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <ResendInviteButton email={p.email} />
                      {p.id !== session?.userId ? <DeleteUserButton userId={p.id} email={p.email} /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
