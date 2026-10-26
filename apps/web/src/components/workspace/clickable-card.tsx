"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { confirmDiscard } from "./unsaved";
import { shouldOpenRow } from "./row-click";

/**
 * A card or list item that opens its record when its empty part is clicked: the phone and board counterpart of ClickableRow, with the
 * same rule (components/workspace/row-click.ts). The title inside stays a real link; a button, menu, checkbox or field inside does only
 * its own job; Ctrl/Cmd-click opens a new tab; a click that ends a text selection opens nothing.
 */
export function ClickableCard({ href, panel, selected, as: Tag = "div", className, children, ...rest }: { href: string; panel?: boolean; selected?: boolean; as?: "div" | "li" | "article" } & Omit<React.HTMLAttributes<HTMLElement>, "onClick">) {
  const router = useRouter();
  return (
    <Tag
      {...rest}
      data-clickable="true"
      data-selected={selected ? "true" : undefined}
      className={cn("os-click-card cursor-pointer", className)}
      onClick={(e: React.MouseEvent<HTMLElement>) => {
        if (!shouldOpenRow(e.target as Element | null, e.currentTarget, { defaultPrevented: e.defaultPrevented, button: e.button }, window.getSelection()?.toString() ?? "")) return;
        if (e.metaKey || e.ctrlKey) { window.open(href, "_blank", "noopener"); return; }
        if (panel && !confirmDiscard()) return;
        router.push(href, { scroll: false });
      }}
    >
      {children}
    </Tag>
  );
}
