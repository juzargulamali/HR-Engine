import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import { stageLabel, type Stage, type TaskStatus } from "../_lib/sample";

type Tone = "neutral" | "cyan" | "blue" | "amber" | "red" | "quiet";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className="cx-badge" data-tone={tone}>{children}</span>;
}

const STAGE_TONE: Record<Stage, Tone> = { planning: "neutral", in_progress: "cyan", ready_for_installation: "blue", on_site: "blue", on_hold: "amber", completed: "quiet" };
const DOT: Record<Tone, string> = { neutral: "", cyan: "cyan", blue: "blue", amber: "amber", red: "red", quiet: "green" };
export function Pill({ tone = "neutral", children, as = "span", ...rest }: { tone?: Tone; children: React.ReactNode; as?: "span" } & React.HTMLAttributes<HTMLSpanElement>) {
  const Tag = as;
  return <Tag className="cx-pill" data-tone={tone} {...rest}><span className="cx-dot" data-tone={DOT[tone]} aria-hidden />{children}</Tag>;
}
export function StageBadge({ stage }: { stage: Stage }) {
  return <Pill tone={STAGE_TONE[stage]}>{stageLabel(stage)}</Pill>;
}

export const STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  todo: { label: "To do", tone: "neutral" }, doing: { label: "In progress", tone: "cyan" }, review: { label: "In review", tone: "blue" }, done: { label: "Done", tone: "quiet" },
};
export function TaskStatusBadge({ status, blocked }: { status: TaskStatus; blocked?: boolean }) {
  if (blocked && status !== "done") return <Pill tone="red">Blocked</Pill>;
  const s = STATUS[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
export const dotTone = (t: Tone) => DOT[t];

/** Two letters of the first name, in one of three restrained tones (no rainbow). Decorative: the name is always written next to it. */
export function Avatar({ name, size }: { name: string; size?: "sm" | "lg" }) {
  const first = name.split(" ")[0] ?? "";
  const tone = ["slate", "teal", "blue"][(first.charCodeAt(0) + first.length) % 3];
  return <span className="cx-avatar" data-tone={tone} data-size={size} aria-hidden>{first.slice(0, 2).toUpperCase()}</span>;
}

/** One attention note: an icon and words, so it never depends on colour alone. */
export function AttentionNote({ tone, children }: { tone: "warn" | "info" | "bad"; children: React.ReactNode }) {
  const Icon = tone === "bad" ? CircleAlert : tone === "warn" ? AlertTriangle : Info;
  const cls = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-[hsl(var(--cx-amber))]" : "text-[hsl(var(--cx-info))]";
  return <span className={`inline-flex min-w-0 items-center gap-1.5 text-sm ${cls}`}><Icon className="h-3.5 w-3.5 flex-none" aria-hidden /><span className="truncate text-foreground">{children}</span></span>;
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn"; title?: string; children: React.ReactNode }) {
  const Icon = tone === "warn" ? AlertTriangle : Info;
  return (
    <div className="cx-card flex items-start gap-3 px-4 py-3 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 flex-none ${tone === "warn" ? "text-[hsl(var(--cx-amber))]" : "text-[hsl(var(--cx-info))]"}`} aria-hidden />
      <div className="min-w-0">{title ? <p className="font-semibold">{title}</p> : null}<div className="text-muted-foreground">{children}</div></div>
    </div>
  );
}

export function EmptyNote({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-dashed border-border px-6 py-10 text-center">
      <p className="font-heading text-base font-semibold">{title}</p>
      {children ? <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Placeholder rows with the same heights as the real ones, so nothing jumps when the data arrives. No page-wide spinner. */
export function SkeletonRows({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="cx-card space-y-px overflow-hidden">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4" aria-hidden>
          <div className="h-4 w-1/3 animate-pulse rounded bg-secondary" />
          <div className="h-4 w-1/6 animate-pulse rounded bg-secondary/70" />
          <div className="ml-auto h-4 w-1/6 animate-pulse rounded bg-secondary/70" />
        </div>
      ))}
    </div>
  );
}

export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="cx-card border-destructive/40 px-6 py-8 text-center">
      <p className="font-heading text-base font-semibold">{what} could not be loaded</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">This is the sample error state. Nothing was lost; your filters and place are kept.</p>
      <div className="mt-4 flex justify-center"><button type="button" onClick={onRetry} className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Try again</button></div>
    </div>
  );
}
