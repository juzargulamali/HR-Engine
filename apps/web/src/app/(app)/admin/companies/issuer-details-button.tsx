"use client";

import { useState } from "react";
import { updateCompanyIssuerDetails, uploadCompanyLogo } from "@/lib/actions/companies";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface IssuerDetails { id: string; legal_name: string; trn: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; logo_path: string | null }

/** The company's own profile as quotations use it: legal name, TRN, address, contact details and logo. */
export function IssuerDetailsButton({ company }: { company: IssuerDetails }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Issuer details<span className="sr-only"> for {company.legal_name}</span></Button>
      <Modal open={open} onClose={() => setOpen(false)} size="wide" title="Issuer details" description="Printed on every estimate this company finalises: legal name, address (line breaks are kept) and TRN at the top, and the phone, email and website in the footer of every page. A finalised estimate keeps what it was finalised with. The legal name is required to finalise; anything left empty is simply not printed.">
        <div className="space-y-6">
          <ActionForm action={updateCompanyIssuerDetails} submitLabel="Save details" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
            <input type="hidden" name="companyId" value={company.id} />
            <Field label="Legal name" htmlFor={`iss-name-${company.id}`}><Input id={`iss-name-${company.id}`} name="legalName" required maxLength={200} defaultValue={company.legal_name} /></Field>
            <Field label="Tax registration number (TRN)" htmlFor={`iss-trn-${company.id}`} hint="Kept exactly as typed, including leading zeros."><Input id={`iss-trn-${company.id}`} name="trn" maxLength={40} defaultValue={company.trn ?? ""} /></Field>
            <Field label="Address" htmlFor={`iss-addr-${company.id}`} hint="One line per row; the line breaks are kept on the estimate."><Textarea id={`iss-addr-${company.id}`} name="address" rows={3} maxLength={500} defaultValue={company.address ?? ""} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Phone" htmlFor={`iss-phone-${company.id}`}><Input id={`iss-phone-${company.id}`} name="phone" type="tel" maxLength={60} defaultValue={company.phone ?? ""} /></Field>
              <Field label="Email" htmlFor={`iss-email-${company.id}`}><Input id={`iss-email-${company.id}`} name="email" type="email" maxLength={200} defaultValue={company.email ?? ""} /></Field>
              <Field label="Website" htmlFor={`iss-web-${company.id}`} hint="Becomes a link in the footer when it is a web address, with or without https://."><Input id={`iss-web-${company.id}`} name="website" maxLength={300} defaultValue={company.website ?? ""} /></Field>
            </div>
          </ActionForm>
          <ActionForm action={uploadCompanyLogo} submitLabel={company.logo_path ? "Replace logo" : "Upload logo"} variant="outline">
            <input type="hidden" name="companyId" value={company.id} />
            <Field label="Logo (PNG, JPEG or WebP, under 900 KB)" htmlFor={`iss-logo-${company.id}`} hint={company.logo_path ? "A logo is on file. Uploading a new one is used for estimates finalised from now on." : "No logo on file yet."}>
              <Input id={`iss-logo-${company.id}`} name="logo" type="file" accept="image/png,image/jpeg,image/webp" required />
            </Field>
          </ActionForm>
        </div>
      </Modal>
    </>
  );
}
