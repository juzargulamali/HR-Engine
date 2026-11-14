import { AlertTriangle, CheckCircle2, Info, MinusCircle } from "lucide-react";
import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/utils";
import { ATTENTION_WORDS, type AttentionKind, type Readiness } from "./readiness";

const KIND_ICON: Record<AttentionKind, typeof Info> = { blocker: AlertTriangle, check: Info, not_copied: MinusCircle };
const KIND_TONE: Record<AttentionKind, string> = { blocker: "text-[hsl(var(--os-red))]", check: "text-[hsl(var(--os-amber))]", not_copied: "text-muted-foreground" };

/**
 * "Ready for handover": one line that says whether the brief can be submitted, then two lists. What transfers names each field the project really receives, with the value
 * it will carry. Needs attention keeps the blocker visible (a missing scope stops the submission), then what to check, then what is NOT copied, in words. `phase` words the
 * heading for where the handover stands: still being prepared, already with Projects, or accepted (then only what was and was not carried is shown, nothing to fix).
 */
export function HandoverReadiness({ readiness, phase }: { readiness: Readiness; phase: "preparing" | "submitted" | "accepted" }) {
  const { ready, transfers } = readiness;
  const attention = phase === "accepted" ? readiness.attention.filter((a) => a.kind === "not_copied") : readiness.attention;
  const heading = phase === "accepted" ? "What the project received" : phase === "submitted" ? (ready ? "Submitted: what the project will receive" : "Submitted, but the scope of work is now empty") : ready ? "Ready for handover" : "Not ready for handover";
  const good = ready || phase === "accepted";
  return (
    <section aria-label="Handover readiness" className={cn("os-card p-4", good ? "os-cool" : "os-warm")} data-testid="handover-readiness" data-ready={String(ready)}>
      <h3 className="flex flex-wrap items-center gap-2 font-heading text-base font-semibold">
        {good ? <CheckCircle2 className="h-4 w-4 flex-none text-[hsl(var(--os-green))]" aria-hidden /> : <AlertTriangle className="h-4 w-4 flex-none text-[hsl(var(--os-red))]" aria-hidden />}
        <span data-testid="handover-ready-state">{heading}</span>
        <InfoHint label="what a handover carries">
          <p>The project is created from this brief when the Project Manager accepts it. Its start date is the installation date (or the first show day when there is none) and its end date is the last show day.</p>
          <p className="mt-1.5">Once accepted the brief is kept as the agreed record and cannot be edited. Later changes on the enquiry do not reach the project.</p>
        </InfoHint>
      </h3>
      {phase === "preparing" ? <p className="mt-1 text-sm text-muted-foreground">{ready ? "The scope of work is written, so the brief can be submitted. Check the two lists first." : "One thing stops the submission. It is first under Needs attention."}</p> : null}
      <div className="mt-3 grid gap-x-8 gap-y-4 lg:grid-cols-2">
        <div className="min-w-0" data-testid="handover-transfers">
          <h4 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">What transfers to the project</h4>
          <dl className="mt-1 divide-y divide-border/70 text-sm">
            {transfers.map((t) => (
              <div key={t.key} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-3 py-1.5">
                <dt className="text-muted-foreground">{t.label}</dt>
                <dd className={cn("min-w-0 break-words", t.missing && "text-muted-foreground")} title={t.value}>{t.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0" data-testid="handover-attention-list">
          <h4 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{phase === "accepted" ? "What was not copied" : "Needs attention, before or after"}</h4>
          <ul className="mt-1 divide-y divide-border/70 text-sm">
            {attention.map((a) => {
              const Icon = KIND_ICON[a.kind];
              return (
                <li key={a.key} className="flex items-start gap-2 py-1.5" data-kind={a.kind}>
                  <Icon className={cn("mt-0.5 h-4 w-4 flex-none", KIND_TONE[a.kind])} aria-hidden />
                  <p className="min-w-0 break-words"><span className={cn("font-semibold", KIND_TONE[a.kind])}>{ATTENTION_WORDS[a.kind]}:</span> {a.text}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
