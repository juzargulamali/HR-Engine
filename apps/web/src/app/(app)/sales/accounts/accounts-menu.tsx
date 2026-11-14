"use client";

import Link from "next/link";
import { Download, MoreHorizontal, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";

const ITEM = "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary/70 focus-visible:bg-secondary/70 focus-visible:outline-none";

/**
 * Import and the two exports, behind one button: Add account is the page's one primary action and these are occasional. The exports are plain
 * downloads (ordinary links, never prefetched), so opening the menu reads nothing. Each export keeps its own address: "filtered" carries the
 * search, filters and relationship chip in use, "all" carries only the company.
 */
export function AccountsMenu({ importHref, exportFilteredHref, exportAllHref, filtered }: { importHref: string; exportFilteredHref: string; exportAllHref: string; filtered: boolean }) {
  return (
    <DropdownMenu
      align="end"
      keyboardNav
      trigger={({ open, toggle }) => (
        <Button type="button" variant="outline" aria-haspopup="menu" aria-expanded={open} onClick={toggle} data-testid="accounts-more">
          <MoreHorizontal className="h-4 w-4" aria-hidden /> Import and export
        </Button>
      )}
    >
      {({ close }) => (
        <ul className="space-y-0.5">
          <li role="none">
            <Link href={importHref} prefetch={false} role="menuitem" onClick={close} className={ITEM} data-testid="accounts-import">
              <Upload className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Import from Excel<span className="block text-[13px] text-muted-foreground">Upload, check the preview, then confirm.</span></span>
            </Link>
          </li>
          <li role="none">
            <a href={exportFilteredHref} role="menuitem" onClick={close} className={ITEM} data-testid="accounts-export-filtered">
              <Download className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Export filtered results<span className="block text-[13px] text-muted-foreground">{filtered ? "Only the accounts that match the search and filters in use." : "No filter is in use, so this is every account."}</span></span>
            </a>
          </li>
          <li role="none">
            <a href={exportAllHref} role="menuitem" onClick={close} className={ITEM} data-testid="accounts-export-all">
              <Download className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Export all accounts<span className="block text-[13px] text-muted-foreground">Every account, whatever is filtered on screen.</span></span>
            </a>
          </li>
        </ul>
      )}
    </DropdownMenu>
  );
}
