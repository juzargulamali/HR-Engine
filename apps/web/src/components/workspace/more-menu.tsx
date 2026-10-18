"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface MoreItem {
  key: string;
  label: string;
  /** A destination (opens that page) ... */
  href?: string;
  /** ...or an action (the page opens its own dialog for it). */
  onSelect?: (key: string) => void;
  /** A small explanation shown under the label (for example why something is unavailable). */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** A thin rule above this item, to separate infrequent or serious actions from the rest. */
  separatorBefore?: boolean;
}

const ITEM = "flex w-full flex-col items-start rounded-md px-3 py-2 text-left text-sm hover:bg-secondary/70 focus-visible:bg-secondary/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Where infrequent and specialist actions live (Hold, Reopen, Reassign, Manage project…): one clearly labelled button instead of a
 * row of buttons on every record. Items either go to a page or ask the page to open its own confirmation form; nothing here changes
 * data on its own.
 */
export function MoreMenu({ items, label = "More", variant = "outline", align = "end" }: { items: readonly MoreItem[]; label?: string; variant?: "outline" | "ghost" | "secondary"; align?: "start" | "end" }) {
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <DropdownMenu
      align={align}
      keyboardNav
      trigger={({ open, toggle }) => (
        <Button type="button" variant={variant} size="sm" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          <MoreHorizontal className="h-4 w-4" aria-hidden /> {label}
        </Button>
      )}
    >
      {({ close }) => (
        <ul className="space-y-0.5">
          {shown.map((it) => (
            <li key={it.key} role="none" className={cn(it.separatorBefore && "mt-1 border-t border-border pt-1")}>
              {it.href && !it.disabled ? (
                <Link href={it.href} role="menuitem" onClick={close} className={cn(ITEM, it.danger && "text-destructive")}>
                  {it.label}
                  {it.hint ? <span className="text-[13px] font-normal text-muted-foreground">{it.hint}</span> : null}
                </Link>
              ) : (
                <button type="button" role="menuitem" disabled={it.disabled} onClick={() => { close(); it.onSelect?.(it.key); }} className={cn(ITEM, it.danger && "text-destructive")}>
                  {it.label}
                  {it.hint ? <span className="text-[13px] font-normal text-muted-foreground">{it.hint}</span> : null}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </DropdownMenu>
  );
}
