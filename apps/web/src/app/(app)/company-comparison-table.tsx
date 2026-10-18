"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, TriangleAlert, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CompanySnapshot } from "./dashboard-data";

/**
 * Replaces the old "six identical stat cards per company" layout: one
 * compact row per company instead, expandable for the same detail the old
 * cards showed. A company with zero employees gets an explanatory empty
 * state instead of a row full of zeros.
 */
export function CompanyComparisonTable({
  snapshots,
  canAssignByCompany,
}: {
  snapshots: CompanySnapshot[];
  canAssignByCompany: Record<string, boolean>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Companies</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="hidden grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr_0.8fr_0.9fr_auto] gap-2 px-3 text-sm font-medium text-muted-foreground sm:grid">
          <span>Company</span>
          <span className="text-right">Employees</span>
          <span className="text-right">Present</span>
          <span className="text-right">On leave</span>
          <span className="text-right" title="No attendance recorded on a scheduled workday">No record</span>
          <span className="text-right">In review</span>
          <span />
        </div>
        {snapshots.map((s) => {
          if (s.error) {
            return (
              <EmptyState
                key={s.companyId}
                dense
                icon={TriangleAlert}
                title={`${s.companyName}'s data couldn't be loaded right now.`}
                description="This is a temporary problem on our end, not a sign that the company has no data — try refreshing in a moment."
              />
            );
          }

          if (s.totalEmployees === 0) {
            return (
              <EmptyState
                key={s.companyId}
                dense
                title={`No employees have been assigned to ${s.companyName} yet.`}
                description="Once employees are added to this company, its attendance and approvals will show up here."
                action={
                  canAssignByCompany[s.companyId] ? (
                    <Link href="/employees/new" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      <UserPlus className="h-3.5 w-3.5" aria-hidden />
                      Assign employees
                    </Link>
                  ) : undefined
                }
              />
            );
          }

          const isOpen = expanded === s.companyId;
          return (
            <div key={s.companyId} className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : s.companyId)}
                aria-expanded={isOpen}
                className="grid w-full grid-cols-2 items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary/40 sm:grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr_0.8fr_0.9fr_auto]"
              >
                <span className="col-span-2 flex items-center gap-2 font-medium sm:col-span-1">
                  {s.companyName}
                  {s.restDayLabel ? (
                    <Badge variant="outline" className="text-xs">
                      {s.restDayLabel}
                    </Badge>
                  ) : null}
                </span>
                <span className="text-right sm:text-right">{s.totalEmployees}</span>
                <span className="text-right text-success">{s.presentCount}</span>
                <span className="text-right">{s.leaveCount}</span>
                <span className={cn("text-right", s.notRecordedScheduledCount > 0 && "text-warning")}>{s.notRecordedScheduledCount}</span>
                <span className={cn("text-right", s.leaveRequestsAwaitingDecision > 0 && "text-accent")}>{s.leaveRequestsAwaitingDecision}</span>
                <ChevronDown className={cn("hidden h-4 w-4 justify-self-end text-muted-foreground transition-transform duration-150 sm:block", isOpen && "rotate-180")} aria-hidden />
              </button>
              {isOpen ? (
                <div className="grid grid-cols-2 gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground sm:grid-cols-3">
                  <div>
                    <div className="text-foreground">{s.presentCount}</div>
                    Recorded present today
                  </div>
                  <div>
                    <div className="text-foreground">{s.leaveCount}</div>
                    Recorded on leave today
                  </div>
                  <div>
                    <div className="text-foreground">{s.absentCount}</div>
                    Recorded absent today
                  </div>
                  <div>
                    <div className="text-foreground">{s.notRecordedScheduledCount}</div>
                    No record, scheduled workday
                  </div>
                  <div>
                    <div className="text-foreground">{s.notRecordedRestCount}</div>
                    Rest day or holiday, no record expected
                  </div>
                  {s.notRecordedUnknownCount > 0 ? (
                    <div>
                      <div className="text-foreground">{s.notRecordedUnknownCount}</div>
                      No record, day type not known
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {snapshots.length === 0 ? (
          <EmptyState title="No companies to show." description="You don't currently have access to any company's overview." />
        ) : null}
      </CardContent>
    </Card>
  );
}
