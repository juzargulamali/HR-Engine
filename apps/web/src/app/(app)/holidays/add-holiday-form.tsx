"use client";

import { useActionState } from "react";
import { addHoliday } from "@/lib/actions/policies";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AddHolidayForm({ countries }: { countries: { code: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(addHoliday, initialState);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="countryCode">Country</Label>
        <Select id="countryCode" name="countryCode" defaultValue={countries[0]?.code}>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="holidayDate">Date</Label>
        <Input id="holidayDate" name="holidayDate" type="date" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" placeholder="National Day" required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
      {state.error ? (
        <Alert variant="destructive" className="sm:col-span-4">
          {state.error}
        </Alert>
      ) : null}
    </form>
  );
}
