"use client";

import Link from "next/link";
import { useState } from "react";
import { Printer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PanelLink } from "@/components/workspace/panel-link";
import { listTable } from "@/components/workspace/list-table";
import { cn } from "@/lib/utils";

export interface UnitRowView {
  id: string;
  code: string;
  serial: string | null;
  condition: string;
  lifecycle: string | null;
  /** Where it is, and with whom, only filled in for people who may see custody. */
  where: string | null;
  cost: string | null;
  href: string;
}

/** The individual units of an item: ID, serial, condition and where. Tick some to print their labels together. */
export function UnitsTable({ units, showWhere, showCost, truncated }: { units: readonly UnitRowView[]; showWhere: boolean; showCost: boolean; truncated?: boolean }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const codes = units.filter((u) => picked.has(u.id)).map((u) => u.code);
  const labelHref = (list: string[]) => `/inventory/labels?codes=${encodeURIComponent(list.join(","))}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" role="status">{units.length} unit{units.length === 1 ? "" : "s"}{truncated ? " (the first ones; use search to find others)" : ""}</p>
        {codes.length > 0 ? <Link href={labelHref(codes)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><Printer className="h-4 w-4" aria-hidden /> Print {codes.length} label{codes.length === 1 ? "" : "s"}</Link> : null}
      </div>
      <Table className={cn("min-w-[28rem]", listTable)}>
        <caption className="sr-only">Units of this item</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">ID</TableHead>
            <TableHead scope="col">Serial</TableHead>
            <TableHead scope="col">Condition</TableHead>
            {showWhere ? <TableHead scope="col">Where</TableHead> : null}
            {showCost ? <TableHead scope="col">Cost</TableHead> : null}
            <TableHead scope="col">Label</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {units.map((u) => (
            <TableRow key={u.id} className="align-top">
              <TableCell><PanelLink href={u.href} className="font-mono font-medium underline-offset-2 hover:underline">{u.code}</PanelLink></TableCell>
              <TableCell data-label="Serial">{u.serial ?? <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell data-label="Condition">{u.condition}{u.lifecycle ? <span className="block text-[13px] text-muted-foreground">{u.lifecycle}</span> : null}</TableCell>
              {showWhere ? <TableCell data-label="Where" className="break-words">{u.where ?? "—"}</TableCell> : null}
              {showCost ? <TableCell data-label="Cost" className="whitespace-nowrap">{u.cost ?? "—"}</TableCell> : null}
              <TableCell data-label="Label">
                <span className="inline-flex items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} aria-label={`Select ${u.code} to print its label`} className="h-4 w-4" /> Select</label>
                  <Link href={labelHref([u.code])} className="whitespace-nowrap text-sm font-medium underline-offset-2 hover:underline" aria-label={`Print the label for ${u.code}`}>Print label</Link>
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
