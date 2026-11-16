"use client";

import { useActionState } from "react";
import { addContractVersion } from "@/lib/actions/employees";
import type { ActionState } from "@/lib/actions/companies";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";

const initialState: ActionState = { error: null };

interface ContractRow {
  id: string;
  contract_type: string;
  start_date: string;
  end_date: string | null;
  notice_period_days: number;
  is_current: boolean;
  version_no: number;
}

export function ContractHistory({
  employeeId,
  contracts,
  currentAsOfTodayVersionNo,
  canEdit,
  startOpen = false,
  employeeName,
  companyName,
  hireDate,
}: {
  employeeId: string;
  contracts: ContractRow[];
  currentAsOfTodayVersionNo: number | null;
  canEdit: boolean;
  /** Open the add-contract form already expanded (the setup step "Add contract" links here), with the employee and company shown. */
  startOpen?: boolean;
  employeeName?: string;
  companyName?: string;
  /** The first contract's start date is offered as the hire date, so it is not retyped. */
  hireDate?: string;
}) {
  const [state, formAction, pending] = useActionState(addContractVersion, initialState);
  const currentRow = contracts.find((c) => c.is_current);
  const nextVersionNo = (contracts[0]?.version_no ?? 0) + 1;

  return (
    <div className="space-y-4">
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>Version</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Start</TableHead>
            <TableHead>End</TableHead>
            <TableHead>Notice</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.version_no}</TableCell>
              <TableCell className="capitalize">{c.contract_type.replace("_", " ")}</TableCell>
              <TableCell>{c.start_date}</TableCell>
              <TableCell>{c.end_date ?? "—"}</TableCell>
              <TableCell>{c.notice_period_days}d</TableCell>
              <TableCell className="space-x-1">
                {c.is_current ? <Badge>current</Badge> : null}
                {c.version_no === currentAsOfTodayVersionNo ? (
                  <Badge variant="outline">in effect today</Badge>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
          {contracts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6}>
                <EmptyState dense title="No contract on record yet." />
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {canEdit ? (
        <details open={startOpen} className="border-t border-border pt-4" data-testid="add-contract">
          <summary className="cursor-pointer text-sm font-medium">{currentRow ? "Add a new contract version" : "Add the first contract"}</summary>
        <form action={formAction} className="mt-3 space-y-3">
          {employeeName ? <div className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-testid="add-contract-who"><span className="font-medium">{employeeName}</span>{companyName ? ` · ${companyName}` : ""}</div> : null}
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="currentContractId" value={currentRow?.id ?? ""} />
          <input type="hidden" name="nextVersionNo" value={nextVersionNo} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="contractType">Type</Label>
              <Select id="contractType" name="contractType" defaultValue="permanent">
                <option value="probation">Probation</option>
                <option value="permanent">Permanent</option>
                <option value="fixed_term">Fixed term</option>
                <option value="contractor">Contractor</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Start date</Label>
              <Input id="startDate" name="startDate" type="date" required defaultValue={!currentRow ? hireDate : undefined} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noticePeriodDays">Notice (days)</Label>
              <Input id="noticePeriodDays" name="noticePeriodDays" type="number" defaultValue={30} min={0} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fteFraction">FTE fraction</Label>
              <Input id="fteFraction" name="fteFraction" type="number" defaultValue={1} step="0.05" min="0.05" max="1" />
              <p className="text-sm text-muted-foreground">1.0 = full-time. Prorates Poland Annual Leave for part-time contracts.</p>
            </div>
          </div>
          {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : currentRow ? "Supersede with new version" : "Add contract"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {currentRow ? `This becomes the current version; version ${currentRow.version_no} stays on record for history.` : "This becomes contract version 1 for this employee."}
          </p>
        </form>
        </details>
      ) : null}
    </div>
  );
}
