import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/utils";

/**
 * A titled block used by every panel on the opportunity pages. `actions` sit beside the title. `hint` is the longer, optional explanation behind an ⓘ beside the
 * title; `description` stays for a short line a person needs to read before acting (who acts, what the action does).
 */
export function Panel({ title, description, hint, actions, children, className, id }: { title: string; description?: string; hint?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <Card className={cn("min-w-0", className)} id={id}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}{hint ? <InfoHint label={title} className="ml-1">{hint}</InfoHint> : null}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export function Fact({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="flex items-center gap-1 text-sm text-muted-foreground">{label}{hint ? <InfoHint label={label}>{hint}</InfoHint> : null}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

export const Muted = ({ children, className }: { children: React.ReactNode; className?: string }) => <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>;

export const SubHeading = ({ children }: { children: React.ReactNode }) => <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
