import { cn } from "@/lib/utils";

const SIDE_CLASSES = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
} as const;

/**
 * Pure CSS, no JS — shown on hover OR keyboard focus of whatever's inside
 * (group-focus-within), so it works for a mouse user and a keyboard user
 * alike. Used mainly for the collapsed sidebar rail, where the icon-only
 * nav items would otherwise have no visible label at all.
 */
export function Tooltip({
  label,
  children,
  side = "top",
  className,
}: {
  label: string;
  children: React.ReactNode;
  side?: keyof typeof SIDE_CLASSES;
  className?: string;
}) {
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-md transition-all duration-150",
          "scale-95 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100 group-focus-within/tooltip:scale-100 group-focus-within/tooltip:opacity-100",
          SIDE_CLASSES[side],
        )}
      >
        {label}
      </span>
    </span>
  );
}
