"use client";

import Link from "next/link";
import { startTransition, useActionState, useMemo, useState } from "react";
import { createEmployee, type CreateEmployeeState } from "@/lib/actions/employeeOnboarding";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { InfoHint } from "@/components/ui/info-hint";
import { SearchCombobox } from "@/components/sales/combobox";

const initialState: CreateEmployeeState = { error: null };

export interface OnboardingCompany { id: string; legal_name: string; country_code: string | null; default_currency: string | null }
export interface OnboardingDepartment { id: string; company_id: string; name: string }
export interface OnboardingManager { id: string; company_id: string; first_name: string; last_name: string; employee_number: string }

const validCurrency = (c: string | null | undefined) => /^[A-Za-z]{3}$/.test(c ?? "");

/**
 * Add an employee, company first. Nothing else is asked until a company is chosen; then the company's own country and currency are used (and shown), and only a
 * missing default is asked for here, in place. Identity and job details are entered once; contract, pay and opening balances are optional and can be finished from the
 * employee's profile, which shows exactly what remains. The form's id is made once and posted as the employee's id, so a repeated tap or a retry opens the same record.
 */
export function NewEmployeeForm({
  companies,
  countries,
  departments = [],
  managers = [],
}: {
  companies: OnboardingCompany[];
  countries: { code: string; name: string }[];
  departments?: OnboardingDepartment[];
  managers?: OnboardingManager[];
}) {
  const [state, formAction, pending] = useActionState(createEmployee, initialState);
  const [employeeId] = useState(() => crypto.randomUUID());
  const [companyId, setCompanyId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [basicSalary, setBasicSalary] = useState("");
  const [otherAllowance, setOtherAllowance] = useState("");
  const company = companies.find((c) => c.id === companyId) ?? null;
  const countryName = (code: string | null) => countries.find((c) => c.code === code)?.name ?? code ?? "";
  const countryMissing = !!company && !(company.country_code && countries.some((c) => c.code === company.country_code));
  const currencyMissing = !!company && !validCurrency(company.default_currency);
  const totalSalary = (Number(basicSalary) || 0) + (Number(otherAllowance) || 0);
  const companyDepartments = useMemo(() => departments.filter((d) => d.company_id === companyId), [departments, companyId]);
  const managerOptions = useMemo(
    () => managers.filter((m) => m.company_id === companyId).map((m) => ({ id: m.id, label: `${m.first_name} ${m.last_name}`.trim(), detail: m.employee_number })),
    [managers, companyId],
  );
  const name = `${firstName} ${lastName}`.trim();

  return (
    // Submitted through a transition instead of the form's `action` prop: React resets an uncontrolled form after an action finishes, which would empty the
    // fields the person has just typed when the action answers with an error (a number already in use, for example).
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="space-y-5"
    >
      <input type="hidden" name="employeeId" value={employeeId} />

      <div className="space-y-1.5">
        <Label htmlFor="companyId">Company</Label>
        <Select id="companyId" name="companyId" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setManagerId(""); }} required className="h-11">
          <option value="">Choose a company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.legal_name}
            </option>
          ))}
        </Select>
        {!company ? <p className="text-sm text-muted-foreground">Choose the company first. Its country and currency are used for this employee.</p> : null}
      </div>

      {company ? (
        <>
          {/* Stays in view while the form scrolls, so the company and the person are always visible on a phone. */}
          <div className="sticky top-0 z-10 -mx-1 rounded-md border border-border bg-background/95 px-3 py-2 text-sm shadow-sm backdrop-blur" data-testid="onboarding-summary" aria-live="polite">
            <span className="font-medium">{name || "New employee"}</span> · {company.legal_name}
            {!countryMissing ? <> · {countryName(company.country_code)}</> : null}
            {!currencyMissing ? <> · {company.default_currency?.toUpperCase()}</> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={countryMissing ? "countryCode" : "countryDisplay"}>Country</Label>
              {countryMissing ? (
                <>
                  <Select id="countryCode" name="countryCode" defaultValue="" required className="h-11">
                    <option value="">Choose the employee&apos;s country</option>
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-sm text-warning" data-testid="country-missing">This company has no country set. Choose it here; it applies to this employee only.</p>
                </>
              ) : (
                <>
                  <Input id="countryDisplay" value={countryName(company.country_code)} readOnly disabled className="h-11" />
                  <p className="text-sm text-muted-foreground">The company&apos;s country.</p>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currencySuggested">Company currency</Label>
              <Input id="currencySuggested" value={currencyMissing ? "Not set" : (company.default_currency ?? "").toUpperCase()} readOnly disabled className="h-11" />
              <p className="text-sm text-muted-foreground" data-testid="currency-note">
                {currencyMissing ? "This company has no default currency. Enter one under Contract and pay if you add pay now." : "The company's currency. It is the default for pay, and you can change it there."}
              </p>
            </div>
          </div>

          <fieldset className="space-y-4 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-medium">Identity and job</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name *</Label>
                <Input id="firstName" name="firstName" required className="h-11" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name *</Label>
                <Input id="lastName" name="lastName" required className="h-11" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="employeeNumber">Employee number *</Label>
                <Input id="employeeNumber" name="employeeNumber" placeholder="E010" required className="h-11" />
                {state.existingEmployeeId ? (
                  <p className="text-sm text-destructive" data-testid="number-in-use">
                    That number is already used in this company.{" "}
                    <Link href={`/employees/${state.existingEmployeeId}`} className="underline">
                      Open that employee
                    </Link>
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="jobTitle">Job title</Label>
                <Input id="jobTitle" name="jobTitle" className="h-11" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="hireDate">Hire date *</Label>
                <Input id="hireDate" name="hireDate" type="date" required className="h-11" />
              </div>
              <div className="space-y-1.5">
                <span className="flex items-center gap-1">
                  <Label htmlFor="dateOfBirth">Date of birth</Label>
                  <InfoHint label="Date of birth">Optional. It is needed for their birthday to show on the dashboard.</InfoHint>
                </span>
                <Input id="dateOfBirth" name="dateOfBirth" type="date" className="h-11" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="departmentId">Department</Label>
                <Select id="departmentId" name="departmentId" defaultValue="" className="h-11">
                  <option value="">None</option>
                  {companyDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                {companyDepartments.length === 0 ? <p className="text-sm text-muted-foreground">This company has no departments yet. Add one in People &amp; Access, then choose it on the profile.</p> : null}
              </div>
              <SearchCombobox id="managerPicker" name="managerId" label="Manager" options={managerOptions} value={managerId} onChange={setManagerId} placeholder="Search by name or number" emptyText={() => "No one in this company matches."} />
            </div>
          </fieldset>

          <details className="rounded-md border border-border p-4">
            <summary className="cursor-pointer text-sm font-medium">Contract and pay now (optional)</summary>
            <div className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">Anything left out stays on the employee&apos;s setup list.</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="contractType">Contract type</Label>
                  <Select id="contractType" name="contractType" defaultValue="" className="h-11">
                    <option value="">Add later</option>
                    <option value="probation">Probation</option>
                    <option value="permanent">Permanent</option>
                    <option value="fixed_term">Fixed term</option>
                    <option value="contractor">Contractor</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contractStartDate">Contract start</Label>
                  <Input id="contractStartDate" name="contractStartDate" type="date" className="h-11" />
                  <p className="text-sm text-muted-foreground">Empty means the hire date.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="noticePeriodDays">Notice period (days)</Label>
                  <Input id="noticePeriodDays" name="noticePeriodDays" type="number" defaultValue={30} min={0} className="h-11" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="basicSalary">Basic salary</Label>
                  <Input id="basicSalary" name="basicSalary" type="number" min={0} step={0.01} value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="otherAllowance">Others</Label>
                  <Input id="otherAllowance" name="otherAllowance" type="number" min={0} step={0.01} placeholder="0" value={otherAllowance} onChange={(e) => setOtherAllowance(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salaryCurrency">Currency{basicSalary ? " *" : ""}</Label>
                  <Input id="salaryCurrency" name="salaryCurrency" maxLength={3} defaultValue={validCurrency(company.default_currency) ? (company.default_currency ?? "").toUpperCase() : ""} key={company.id} required={Boolean(basicSalary)} className="h-11" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Total: <span className="font-medium text-foreground">{totalSalary.toFixed(2)}</span>. Pay takes effect from the hire date.
              </p>
            </div>
          </details>

          <details className="rounded-md border border-border p-4">
            <summary className="cursor-pointer text-sm font-medium">Opening balances (optional)</summary>
            <div className="mt-4 space-y-4">
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                Only for someone who already has leave or comp days from elsewhere.
                <InfoHint label="Opening balances">For a mid-year hire or a transfer. Leave blank for a fresh start with nothing carried over. Opening balances are recorded once; they are never repeated.</InfoHint>
              </span>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="openingAnnualLeaveDays">Annual leave balance (days)</Label>
                  <Input id="openingAnnualLeaveDays" name="openingAnnualLeaveDays" type="number" min={0} step={0.5} placeholder="0" className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="openingCompDays">Comp days earned to date</Label>
                  <Input id="openingCompDays" name="openingCompDays" type="number" min={0} step={0.5} placeholder="0" className="h-11" />
                </div>
              </div>
            </div>
          </details>

          {state.error ? (
            <Alert variant="destructive" data-testid="create-error">
              {state.error}
            </Alert>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Creates the employee and opens their profile. Contract, pay, documents and the account can be finished there.</p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={pending || !companyId} className="min-h-11">
                {pending ? "Creating…" : "Create employee"}
              </Button>
              <Link href="/employees" className={buttonVariants({ variant: "outline" }) + " min-h-11"}>
                Cancel
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </form>
  );
}
