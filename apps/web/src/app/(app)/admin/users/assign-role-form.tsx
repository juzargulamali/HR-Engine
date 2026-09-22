"use client";

import { useActionState } from "react";
import { ROLES, ROLE_LABELS } from "@enginious-hr/domain";
import { assignRole } from "@/lib/actions/users";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AssignRoleForm({
  users,
  companies,
}: {
  users: { id: string; email: string; full_name: string | null }[];
  companies: { id: string; legal_name: string }[];
}) {
  const [state, formAction, pending] = useActionState(assignRole, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="userId">User</Label>
        <Select id="userId" name="userId" defaultValue="" required>
          <option value="" disabled>
            Select…
          </option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name ?? u.email}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="role">Role</Label>
        <Select id="role" name="role" defaultValue="" required>
          <option value="" disabled>
            Select…
          </option>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="companyId">Company (leave blank for every company)</Label>
        <Select id="companyId" name="companyId" defaultValue="">
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.legal_name}
            </option>
          ))}
        </Select>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Granting…" : "Grant role"}
      </Button>
    </form>
  );
}
