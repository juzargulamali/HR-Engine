"use client";

import { useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ActivateButton } from "./activate-button";
import { DeletePolicyVersionButton } from "./delete-policy-version-button";

export interface PolicyVersionRow {
  id: string;
  countryLabel: string;
  policyType: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "draft" | "active" | "superseded";
  canActivate: boolean;
  canDelete: boolean;
  hasDependentConfig: boolean;
  isDrafter: boolean;
  isLatest: boolean;
}

/**
 * Display-only: shows just the latest version per (country, policy_type) by
 * default, with a toggle to reveal every version — nothing is deleted or
 * modified either way, this only changes which already-fetched rows are
 * rendered. "Latest" is computed server-side (page.tsx) from the same
 * country_code/policy_type/version_no-desc ordering the query already used.
 */
export function PolicyVersionsTable({ rows }: { rows: PolicyVersionRow[] }) {
  const [showOlder, setShowOlder] = useState(false);
  const visibleRows = showOlder ? rows : rows.filter((r) => r.isLatest);
  const olderCount = rows.length - rows.filter((r) => r.isLatest).length;

  return (
    <div className="space-y-3">
      {olderCount > 0 ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setShowOlder((v) => !v)}>
          {showOlder ? "Hide older versions" : `Show older versions (${olderCount})`}
        </Button>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Country</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Effective</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.countryLabel}</TableCell>
              <TableCell className="capitalize">{p.policyType.replace(/_/g, " ")}</TableCell>
              <TableCell>
                <Link href={`/policies/${p.id}`} className="hover:underline">
                  v{p.versionNo}
                </Link>
              </TableCell>
              <TableCell>
                {p.effectiveFrom}
                {p.effectiveTo ? ` – ${p.effectiveTo}` : " – open"}
              </TableCell>
              <TableCell>
                <Badge variant={p.status === "active" ? "default" : p.status === "draft" ? "secondary" : "outline"}>{p.status}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {p.canActivate ? <ActivateButton policyVersionId={p.id} /> : null}
                  {p.canDelete && !p.hasDependentConfig ? <DeletePolicyVersionButton policyVersionId={p.id} /> : null}
                  {p.canDelete && p.hasDependentConfig ? (
                    <span className="text-xs text-muted-foreground">has configured leave types — remove them first</span>
                  ) : null}
                  {p.status === "draft" && p.isDrafter ? <span className="text-xs text-muted-foreground">awaiting a different approver</span> : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {visibleRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6}>
                <EmptyState dense title="No policies yet." />
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
