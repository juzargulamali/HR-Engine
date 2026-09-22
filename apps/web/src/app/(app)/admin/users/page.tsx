import { ROLE_LABELS } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { revokeRole } from "@/lib/actions/users";
import { InviteUserForm } from "./invite-user-form";
import { AssignRoleForm } from "./assign-role-form";
import { ResendInviteButton } from "./resend-invite-button";

export default async function UsersPage() {
  const supabase = await createClient();
  const [{ data: profiles }, { data: roleGrants }, { data: companies }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name").order("email"),
    supabase
      .from("user_roles")
      .select("id, user_id, role, company_id, revoked_at")
      .is("revoked_at", null)
      .order("granted_at"),
    supabase.from("companies").select("id, legal_name").order("legal_name"),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.legal_name]));
  const grantsByUser = new Map<string, typeof roleGrants>();
  for (const grant of roleGrants ?? []) {
    grantsByUser.set(grant.user_id, [...(grantsByUser.get(grant.user_id) ?? []), grant]);
  }

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
                  <TableCell className="font-medium">{p.full_name ?? "—"}</TableCell>
                  <TableCell>{p.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {(grantsByUser.get(p.id) ?? []).map((grant) => (
                        <span key={grant.id} className="inline-flex items-center gap-1">
                          <Badge variant="secondary">
                            {ROLE_LABELS[grant.role]}
                            {grant.company_id ? ` · ${companyName.get(grant.company_id) ?? ""}` : ""}
                          </Badge>
                          <form action={revokeRole.bind(null, grant.id)}>
                            <Button type="submit" variant="ghost" size="sm" className="h-5 px-1 text-[10px]">
                              revoke
                            </Button>
                          </form>
                        </span>
                      ))}
                      {(grantsByUser.get(p.id) ?? []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">No role yet</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ResendInviteButton email={p.email} />
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
