"use client";

import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/components/sales/format";
import { PanelLink } from "@/components/workspace/panel-link";
import { withParams } from "@/components/workspace/url-state";

export interface TechnologyRow { id: string; name: string; description: string | null; status: "draft" | "complete" | "retired"; components: number; updatedAt: string }

export const TECH_STATUS_WORDS = {
  draft: { label: "Draft", help: "Still being written. Not used for availability checks." },
  complete: { label: "Complete", help: "Trusted: used for availability checks and when a request is built from it." },
  retired: { label: "Retired", help: "Kept for history. It cannot be edited or used for new requests." },
} as const;

/** Technology templates: a searchable table. A row opens the editor in the side panel (`?tech=ID`); "new" starts an empty one. */
export function TechnologiesSection({ rows, canEdit }: { rows: readonly TechnologyRow[]; canEdit: boolean }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => (status === "" || r.status === status) && (t === "" || r.name.toLowerCase().includes(t) || (r.description ?? "").toLowerCase().includes(t)));
  }, [rows, q, status]);
  const href = (id: string) => `${withParams(pathname, sp, { tech: id })}#technologies`;
  return (
    <div className="space-y-4">
      <div className="max-w-3xl space-y-1 text-sm text-muted-foreground">
        <p><strong>A technology template is a checklist, not stock.</strong> It lists the items and quantities one installation needs (a recipe). It never adds to, or takes from, what is on the shelf.</p>
        <p><strong>Complete</strong> templates are used for availability checks and to build a request. Changing a template later never changes a request that already used it.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {rows.length > 0 ? (
          <>
            <div className="min-w-[14rem] flex-1 sm:max-w-sm"><label htmlFor="inv-tech-q" className="sr-only">Search templates</label><Input id="inv-tech-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" /></div>
            <div><label htmlFor="inv-tech-status" className="sr-only">Status</label><select id="inv-tech-status" value={status} onChange={(e) => setStatus(e.target.value)} className="flex h-9 rounded-md border border-input bg-field px-3 py-1 text-sm"><option value="">All statuses</option>{(Object.keys(TECH_STATUS_WORDS) as (keyof typeof TECH_STATUS_WORDS)[]).map((k) => <option key={k} value={k}>{TECH_STATUS_WORDS[k].label}</option>)}</select></div>
          </>
        ) : null}
        {canEdit ? <PanelLink href={href("new")} className="ml-auto inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium hover:border-accent/60 hover:bg-secondary/70">Add a technology template</PanelLink> : null}
      </div>
      {rows.length === 0 ? <EmptyState dense title="No technology templates yet." description={canEdit ? "Add the first one: a name, then the items it needs." : "Someone with catalogue rights needs to add them."} /> : shown.length === 0 ? <p className="text-sm text-muted-foreground">No template matches.</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Template</TableHead><TableHead>Status</TableHead><TableHead>Items</TableHead><TableHead>Changed</TableHead></TableRow></TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="min-w-[12rem]"><PanelLink href={href(r.id)} className="font-medium underline-offset-2 hover:underline">{r.name}</PanelLink>{r.description ? <span className="block max-w-md truncate text-sm text-muted-foreground">{r.description}</span> : null}</TableCell>
                <TableCell><Badge variant={r.status === "complete" ? "success" : r.status === "draft" ? "warning" : "outline"} title={TECH_STATUS_WORDS[r.status].help}>{TECH_STATUS_WORDS[r.status].label}</Badge></TableCell>
                <TableCell>{r.components}</TableCell>
                <TableCell>{formatDate(r.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
