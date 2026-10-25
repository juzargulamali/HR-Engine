import { cn } from "@/lib/utils";

/**
 * Marks a page as migrated to the v2 design. While it is on screen the v2 tokens apply (see app/os-design.css); a page without it is
 * untouched. Wrap a module's layout content in this, nothing else is needed.
 */
export function OsScope({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("os-v2", className)}>{children}</div>;
}
