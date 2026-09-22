"use client";

import { useActionState } from "react";
import { createCompany, type ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function CreateCompanyForm({ countries }: { countries: { code: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createCompany, initialState);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="legalName">Legal name</Label>
        <Input id="legalName" name="legalName" placeholder="Enginious LLC FZ" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="countryCode">Country</Label>
        <Select id="countryCode" name="countryCode" defaultValue="" required>
          <option value="" disabled>
            Select…
          </option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="defaultCurrency">Currency</Label>
        <Input id="defaultCurrency" name="defaultCurrency" placeholder="AED" maxLength={3} required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add company"}
      </Button>
      {state.error ? (
        <Alert variant="destructive" className="sm:col-span-4">
          {state.error}
        </Alert>
      ) : null}
    </form>
  );
}
