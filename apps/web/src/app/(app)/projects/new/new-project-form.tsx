"use client";

import { useState } from "react";
import { createInternalProject } from "@/lib/actions/projectsCore";
import { PRIORITIES, PRIORITY_LABELS } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ReferenceCodeForm } from "@/components/projects/reference-code-form";
import { ActionForm, Field } from "@/components/sales/action-form";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";

export interface NewProjectCompany {
  id: string;
  name: string;
  referenceCode: string | null;
  isFounder: boolean;
  people: { id: string; name: string }[];
}

export function NewProjectForm({ companies }: { companies: NewProjectCompany[] }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const company = companies.find((c) => c.id === companyId);
  return (
    <div className="space-y-5">
      {company && !company.referenceCode ? (
        <Alert variant="warning" role="status">
          <p className="font-medium">{company.name} has no project reference code yet.</p>
          <p className="mt-1">{company.isFounder ? "Set it below, then create the project." : "A founder must set it first (Projects, then Access)."}</p>
          {company.isFounder ? <div className="mt-3 max-w-sm"><ReferenceCodeForm companyId={company.id} current={null} /></div> : null}
        </Alert>
      ) : null}
      <ActionForm action={createInternalProject} submitLabel="Create project" pendingLabel="Creating…">
        <div className="grid gap-4 sm:grid-cols-2">
          {companies.length > 1 ? (
            <Field label="Company" htmlFor="np-company">
              <Select id="np-company" name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          ) : <input type="hidden" name="companyId" value={companyId} />}
          <Field label="Project name" htmlFor="np-name"><Input id="np-name" name="name" required maxLength={200} placeholder="e.g. Showroom technology setup" /></Field>
          <Field label="Accountable owner (Project Manager)" htmlFor="np-owner" hint="Someone with Projects access in this company. They become the project's PM.">
            <Select id="np-owner" name="ownerId" defaultValue="" required key={companyId}>
              <option value="" disabled>Choose a person…</option>
              {(company?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="np-priority">
            <Select id="np-priority" name="priority" defaultValue="normal">{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</Select>
          </Field>
          <Field label="Start date (optional)" htmlFor="np-start"><Input id="np-start" name="startDate" type="date" /></Field>
          <Field label="End date (optional)" htmlFor="np-end"><Input id="np-end" name="endDate" type="date" /></Field>
          <Field label="Time zone for site work" htmlFor="np-tz" hint="Site bookings are written in this zone.">
            <Select id="np-tz" name="siteTimezone" defaultValue="Asia/Dubai">{COMMON_TIME_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}</Select>
          </Field>
          <label className="flex items-start gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="isOngoing" className="mt-0.5 h-4 w-4" />
            <span><span className="font-medium">Ongoing work</span><span className="block text-muted-foreground">Continuing work, not forced through installation and show stages.</span></span>
          </label>
        </div>
        <Field label="Short summary (optional)" htmlFor="np-summary" hint="Visible to the project's members, not to people who only see the directory.">
          <Textarea id="np-summary" name="summary" rows={3} placeholder="What this project is for and what done looks like." />
        </Field>
      </ActionForm>
    </div>
  );
}
