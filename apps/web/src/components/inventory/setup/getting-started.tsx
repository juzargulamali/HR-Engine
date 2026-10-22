import Link from "next/link";
import { Check, Circle, CircleDot, HelpCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Checklist, StepState } from "@/lib/inventory/setup";

const STATE_WORDS: Record<StepState, string> = { done: "Done", partial: "In progress", todo: "Not started", unknown: "Cannot be shown" };

function Mark({ state }: { state: StepState }) {
  const cls = "h-5 w-5 flex-none";
  if (state === "done") return <Check className={`${cls} text-success`} aria-hidden />;
  if (state === "partial") return <CircleDot className={`${cls} text-warning`} aria-hidden />;
  if (state === "unknown") return <HelpCircle className={`${cls} text-muted-foreground`} aria-hidden />;
  return <Circle className={`${cls} text-muted-foreground`} aria-hidden />;
}

/** The five stock-taking steps, and which are done. Progress is read from the records, never ticked by hand. */
export function GettingStarted({ checklist }: { checklist: Checklist }) {
  return (
    <Card className="min-w-0" id="getting-started">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Getting started</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{checklist.doneCount} of {checklist.total} steps done. These are read from your records as they are today, not ticked by hand.</p>
      </div>
      <ol className="divide-y divide-border">
        {checklist.steps.map((s) => (
          <li key={s.id} className="flex items-start gap-3 px-4 py-3">
            <Mark state={s.state} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                <span className="text-muted-foreground">{s.id}. </span>
                {s.href.startsWith("/") ? <Link href={s.href} className="underline-offset-2 hover:underline">{s.title}</Link> : <a href={s.href} className="underline-offset-2 hover:underline">{s.title}</a>}
              </p>
              <p className="text-sm text-muted-foreground">{s.detail}</p>
            </div>
            <span className="flex-none text-[13px] text-muted-foreground">{STATE_WORDS[s.state]}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
