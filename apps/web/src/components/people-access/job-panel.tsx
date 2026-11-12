"use client";

import { useState } from "react";
import Link from "next/link";
import { addDepartment, updateJobDetails } from "@/lib/actions/peopleAccess";
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
  /** False when the departments could not be read. Then the list is not offered and the department is left as it is. */
  departmentsLoaded?: boolean;
  managers: { id: string; name: string }[];
}

/**
 * Job title, department and reporting line of the existing employee record: no copy of any personnel data is kept here, and the save writes the same
 * employee row under the same rule (HR Admin of the company). Status, dates, pay and documents stay on the employee record.
 *
 * The same person can add a department for the employee's company here (there is no other screen for it). A new department is offered in the list and
 * selected at once; it is assigned only when the job details are saved. "This company has no departments yet" and "the departments could not be
 * loaded" are two different messages, and after a failed load the department is neither listed nor changed by a save.
 */
export function JobPanel(p: JobPanelProps) {
  const loaded = p.departmentsLoaded !== false;
  // Departments added on this screen since it was loaded: offered at once, before the refreshed list arrives.
  const [added, setAdded] = useState<{ id: string; name: string }[]>([]);
  const [department, setDepartment] = useState(p.departmentId ?? "");
  const departments = [...p.departments, ...added.filter((a) => !p.departments.some((d) => d.id === a.id))].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Company</dt><dd>{p.companyName}</dd>
        <dt className="text-muted-foreground">Job title</dt><dd>{p.jobTitle ?? "—"}</dd>
        <dt className="text-muted-foreground">Department</dt><dd>{p.departmentName ?? (p.departmentId && !loaded ? "Could not be loaded" : "—")}</dd>
        <dt className="text-muted-foreground">Reporting manager</dt><dd>{p.managerName ?? "—"}</dd>
      </dl>
      {p.canEdit ? (
        <ActionForm action={updateJobDetails} submitLabel="Save job details" className="space-y-3 border-t border-border pt-4">
          <input type="hidden" name="employeeId" value={p.employeeId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Job title" htmlFor="pa-job-title"><Input id="pa-job-title" name="jobTitle" defaultValue={p.jobTitle ?? ""} maxLength={120} /></Field>
            {loaded ? (
              <Field label="Department" htmlFor="pa-job-dept" hint={departments.length === 0 ? `No departments have been created for ${p.companyName} yet. Add the first one below.` : undefined}>
                <Select id="pa-job-dept" name="departmentId" value={department} onChange={(e) => setDepartment(e.target.value)}>
                  <option value="">None</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </Field>
            ) : (
              <div className="space-y-1 text-sm" data-testid="pa-departments-failed">
                <p className="font-medium">Department</p>
                {/* The current department is posted back unchanged, so saving the other fields cannot clear it. */}
                <input type="hidden" name="departmentId" value={p.departmentId ?? ""} />
                <p role="status" className="text-destructive">Departments could not be loaded. Reload the page to try again. Saving now leaves the department as it is.</p>
              </div>
            )}
            <Field label="Reporting manager" htmlFor="pa-job-mgr">
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
      {p.canEdit && loaded ? (
        <ActionForm action={addDepartment} submitLabel="Add department" resetOnSuccess className="space-y-2 border-t border-border pt-4"
          onDone={(r) => { const d = r as { id?: string; name?: string }; if (d.id && d.name) { setAdded((x) => [...x, { id: d.id!, name: d.name! }]); setDepartment(d.id); } }}>
          <input type="hidden" name="employeeId" value={p.employeeId} />
          <Field label={`Add a department for ${p.companyName}`} htmlFor="pa-new-dept" hint="It is added to this company's list and selected above. Press Save job details to give it to this person.">
            <Input id="pa-new-dept" name="name" maxLength={80} required placeholder="For example, Engineering" />
          </Field>
        </ActionForm>
      ) : null}
      {p.canEdit ? <p className="text-sm"><Link href={`/employees/${p.employeeId}`} className="underline underline-offset-2">Open {p.personName}&apos;s full employee record</Link></p> : null}
    </div>
  );
}
