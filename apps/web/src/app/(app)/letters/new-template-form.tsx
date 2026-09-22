"use client";

import { useActionState } from "react";
import { createLetterTemplate } from "@/lib/actions/letters";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

const TEMPLATE_TYPES = [
  { value: "salary_certificate", label: "Salary certificate" },
  { value: "experience_letter", label: "Experience letter" },
  { value: "noc", label: "No-objection certificate" },
  { value: "offer_letter", label: "Offer letter" },
];

export function NewTemplateForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState(createLetterTemplate, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="space-y-1.5">
        <Label htmlFor="templateType">Type</Label>
        <Select id="templateType" name="templateType" defaultValue="">
          {TEMPLATE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required placeholder="e.g. Salary certificate — English" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bodyTemplate">Body</Label>
        <Textarea
          id="bodyTemplate"
          name="bodyTemplate"
          required
          placeholder="Use {{employee.full_name}}, {{employee.job_title}}, {{employee.hire_date}}, {{company.legal_name}}, {{date.today}}"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="requiresApproval">Requires CEO sign-off</Label>
        <Select id="requiresApproval" name="requiresApproval" defaultValue="true">
          <option value="true">Yes</option>
          <option value="false">No — issue immediately</option>
        </Select>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save template"}
      </Button>
    </form>
  );
}
