"use client";

import { ArrowUpRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chip, PageHeader, Panel } from "../_components/ui";

const FEATURES = [
  { n: "Attendance and clock", d: "Clock in and out, Site work, corrections." },
  { n: "Recovery Leave", d: "Recovery credit with the project-lead approval step." },
  { n: "Leave", d: "Requests, balances, approvals." },
  { n: "Expenses and reimbursements", d: "Claims with line items and receipts." },
  { n: "Payroll", d: "Runs, payslips, letters." },
  { n: "Appraisals", d: "Goals, cycles, reviews." },
  { n: "People, documents, assets, policies, holidays", d: "Directory, expiring documents, equipment issued to employees." },
  { n: "Accounts and permissions", d: "Sign-in, roles, reporting managers." },
];

export default function People() {
  return (
    <>
      <PageHeader eyebrow="People & HR" title="People & HR" description="Attendance, leave, expenses, payroll and appraisals stay in the existing HR app." actions={<a href="https://hr-engine-web.vercel.app" className={cn(buttonVariants({ size: "sm" }))} target="_blank" rel="noreferrer">Open the live HR app<ArrowUpRight className="h-3.5 w-3.5" aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a>} />
      <div role="note" className="mb-6 rounded-md border border-border bg-secondary/50 px-3 py-2.5 text-sm">This is today&apos;s HR app, unchanged, shown here as a link.</div>
      <Panel title="What is already there" flush>
        <ul className="divide-y divide-border/70">
          {FEATURES.map((f) => <li key={f.n} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-[12rem] flex-1"><p className="text-sm font-medium">{f.n}</p><p className="text-xs text-muted-foreground">{f.d}</p></div><Chip tone="good">Existing</Chip></li>)}
        </ul>
      </Panel>
    </>
  );
}
