import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { handoverProcess } from "@/lib/projects/handover-process";

/**
 * The one handover process, shown the same way in Sales and in Projects: five steps, what is done, which one is waiting and who does it.
 * Nothing here can be edited; the steps are read from the Projects handover record.
 */
export function HandoverProcess({ status, className }: { status: string | null | undefined; className?: string }) {
  const { steps, next } = handoverProcess(status);
  return (
    <div className={className}>
      <ol aria-label="Handover process" className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-1.5">
        {steps.map((s, i) => (
          <li key={s.key} aria-current={s.state === "current" ? "step" : undefined} className="flex min-w-0 flex-1 items-stretch gap-1.5">
            <div className={cn("flex min-w-0 flex-1 gap-2.5 rounded-lg border px-3 py-2.5", s.state === "current" ? "border-accent/70 bg-secondary/50" : "border-border bg-card")}>
              {s.state === "done" ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-success" aria-hidden /> : <Circle className={cn("mt-0.5 h-4 w-4 flex-none", s.state === "current" ? "text-accent" : "text-muted-foreground")} aria-hidden />}
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  <span className="text-muted-foreground">{i + 1}. </span>{s.label}
                  <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (waiting now)" : " (not yet)"}</span>
                </p>
                <p className="break-words text-[13px] text-muted-foreground">{s.who}</p>
                {s.note ? <p className="mt-0.5 break-words text-[13px] font-medium">{s.note}</p> : null}
              </div>
            </div>
            {i < steps.length - 1 ? <ArrowRight className="hidden h-4 w-4 flex-none self-center text-muted-foreground lg:block" aria-hidden /> : null}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm" role="status">{next}</p>
    </div>
  );
}
