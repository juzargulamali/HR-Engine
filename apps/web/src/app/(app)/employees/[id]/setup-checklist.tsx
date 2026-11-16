import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/utils";
import { setupSummary, type SetupStatus, type SetupStep } from "@/lib/hr/setup";

const STATUS_WORD: Record<SetupStatus, string> = { done: "Done", todo: "To do", optional: "Optional", not_applicable: "Not applicable" };
const STATUS_CLASS: Record<SetupStatus, string> = {
  done: "text-success",
  todo: "text-warning",
  optional: "text-muted-foreground",
  not_applicable: "text-muted-foreground",
};

/**
 * The resumable setup list. Each row is stacked (label, status in words, one sentence, one action), so it reads on a phone and never depends on colour alone.
 * The card's header keeps the employee and company in view; a row the person came from (`?step=`) is highlighted. Pure rendering: the steps are derived from the
 * existing records by `computeSetup`, so opening the profile again on any device shows the same list.
 */
export function SetupChecklist({ steps, employeeName, companyName, focusStep }: { steps: readonly SetupStep[]; employeeName: string; companyName: string; focusStep?: string }) {
  if (steps.length === 0) return null;
  const summary = setupSummary(steps);
  const complete = summary.total > 0 && summary.remaining === 0;
  // A link's `step` names the setup step it opens ("pay" opens the compensation step), so the row that was clicked is the one highlighted.
  const focusKey = focusStep === "pay" ? "compensation" : focusStep === "opening-balances" ? "opening_balances" : focusStep;

  return (
    <Card data-testid="setup-checklist">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-x-2 text-base">
          Setup
          <InfoHint label="Setup">
            <p>What is left to do for this employee, read from the records that already exist. You can leave and come back: nothing is stored apart from the records themselves, and a step turns Done as soon as its record exists. Optional steps never count as unfinished.</p>
          </InfoHint>
        </CardTitle>
        <p className="text-sm text-muted-foreground" data-testid="setup-context">
          <span className="font-medium text-foreground">{employeeName}</span> · {companyName}
        </p>
        {summary.text ? (
          <p className={cn("text-sm font-medium", complete ? "text-success" : "text-warning")} data-testid="setup-summary">
            {summary.text}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li
              key={s.key}
              id={`step-${s.key}`}
              data-testid={`setup-step-${s.key}`}
              data-status={s.status}
              className={cn("space-y-1 rounded-md border border-border p-3", focusKey === s.key && "ring-2 ring-ring")}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-medium">{s.label}</p>
                <p className={cn("text-sm font-medium", STATUS_CLASS[s.status])} data-testid={`setup-status-${s.key}`}>
                  {STATUS_WORD[s.status]}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">{s.detail}</p>
              {s.href && s.actionLabel ? (
                <Link href={s.href} className={cn(buttonVariants({ size: "sm", variant: s.status === "todo" ? "default" : "outline" }), "w-full sm:w-auto")}>
                  {s.actionLabel}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
