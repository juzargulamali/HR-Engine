"use client";

import { useActionState } from "react";
import { linkEmployeeToUser, updateEmployee, updateOwnContactInfo } from "@/lib/actions/employees";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

interface EmployeeCore {
  id: string;
  job_title: string | null;
  employment_status: "active" | "on_leave" | "suspended" | "terminated";
  manager_id: string | null;
  personal_email: string | null;
  phone: string | null;
  date_of_birth: string | null;
}

export function EditEmployeeForm({
  employee,
  linkedEmail,
  managers,
  canEditCore,
  isSelf,
}: {
  employee: EmployeeCore;
  linkedEmail: string | null;
  managers: { id: string; first_name: string; last_name: string }[];
  canEditCore: boolean;
  isSelf: boolean;
}) {
  const [coreState, coreAction, corePending] = useActionState(updateEmployee, initialState);
  const [contactState, contactAction, contactPending] = useActionState(updateOwnContactInfo, initialState);
  const [linkState, linkAction, linkPending] = useActionState(linkEmployeeToUser, initialState);

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Manager</dt>
        <dd>{managers.find((m) => m.id === employee.manager_id)?.first_name ?? "—"}</dd>
        <dt className="text-muted-foreground">Personal email</dt>
        <dd>{employee.personal_email ?? "—"}</dd>
        <dt className="text-muted-foreground">Phone</dt>
        <dd>{employee.phone ?? "—"}</dd>
        <dt className="text-muted-foreground">Date of birth</dt>
        <dd>{employee.date_of_birth ?? "—"}</dd>
      </dl>

      {isSelf ? (
        <form action={contactAction} className="space-y-3 border-t border-border pt-4">
          <input type="hidden" name="employeeId" value={employee.id} />
          <p className="text-sm font-medium">Update your contact info</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="personalEmail">Personal email</Label>
              <Input id="personalEmail" name="personalEmail" type="email" defaultValue={employee.personal_email ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={employee.phone ?? ""} />
            </div>
          </div>
          {contactState.error ? <Alert variant="destructive">{contactState.error}</Alert> : null}
          <Button type="submit" size="sm" disabled={contactPending}>
            {contactPending ? "Saving…" : "Save contact info"}
          </Button>
        </form>
      ) : null}

      {canEditCore ? (
        <form action={coreAction} className="space-y-3 border-t border-border pt-4">
          <input type="hidden" name="employeeId" value={employee.id} />
          <p className="text-sm font-medium">Edit profile (HR Admin)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="jobTitle">Job title</Label>
              <Input id="jobTitle" name="jobTitle" defaultValue={employee.job_title ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="employmentStatus">Status</Label>
              <Select id="employmentStatus" name="employmentStatus" defaultValue={employee.employment_status}>
                <option value="active">Active</option>
                <option value="on_leave">On leave</option>
                <option value="suspended">Suspended</option>
                <option value="terminated">Terminated</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="managerId">Manager</Label>
              <Select id="managerId" name="managerId" defaultValue={employee.manager_id ?? ""}>
                <option value="">None</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.first_name} {m.last_name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dateOfBirth">Date of birth</Label>
              <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={employee.date_of_birth ?? ""} />
            </div>
          </div>
          {coreState.error ? <Alert variant="destructive">{coreState.error}</Alert> : null}
          <Button type="submit" size="sm" disabled={corePending}>
            {corePending ? "Saving…" : "Save profile"}
          </Button>
        </form>
      ) : null}

      {canEditCore ? (
        <form action={linkAction} className="space-y-3 border-t border-border pt-4">
          <input type="hidden" name="employeeId" value={employee.id} />
          <p className="text-sm font-medium">Linked login</p>
          <p className="text-sm text-muted-foreground">
            {linkedEmail
              ? "This record is linked to a login, so its owner sees their own profile, leave, and approvals."
              : "Not linked to a login yet — this person can't sign in as themselves until you link one."}
          </p>
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="email">Account email</Label>
            <Input id="email" name="email" type="email" placeholder="name@enginious.ae" defaultValue={linkedEmail ?? ""} />
            <p className="text-xs text-muted-foreground">
              Must already be invited from Admin → Users. Clear this field and save to unlink.
            </p>
          </div>
          {linkState.error ? <Alert variant="destructive">{linkState.error}</Alert> : null}
          <Button type="submit" size="sm" variant="outline" disabled={linkPending}>
            {linkPending ? "Saving…" : linkedEmail ? "Update link" : "Link account"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
