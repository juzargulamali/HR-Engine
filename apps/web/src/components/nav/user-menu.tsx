"use client";

import { ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * The sidebar footer identity block — also where role badges now live
 * (moved out of the permanent header, which just got cluttered by them).
 * `signOutSlot` is a server-rendered <form action={signOut}>...</form>
 * passed down from AppShell — Server Actions render fine as a prop into a
 * client component, so there's no need to re-plumb the action itself here.
 */
export function UserMenu({
  fullName,
  email,
  roleLabels,
  signOutSlot,
  collapsed = false,
  side = "bottom",
}: {
  fullName: string;
  email: string | null;
  roleLabels: string[];
  signOutSlot: React.ReactNode;
  collapsed?: boolean;
  side?: "top" | "bottom";
}) {
  return (
    <DropdownMenu
      align="start"
      side={side}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={collapsed ? `Account menu for ${fullName}` : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md py-2 text-left transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "justify-center px-0" : "px-2",
          )}
        >
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full brand-gradient text-xs font-semibold text-primary-foreground">
            {initials(fullName)}
          </span>
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{fullName}</span>
                <span className="block truncate text-xs text-muted-foreground">{roleLabels[0] ?? "No role assigned"}</span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      )}
    >
      <div className="px-2.5 py-2">
        <p className="truncate text-sm font-medium">{fullName}</p>
        {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
        {roleLabels.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {roleLabels.map((label) => (
              <Badge key={label} variant="brand" className="text-[10px]">
                {label}
              </Badge>
            ))}
          </div>
        ) : (
          <Badge variant="outline" className="mt-1.5 text-[10px]">
            No role assigned yet
          </Badge>
        )}
      </div>
      <div className="my-1 h-px bg-border" />
      <ThemeToggle variant="menu-item" />
      <div className="my-1 h-px bg-border" />
      <div className="px-1 [&_button]:w-full [&_button]:justify-start">{signOutSlot}</div>
    </DropdownMenu>
  );
}
