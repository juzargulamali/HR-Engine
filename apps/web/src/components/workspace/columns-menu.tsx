"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { columnsToParam, withParams } from "./url-state";

/**
 * Chooses the optional columns of a table. Only the columns picked are sent to the browser at all (the server renders just those),
 * so a column such as a value that someone is not authorised to see is never hidden in the HTML, it is simply not offered.
 */
export function ColumnsMenu({ columns, selected, defaults }: { columns: readonly { id: string; label: string; required?: boolean }[]; selected: readonly string[]; defaults: readonly string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const all = columns.map((c) => c.id);
  // The box ticks the moment it is clicked; the server then redraws the table and the address with the same choice.
  const [shown, setShown] = useOptimistic<readonly string[]>(selected);
  const [, start] = useTransition();
  const toggle = (id: string) => {
    const next = shown.includes(id) ? shown.filter((c) => c !== id) : [...shown, id];
    const required = columns.filter((c) => c.required).map((c) => c.id);
    const withRequired = [...new Set([...next, ...required])];
    start(() => {
      setShown(withRequired);
      router.replace(withParams(pathname, sp, { cols: columnsToParam(withRequired, all, defaults) }), { scroll: false });
    });
  };
  return (
    <DropdownMenu
      trigger={({ open, toggle: t }) => (
        <Button type="button" variant="outline" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={t}>
          <Columns3 className="h-4 w-4" aria-hidden /> Columns
        </Button>
      )}
    >
      <fieldset className="space-y-0.5 p-1">
        <legend className="px-2 pb-1 text-[13px] font-semibold text-muted-foreground">Show columns</legend>
        {columns.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary/70">
            <input type="checkbox" checked={shown.includes(c.id)} disabled={c.required} onChange={() => toggle(c.id)} className="h-4 w-4" />
            {c.label}
          </label>
        ))}
      </fieldset>
    </DropdownMenu>
  );
}
