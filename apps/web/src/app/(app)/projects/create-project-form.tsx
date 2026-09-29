"use client";

import { useActionState } from "react";
import { createProject } from "@/lib/actions/projects";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function CreateProjectForm({ companies }: { companies: { id: string; legal_name: string }[] }) {
  const [state, formAction, pending] = useActionState(createProject, initialState);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-[1.5fr_1fr_1fr_1.5fr_auto] sm:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="name">Project name</Label>
        <Input id="name" name="name" placeholder="Enginious HR Engine" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="code">Code</Label>
        <Input id="code" name="code" placeholder="EHR" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="companyId">Company</Label>
        <Select id="companyId" name="companyId" defaultValue={companies[0]?.id ?? ""} required>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.legal_name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="clientName">Client (optional)</Label>
        <Input id="clientName" name="clientName" />
      </div>
      <Button type="submit" disabled={pending || companies.length === 0}>
        {pending ? "Adding…" : "Add project"}
      </Button>
      {state.error ? (
        <Alert variant="destructive" className="sm:col-span-5">
          {state.error}
        </Alert>
      ) : null}
    </form>
  );
}
