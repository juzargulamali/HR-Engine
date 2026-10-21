"use client";

import { useState } from "react";
import { createInternalProject } from "@/lib/actions/projectsCore";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ReferenceCodeForm } from "@/components/projects/reference-code-form";
import { ActionForm, Field } from "@/components/sales/action-form";
import { MoreDetails, QuickAdd } from "@/components/workspace/quick-add";

export interface QuickProjectCompany {
  id: string;
  name: string;
  referenceCode: string | null;
  isFounder: boolean;
  people: { id: string; name: string }[];
}

/**
 * New internal project in one short form: a name, the company, and who is accountable. Dates, ongoing work and a brief are under
 * "Add more details". Client projects never start here: they start only when a Project Manager accepts a Sales handover.
 */
export function QuickNewProject({ companies }: { companies: QuickProjectCompany[] }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const company = companies.find((c) => c.id === companyId);
  return (
    <QuickAdd label="New internal project" title="New internal project" description="For work with no client or Sales opportunity. The person you name becomes its Project Manager.">
      {({ close }) => (
        <div className="space-y-4">
          {company && !company.referenceCode ? (
            <Alert variant="warning" role="status">
              <p className="font-medium">{company.name} has no project reference code yet.</p>
              <p className="mt-1">{company.isFounder ? "Set it below, then create the project." : "A founder must set it first (Projects, then Access)."}</p>
              {company.isFounder ? <div className="mt-3 max-w-sm"><ReferenceCodeForm companyId={company.id} current={null} /></div> : null}
            </Alert>
          ) : null}
          <ActionForm action={createInternalProject} submitLabel="Create project" pendingLabel="Creating…" onDone={close}>
            {companies.length > 1 ? (
              <Field label="Company" htmlFor="qp-company">
                <Select id="qp-company" name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            ) : <input type="hidden" name="companyId" value={companyId} />}
            <Field label="Project name" htmlFor="qp-name"><Input id="qp-name" name="name" required maxLength={200} placeholder="e.g. Showroom technology setup" autoFocus /></Field>
            <Field label="Accountable owner" htmlFor="qp-owner" hint="Someone with Projects access in this company.">
              <Select id="qp-owner" name="ownerId" defaultValue="" required key={companyId}>
                <option value="" disabled>Choose a person…</option>
                {(company?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <MoreDetails>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Start date" htmlFor="qp-start"><Input id="qp-start" name="startDate" type="date" /></Field>
                <Field label="End date" htmlFor="qp-end"><Input id="qp-end" name="endDate" type="date" /></Field>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="isOngoing" className="mt-0.5 h-4 w-4" />
                <span><span className="font-medium">Ongoing work</span><span className="block text-muted-foreground">Continuing work, not forced through installation and show stages.</span></span>
              </label>
              <Field label="Brief" htmlFor="qp-summary" hint="Visible to the project's members, not to people who only see the directory.">
                <Textarea id="qp-summary" name="summary" rows={3} placeholder="What this project is for and what done looks like." />
              </Field>
            </MoreDetails>
          </ActionForm>
        </div>
      )}
    </QuickAdd>
  );
}
