import { cn } from "@/lib/utils";

export type OsTone = "neutral" | "cyan" | "blue" | "amber" | "red" | "quiet";

/** A small status word on a soft tint. The words always say the state; colour only supports them. */
export function OsBadge({ tone = "neutral", children, className }: { tone?: OsTone; children: React.ReactNode; className?: string }) {
  return <span className={cn("os-badge", className)} data-tone={tone}>{children}</span>;
}

const DOT: Record<OsTone, string> = { neutral: "", cyan: "cyan", blue: "blue", amber: "amber", red: "red", quiet: "green" };
export const dotTone = (t: OsTone) => DOT[t];

/** A status pill: a coloured dot and the words. */
export function OsPill({ tone = "neutral", children, className }: { tone?: OsTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("os-pill", className)} data-tone={tone}>
      <span className="os-dot" data-tone={DOT[tone]} aria-hidden />
      {children}
    </span>
  );
}

/** Two letters of the first name in one of three restrained tones. Decorative: the name is always written next to it. */
export function OsAvatar({ name, size }: { name: string; size?: "sm" | "lg" }) {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const tone = ["slate", "teal", "blue"][(first.charCodeAt(0) + first.length) % 3];
  return <span className="os-avatar" data-tone={tone} data-size={size} aria-hidden>{first.slice(0, 2).toUpperCase()}</span>;
}
