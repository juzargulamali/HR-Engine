import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A titled block used by every panel on the opportunity pages. `actions` sit beside the title. */
export function Panel({ title, description, actions, children, className, id }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <Card className={cn("min-w-0", className)} id={id}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

export const Muted = ({ children, className }: { children: React.ReactNode; className?: string }) => <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>;

export const SubHeading = ({ children }: { children: React.ReactNode }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
