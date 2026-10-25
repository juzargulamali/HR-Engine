"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { confirmDiscard } from "./unsaved";
import { shouldOpenRow } from "./row-click";

/**
 * A table row that opens its record when its empty part is clicked. The row's title stays a real link (keyboard, middle click, "open in a
 * new tab", assistive technology): this only adds the larger target for the pointer. A control inside the row does only its own job.
 * `panel` rows open a side panel, so they first ask before discarding unsaved edits in the panel that is already open, like PanelLink.
 * Ctrl/Cmd-click opens the address in a new tab, as it would on the title link.
 */
export function ClickableRow({ href, panel, selected, className, children, ...rest }: { href: string; panel?: boolean; selected?: boolean } & Omit<React.HTMLAttributes<HTMLTableRowElement>, "onClick">) {
  const router = useRouter();
  return (
    <TableRow
      {...rest}
      data-clickable="true"
      data-selected={selected ? "true" : undefined}
      className={cn("cursor-pointer", className)}
      onClick={(e) => {
        if (!shouldOpenRow(e.target as Element | null, e.currentTarget, { defaultPrevented: e.defaultPrevented, button: e.button }, window.getSelection()?.toString() ?? "")) return;
        if (e.metaKey || e.ctrlKey) { window.open(href, "_blank", "noopener"); return; }
        if (panel && !confirmDiscard()) return;
        router.push(href, { scroll: false });
      }}
    >
      {children}
    </TableRow>
  );
}
