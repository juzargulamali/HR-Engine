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
}: {
  employeeId: string;
  contracts: ContractRow[];
  currentAsOfTodayVersionNo: number | null;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(addContractVersion, initialState);
  const currentRow = contracts.find((c) => c.is_current);
  const nextVersionNo = (contracts[0]?.version_no ?? 0) + 1;

  return (
    <div className="space-y-4">
      <Table>
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
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No contract on record yet.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {canEdit ? (
        <form action={formAction} className="space-y-3 border-t border-border pt-4">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="currentContractId" value={currentRow?.id ?? ""} />
          <input type="hidden" name="nextVersionNo" value={nextVersionNo} />
          <p className="text-sm font-medium">Add a new contract version</p>
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
              <Input id="startDate" name="startDate" type="date" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noticePeriodDays">Notice (days)</Label>
              <Input id="noticePeriodDays" name="noticePeriodDays" type="number" defaultValue={30} min={0} />
            </div>
          </div>
          {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Supersede with new version"}
          </Button>
          <p className="text-xs text-muted-foreground">
            This becomes the current version; version {currentRow?.version_no ?? "—"} stays on record for history.
          </p>
        </form>
      ) : null}
    </div>
  );
}
