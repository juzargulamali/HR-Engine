"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createEmployee } from "@/lib/actions/employees";
import type { ActionState } from "@/lib/actions/companies";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function NewEmployeeForm({
  companies,
  countries,
}: {
  companies: { id: string; legal_name: string; country_code: string }[];
  countries: { code: string; name: string }[];
}) {
  // On success, createEmployee redirects itself (Server Actions can call
  // redirect() directly) — no client-side navigation needed here, and none
  // of the useActionState-returns-stale-state pitfalls that come with
  // wrapping formAction in another function to react to its result.
  const [state, formAction, pending] = useActionState(createEmployee, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const selectedCompany = companies.find((c) => c.id === companyId);

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="companyId">Company</Label>
          <Select id="companyId" name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legal_name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="countryCode">Country</Label>
          {/* A disabled <select> never submits its value in FormData, so the
              actual value travels in a hidden input — this one is purely
              for display. */}
          <Select id="countryCode" value={selectedCompany?.country_code ?? ""} disabled required>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
          <input type="hidden" name="countryCode" value={selectedCompany?.country_code ?? ""} />
          <p className="text-xs text-muted-foreground">Set by the company&apos;s registered country.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" required />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="employeeNumber">Employee number</Label>
          <Input id="employeeNumber" name="employeeNumber" placeholder="E010" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="jobTitle">Job title</Label>
          <Input id="jobTitle" name="jobTitle" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="hireDate">Hire date</Label>
        <Input id="hireDate" name="hireDate" type="date" required />
      </div>

      <fieldset className="space-y-4 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Initial contract</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="contractType">Contract type</Label>
            <Select id="contractType" name="contractType" defaultValue="probation" required>
              <option value="probation">Probation</option>
              <option value="permanent">Permanent</option>
              <option value="fixed_term">Fixed term</option>
              <option value="contractor">Contractor</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="noticePeriodDays">Notice period (days)</Label>
            <Input id="noticePeriodDays" name="noticePeriodDays" type="number" defaultValue={30} min={0} required />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contractStartDate">Contract start date</Label>
          <Input id="contractStartDate" name="contractStartDate" type="date" required />
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Opening balances (optional)</legend>
        <p className="text-xs text-muted-foreground">
          For a mid-year hire or a transfer who already has leave or comp days earned elsewhere — leave blank for a fresh start
          with nothing carried over.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="openingAnnualLeaveDays">Annual leave balance (days)</Label>
            <Input id="openingAnnualLeaveDays" name="openingAnnualLeaveDays" type="number" min={0} step={0.5} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="openingCompDays">Comp days earned to date</Label>
            <Input id="openingCompDays" name="openingCompDays" type="number" min={0} step={0.5} placeholder="0" />
          </div>
        </div>
      </fieldset>

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create employee"}
        </Button>
        <Link href="/employees" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
