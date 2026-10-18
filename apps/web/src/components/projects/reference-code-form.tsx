"use client";

import { setProjectReferenceCode } from "@/lib/actions/projectsCore";
import { Input } from "@/components/ui/input";
import { ActionForm, Field } from "@/components/sales/action-form";

/** Founders only (the database refuses anyone else): the 2 to 5 capital letters every project reference of a company starts with. */
export function ReferenceCodeForm({ companyId, current }: { companyId: string; current: string | null }) {
  return (
    <ActionForm action={setProjectReferenceCode} submitLabel={current ? "Change code" : "Set code"} className="space-y-3">
      <input type="hidden" name="companyId" value={companyId} />
      <Field label="Project reference code" htmlFor={`code-${companyId}`} hint={`2 to 5 capital letters. Projects are numbered ${current ?? "UAE"}-P-2026-0001, -0002 and so on. Changing it affects new projects only.`}>
        <Input id={`code-${companyId}`} name="code" defaultValue={current ?? ""} maxLength={5} minLength={2} required pattern="[A-Za-z]{2,5}" className="uppercase" />
      </Field>
    </ActionForm>
  );
}
