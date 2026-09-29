"use client";

import { useActionState } from "react";
import { updateProject } from "@/lib/actions/projects";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

interface ProjectCore {
  id: string;
  name: string;
  client_name: string | null;
  manager_id: string | null;
  is_billable: boolean;
  is_active: boolean;
}

export function EditProjectForm({
  project,
  employees,
}: {
  project: ProjectCore;
  employees: { id: string; first_name: string; last_name: string }[];
}) {
  const [state, formAction, pending] = useActionState(updateProject, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={project.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Project name</Label>
          <Input id="name" name="name" defaultValue={project.name} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clientName">Client</Label>
          <Input id="clientName" name="clientName" defaultValue={project.client_name ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="managerId">Project manager</Label>
          <Select id="managerId" name="managerId" defaultValue={project.manager_id ?? ""}>
            <option value="">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.first_name} {e.last_name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Recovery Leave step 1&apos;s approver for anyone actively allocated to this project.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="isBillable">Billable</Label>
          <Select id="isBillable" name="isBillable" defaultValue={String(project.is_billable)}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="isActive">Status</Label>
          <Select id="isActive" name="isActive" defaultValue={String(project.is_active)}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </div>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save project"}
      </Button>
    </form>
  );
}
