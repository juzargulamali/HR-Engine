import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A plain, native <select> styled to match the rest of the kit. Fine for
 * Phase 0's simple pickers (role, country); swap for a Radix-based
 * combobox later if a screen needs search/multi-select — nothing here
 * depends on this staying native.
 */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
