import * as React from "react";
import { cn } from "@/lib/utils";
import { listTable } from "@/components/workspace/list-table";
import { TableLabels } from "./table-labels";

/**
 * `stack`: below the `md` breakpoint each row becomes a small card (the first cell is its title, the other cells show their column heading),
 * so a list never needs a sideways scroll on a phone. The headings are read from the header row (see TableLabels).
 */
export function Table({ className, stack, ...props }: React.HTMLAttributes<HTMLTableElement> & { stack?: boolean }) {
  return (
    <div className="os-table-wrap relative w-full overflow-x-auto rounded-md border border-border">
      <table className={cn("w-full caption-bottom text-sm", stack && listTable, className)} {...props} />
      {stack ? <TableLabels /> : null}
    </div>
  );
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-secondary/60", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-border transition-colors hover:bg-secondary/40", className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn("h-10 px-4 text-left align-middle text-[13px] font-semibold uppercase tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("p-4 align-middle", className)} {...props} />;
}
