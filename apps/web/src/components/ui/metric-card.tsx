import Link from "next/link";
import { cn } from "@/lib/utils";

const TONE_CLASSES = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
} as const;

/**
 * A single compact stat. Only ever wraps in a <Link> when `href` is given —
 * per the redesign brief, a card should look clickable only when there's a
 * real destination behind it, not just for visual consistency.
 */
export function MetricCard({
  label,
  value,
  href,
  hint,
  tone = "default",
  icon: Icon,
  className,
}: {
  label: string;
  value: string | number;
  href?: string;
  hint?: string;
  tone?: keyof typeof TONE_CLASSES;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" aria-hidden /> : null}
      </div>
      <div className={cn("mt-1.5 font-heading text-2xl font-semibold", TONE_CLASSES[tone])}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </>
  );

  const base = "block rounded-lg border border-border bg-card p-4 transition-all duration-150";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          base,
          "hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[0_10px_24px_-14px_hsl(var(--brand-glow)/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className,
        )}
      >
        {body}
      </Link>
    );
  }

  return <div className={cn(base, className)}>{body}</div>;
}
