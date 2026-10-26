"use client";

import Link from "next/link";
import { updateJobDetails } from "@/lib/actions/peopleAccess";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ActionForm, Field } from "@/components/sales/action-form";

export interface JobPanelProps {
  employeeId: string;
  personName: string;
  companyName: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  managerId: string | null;
  managerName: string | null;
  /** HR Admin of the employee's company: the same people who may edit the employee record. */
  canEdit: boolean;
  departments: { id: string; name: string }[];
  managers: { id: string; name: string }[];
}

/**
 * Job title, department and reporting line of the existing employee record: no copy of any personnel data is kept here, and the save writes the same
 * employee row under the same rule (HR Admin of the company). Status, dates, pay and documents stay on the employee record.
 */
export function JobPanel(p: JobPanelProps) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Company</dt><dd>{p.companyName}</dd>
        <dt className="text-muted-foreground">Job title</dt><dd>{p.jobTitle ?? "—"}</dd>
        <dt className="text-muted-foreground">Department</dt><dd>{p.departmentName ?? "—"}</dd>
        <dt className="text-muted-foreground">Reports to</dt><dd>{p.managerName ?? "—"}</dd>
      </dl>
      {p.canEdit ? (
        <ActionForm action={updateJobDetails} submitLabel="Save job details" className="space-y-3 border-t border-border pt-4">
          <input type="hidden" name="employeeId" value={p.employeeId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Job title" htmlFor="pa-job-title"><Input id="pa-job-title" name="jobTitle" defaultValue={p.jobTitle ?? ""} maxLength={120} /></Field>
            <Field label="Department" htmlFor="pa-job-dept">
              <Select id="pa-job-dept" name="departmentId" defaultValue={p.departmentId ?? ""}>
                <option value="">None</option>
                {p.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Reports to" htmlFor="pa-job-mgr">
              <Select id="pa-job-mgr" name="managerId" defaultValue={p.managerId ?? ""}>
                <option value="">No one</option>
                {p.managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">This changes the employee record itself and is recorded in its history. Promotions and pay changes still go through the employee&apos;s career events.</p>
        </ActionForm>
      ) : (
        <p className="text-sm text-muted-foreground">Only an HR Admin of {p.companyName} can change these details.</p>
      )}
      {p.canEdit ? <p className="text-sm"><Link href={`/employees/${p.employeeId}`} className="underline underline-offset-2">Open {p.personName}&apos;s full employee record</Link></p> : null}
    </div>
  );
}
