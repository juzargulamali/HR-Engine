"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRequest } from "@/lib/actions/inventoryPlanning";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";
import { MoreDetails, QuickAdd } from "@/components/workspace/quick-add";
import { Field, InvForm } from "./inv-form";
import { EmployeePicker } from "./pickers";

export interface QuickAddScope {
  /** Companies the person may request in, with whether they may ask for equipment for an employee there. */
  companies: { id: string; name: string; canEmployee: boolean }[];
  projects: { id: string; name: string; reference: string; companyId: string }[];
  locations: { id: string; name: string; companyId: string }[];
  /** Set on a project's Equipment page: the request is for that project only. */
  fixedProjectId?: string;
}

/**
 * The one Add of the Requests list (and of a project's Equipment page): a short form that creates a DRAFT. Nothing is reserved or
 * sent to the warehouse until the request is submitted. For a project the project picker offers only projects the person can manage;
 * for an employee the picker finds active employees by name or number and shows nothing else about them.
 */
export function RequestsQuickAdd({ scope, label = "New request" }: { scope: QuickAddScope; label?: string }) {
  const fixed = scope.fixedProjectId ? scope.projects.find((p) => p.id === scope.fixedProjectId) : undefined;
  return (
    <QuickAdd label={label} title="New equipment request" description="A draft: nothing is reserved until it is submitted to the warehouse." closeOnParam={fixed ? "request" : "open"}>
      {({ close }) => <Form scope={scope} close={close} />}
    </QuickAdd>
  );
}

function Form({ scope, close }: { scope: QuickAddScope; close: () => void }) {
  const router = useRouter();
  const fixed = scope.fixedProjectId ? scope.projects.find((p) => p.id === scope.fixedProjectId) : undefined;
  const canProject = scope.projects.length > 0;
  const employeeCompanies = scope.companies.filter((c) => c.canEmployee);
  const canEmployee = !fixed && employeeCompanies.length > 0;
  const [kind, setKind] = useState<"project" | "employee">(canProject || fixed ? "project" : "employee");
  const [projectId, setProjectId] = useState(fixed?.id ?? "");
  const [employeeCompany, setEmployeeCompany] = useState(employeeCompanies[0]?.id ?? "");
  const project = scope.projects.find((p) => p.id === projectId);
  const companyId = kind === "project" ? (project?.companyId ?? "") : employeeCompany;
  const locations = scope.locations.filter((l) => !companyId || l.companyId === companyId);
  const base = "/inventory/requests";
  return (
    <InvForm
      action={createRequest}
      submitLabel="Create draft"
      pendingLabel="Creating…"
      onDone={(s) => {
        close();
        if (s.id) router.push(fixed ? `/projects/${fixed.id}/equipment?request=${s.id}` : `${base}?open=${s.id}`);
      }}
    >
      <input type="hidden" name="kind" value={kind} />
      {canProject && canEmployee && !fixed ? (
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-1 text-sm font-medium">Who is it for</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="kindChoice" checked={kind === "project"} onChange={() => setKind("project")} /> A project</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="kindChoice" checked={kind === "employee"} onChange={() => setKind("employee")} /> An employee</label>
        </fieldset>
      ) : null}
      {kind === "project" ? (
        fixed ? (
          <>
            <input type="hidden" name="projectId" value={fixed.id} />
            <p className="text-sm">For project <span className="font-medium">{fixed.name}</span> ({fixed.reference})</p>
          </>
        ) : (
          <Field label="Project" htmlFor="rq-project" hint="Projects you manage.">
            <Select id="rq-project" name="projectId" value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
              <option value="">Choose a project</option>
              {scope.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.reference})</option>)}
            </Select>
          </Field>
        )
      ) : (
        <>
          {employeeCompanies.length > 1 ? (
            <Field label="Company" htmlFor="rq-company">
              <Select id="rq-company" value={employeeCompany} onChange={(e) => setEmployeeCompany(e.target.value)}>
                {employeeCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          ) : null}
          <EmployeePicker key={employeeCompany} companyId={employeeCompany} />
        </>
      )}
      <Field label="What is it for" htmlFor="rq-title" hint={kind === "employee" ? "Optional: it is called “Equipment for” the employee if you leave it empty." : "A few words, for example “LED tunnel, mall activation”."}>
        <Input id="rq-title" name="title" maxLength={200} />
      </Field>
      <Field label={kind === "employee" ? "Collected from" : "Pickup location (optional)"} htmlFor="rq-loc">
        <Select id="rq-loc" name="locationId" required={kind === "employee"} defaultValue="">
          <option value="">{kind === "employee" ? "Choose a warehouse" : "Not decided yet"}</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={kind === "employee" ? "Needed from" : "Leaves the warehouse"} htmlFor="rq-dispatch"><Input id="rq-dispatch" name="dispatch" type="datetime-local" /></Field>
        <Field label={kind === "employee" ? "Expected back (optional)" : "Due back"} htmlFor="rq-return"><Input id="rq-return" name="return_due" type="datetime-local" /></Field>
      </div>
      <p className="text-sm text-muted-foreground">Local time at the place it happens. The other phases (preparation, install, show, dismantle, inspection) are on the request itself.</p>
      <MoreDetails>
        <Field label="Destination" htmlFor="rq-dest"><Input id="rq-dest" name="destination" maxLength={200} /></Field>
        <Field label="Time zone of the dates" htmlFor="rq-tz" hint="Leave empty to use the project's site time zone, or the pickup location's.">
          <Input id="rq-tz" name="timezone" list="rq-tz-list" maxLength={64} />
          <datalist id="rq-tz-list">{COMMON_TIME_ZONES.map((z) => <option key={z} value={z} />)}</datalist>
        </Field>
        <Field label="Note" htmlFor="rq-note"><Textarea id="rq-note" name="note" rows={2} maxLength={500} /></Field>
      </MoreDetails>
    </InvForm>
  );
}
