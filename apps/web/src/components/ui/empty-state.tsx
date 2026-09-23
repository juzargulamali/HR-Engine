import { cn } from "@/lib/utils";

/**
 * Every empty state should say what's empty, why, and what to do next —
 * never just a bare "No data" or, worse, a field of zeros with no
 * explanation. `action` is optional because not every viewer is allowed to
 * act (e.g. an employee looking at an empty company roster shouldn't see
 * an "Add employee" button they can't use).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  dense = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center",
        dense ? "px-4 py-6" : "px-6 py-10",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
