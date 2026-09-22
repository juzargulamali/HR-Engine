"use client";

import { useActionState } from "react";
import { updateEmployee, updateOwnContactInfo } from "@/lib/actions/employees";
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
}

export function EditEmployeeForm({
  employee,
  managers,
  canEditCore,
  isSelf,
}: {
  employee: EmployeeCore;
  managers: { id: string; first_name: string; last_name: string }[];
  canEditCore: boolean;
  isSelf: boolean;
}) {
  const [coreState, coreAction, corePending] = useActionState(updateEmployee, initialState);
  const [contactState, contactAction, contactPending] = useActionState(updateOwnContactInfo, initialState);

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Manager</dt>
        <dd>{managers.find((m) => m.id === employee.manager_id)?.first_name ?? "—"}</dd>
        <dt className="text-muted-foreground">Personal email</dt>
        <dd>{employee.personal_email ?? "—"}</dd>
        <dt className="text-muted-foreground">Phone</dt>
        <dd>{employee.phone ?? "—"}</dd>
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
          </div>
          {coreState.error ? <Alert variant="destructive">{coreState.error}</Alert> : null}
          <Button type="submit" size="sm" disabled={corePending}>
            {corePending ? "Saving…" : "Save profile"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
